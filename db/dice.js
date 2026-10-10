// db/dice.js — Rolling from the panel: what a character can roll (checks,
// saves, skills, initiative, attacks, damage, spell attacks) worked out from
// the saved sheet, rolled on the server, logged, and handed to the Owlbear
// Rodeo extension of the player who rolled (see vtt.js).

'use strict';

const crypto = require('crypto');
const { db } = require('./connection');
const rules = require('../rules');
const { getCharacterClasses } = require('./characters');
const { buildCharacterCombat } = require('./combat');

const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const MODES = ['normal', 'advantage', 'disadvantage'];
const MAX_LABEL = 80;

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const signed = n => (n >= 0 ? `+${n}` : `${n}`);
const d20 = modifier => `1d20${modifier ? signed(modifier) : ''}`;

function classesOf(character) {
  const rows = getCharacterClasses(character.id);
  return rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
}

function hasFeature(classes, feature) {
  return classes.some(row => {
    const data = rules.getClass(row.className);
    return data && Object.entries(data.featuresByLevel || {}).some(([level, names]) => Number(level) <= row.level && names.includes(feature));
  });
}

// "1d8+4 Slashing (1d10+4 two-handed)" → { formula: '1d8+4', type: 'Slashing', twoHanded: '1d10+4' }
function parseDamage(text) {
  const match = String(text || '').match(/^(\S+)\s+([A-Za-z]+)(?:\s+\((\S+) two-handed\))?/);
  return match ? { formula: match[1], type: match[2], twoHanded: match[3] || null } : null;
}

// Everything this character can roll, by id: "check:str", "save:dex",
// "skill:Stealth", "initiative", "attack:0:hit", "attack:0:damage",
// "attack:0:damage2" (two-handed), "spell:Wizard".
function rollOptions(character) {
  const sheetData = readSheet(character.sheet_data);
  const classes = classesOf(character);
  const level = classes.reduce((sum, row) => sum + row.level, 0) || character.level || 1;
  const pb = rules.proficiencyBonus(Math.max(1, level));
  const mod = ability => rules.abilityModifier(rules.effectiveAbilityScore(sheetData, ability));
  const items = rules.magicItemEffects(sheetData);
  const saves = Array.isArray(sheetData.savingProficiencies) ? sheetData.savingProficiencies : [];
  const skills = Array.isArray(sheetData.skillProficiencies) ? sheetData.skillProficiencies : [];
  const expertise = Array.isArray(sheetData.expertise) ? sheetData.expertise : [];
  const feats = rules.collectCharacterFeats(sheetData).map(rules.featName);
  // Jack of All Trades: half proficiency on checks that don't already add it.
  const jack = hasFeature(classes, 'Jack of All Trades') ? Math.floor(pb / 2) : 0;
  const options = new Map();
  const add = (id, label, formula, kind) => options.set(id, { id, label, formula, kind });

  for (const [ability, name] of Object.entries(ABILITY_NAMES)) {
    add(`check:${ability}`, `${name} check`, d20(mod(ability) + jack + items.checks), 'check');
    add(`save:${ability}`, `${name} save`, d20(mod(ability) + (saves.includes(ability) ? pb : 0) + items.saves), 'save');
  }
  for (const [skill, ability] of Object.entries(rules.SKILLS)) {
    const proficient = skills.includes(skill);
    const bonus = mod(ability) + (proficient ? pb : jack) + (expertise.includes(skill) ? pb : 0) + items.checks;
    add(`skill:${skill}`, `${skill} (${ability.toUpperCase()})`, d20(bonus), 'check');
  }
  add('initiative', 'Initiative', d20(mod('dex') + (feats.includes('Alert') ? pb : jack) + items.checks), 'initiative');

  const combat = buildCharacterCombat(character, sheetData);
  combat.attacks.forEach((attack, index) => {
    if (attack.needsType) return;
    add(`attack:${index}:hit`, `${attack.name} attack`, d20(Number(attack.attackBonus)), 'attack');
    const damage = parseDamage(attack.damage);
    if (damage) {
      add(`attack:${index}:damage`, `${attack.name} damage (${damage.type})`, damage.formula, 'damage');
      if (damage.twoHanded) add(`attack:${index}:damage2`, `${attack.name} damage, two-handed (${damage.type})`, damage.twoHanded, 'damage');
    }
  });
  const sources = rules.getSpellSources({ classes, species: character.race, sheetData });
  for (const source of sources) {
    if (!options.has(`spell:${source.key}`)) add(`spell:${source.key}`, `${source.label} spell attack`, d20(source.attackBonus), 'attack');
  }
  return options;
}

function loadCharacter(characterId) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) throw new Error('Character not found.');
  return character;
}

// The owner, admins, and the DM of a running adventure the character is in.
function canRollFor(character, user) {
  if (!user) return false;
  if (user.role === 'admin' || character.player_id === Number(user.id)) return true;
  return Boolean(db.prepare(`
    SELECT 1 FROM adventure_party ap JOIN adventures a ON a.id = ap.adventure_id
    WHERE ap.character_id = ? AND a.status = 'active' AND a.dm_player_id = ?
  `).get(character.id, Number(user.id)));
}

function rollView(row) {
  const detail = JSON.parse(row.detail);
  return {
    id: row.id,
    characterId: row.character_id,
    character: row.character_name,
    player: row.player_tag || null,
    label: row.label,
    formula: row.formula,
    mode: row.mode,
    total: row.total,
    natural: detail.natural,
    text: detail.text,
    critical: Boolean(detail.critical),
    private: Boolean(row.private),
    createdAt: row.created_at
  };
}

const ROLL_QUERY = `
  SELECT r.*, c.name AS character_name, p.discord_tag AS player_tag
  FROM dice_rolls r JOIN characters c ON c.id = r.character_id LEFT JOIN players p ON p.id = r.player_id
`;

// request: { roll: optionId } or { formula, label }; mode; critical; private.
function rollForCharacter({ characterId, user, request = {} }) {
  const character = loadCharacter(characterId);
  if (!canRollFor(character, user)) throw new Error('Forbidden.');
  const mode = MODES.includes(request.mode) ? request.mode : 'normal';
  let option;
  if (request.roll) {
    option = rollOptions(character).get(String(request.roll));
    if (!option) throw new Error('That roll is not on this character sheet.');
  } else {
    const label = String(request.label || '').trim().slice(0, MAX_LABEL) || 'Roll';
    option = { id: 'custom', label, formula: String(request.formula || ''), kind: 'custom' };
  }
  const critical = Boolean(request.critical) && (option.kind === 'damage' || option.kind === 'custom');
  const result = rules.rollFormula(option.formula, { mode: option.kind === 'damage' ? 'normal' : mode, critical });
  const detail = { text: rules.describeRoll(result), natural: result.natural, critical, parts: result.parts, kind: option.kind };
  const label = critical ? `${option.label} — critical` : option.label;
  const id = Number(db.prepare(`
    INSERT INTO dice_rolls (character_id, player_id, label, formula, mode, total, detail, private)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(character.id, Number(user.id) > 0 ? Number(user.id) : null, label, result.formula,
    option.kind === 'damage' ? 'normal' : mode, result.total, JSON.stringify(detail), request.private ? 1 : 0).lastInsertRowid);
  return rollView(db.prepare(`${ROLL_QUERY} WHERE r.id = ?`).get(id));
}

// The latest rolls of these characters. Private rolls only for those who may
// see them (the roller, admins, the adventure's DM).
function getRecentRolls({ characterIds, limit = 30, showPrivate = false, viewerId = null }) {
  const ids = [...new Set(characterIds.map(Number))].filter(Number.isSafeInteger);
  if (!ids.length) return [];
  return db.prepare(`${ROLL_QUERY} WHERE r.character_id IN (${ids.map(() => '?').join(',')}) ORDER BY r.id DESC LIMIT ?`)
    .all(...ids, Math.min(100, Number(limit) || 30))
    .map(rollView)
    .map(roll => (roll.private && !showPrivate && !(viewerId && isRoller(roll.id, viewerId))
      ? { ...roll, total: null, formula: '', text: 'Private roll for the DM', natural: null }
      : roll));
}

function isRoller(rollId, playerId) {
  return Boolean(db.prepare('SELECT 1 FROM dice_rolls WHERE id = ? AND player_id = ?').get(rollId, Number(playerId)));
}

function getCharacterRolls({ characterId, user, limit }) {
  const character = loadCharacter(characterId);
  if (!canRollFor(character, user)) throw new Error('Forbidden.');
  return getRecentRolls({ characterIds: [character.id], limit, showPrivate: true });
}

// ─── d20 history and stats ─────────────────────────────────────────────────

// The d20s in a logged roll: [{ value, kept }] (both dice for advantage).
function d20Faces(detailJson) {
  let detail;
  try {
    detail = JSON.parse(detailJson);
  } catch {
    return [];
  }
  const faces = [];
  for (const part of detail.parts || []) {
    if (!/d20$/.test(String(part.dice || ''))) continue;
    (part.rolls || []).forEach((value, index) => faces.push({ value, kept: (part.kept || []).includes(index) }));
  }
  return faces;
}

// Panel rolls that included a d20, newest first, for the Rolls History tab.
// Private rolls show their numbers only to admins (showPrivate) and the roller.
function getSheetD20Rolls({ limit = 100, showPrivate = false, viewerId = null } = {}) {
  return db.prepare(`${ROLL_QUERY} ORDER BY r.id DESC LIMIT 1000`).all()
    .map(row => ({ row, faces: d20Faces(row.detail) }))
    .filter(entry => entry.faces.length)
    .slice(0, limit)
    .map(({ row, faces }) => {
      const hidden = row.private && !showPrivate && !(viewerId && row.player_id === Number(viewerId));
      return {
        id: row.id,
        createdAt: row.created_at,
        character: row.character_name,
        player: row.player_tag,
        label: row.label,
        mode: row.mode,
        private: Boolean(row.private),
        faces: hidden ? [] : faces,
        total: hidden ? null : row.total
      };
    });
}

// Every d20 face rolled in the panel (dropped advantage dice too), for stats.
function getSheetD20Faces() {
  return db.prepare("SELECT detail FROM dice_rolls WHERE detail LIKE '%d20%'").all()
    .flatMap(row => d20Faces(row.detail).map(face => face.value))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 20);
}

// ─── Owlbear Rodeo keys ─────────────────────────────────────────────────────

function getVttKey({ playerId, regenerate = false }) {
  const id = Number(playerId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Only player accounts can connect to Owlbear Rodeo.');
  const existing = db.prepare('SELECT key FROM vtt_keys WHERE player_id = ?').get(id);
  if (existing && !regenerate) return existing.key;
  const key = crypto.randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO vtt_keys (player_id, key) VALUES (?, ?)
    ON CONFLICT(player_id) DO UPDATE SET key = excluded.key, created_at = CURRENT_TIMESTAMP, last_used_at = NULL`).run(id, key);
  return key;
}

// The extension asks for the rolls a player made after `after` (a roll id).
// Without `after` it learns the latest id, so old rolls are not replayed.
function getVttRolls({ key, after }) {
  const row = typeof key === 'string' && key.length >= 16
    ? db.prepare('SELECT v.player_id, p.discord_tag FROM vtt_keys v JOIN players p ON p.id = v.player_id WHERE v.key = ?').get(key)
    : null;
  if (!row) throw new Error('Unknown key. Copy it again from the panel.');
  db.prepare('UPDATE vtt_keys SET last_used_at = CURRENT_TIMESTAMP WHERE player_id = ?').run(row.player_id);
  const latest = db.prepare('SELECT MAX(id) AS id FROM dice_rolls WHERE player_id = ?').get(row.player_id).id || 0;
  const since = Number(after);
  if (!Number.isSafeInteger(since) || since < 0) return { player: row.discord_tag, latest, rolls: [] };
  const rolls = db.prepare(`${ROLL_QUERY} WHERE r.player_id = ? AND r.id > ? ORDER BY r.id LIMIT 20`)
    .all(row.player_id, since).map(rollView);
  return { player: row.discord_tag, latest, rolls };
}

module.exports = {
  rollOptions,
  rollForCharacter,
  getRecentRolls,
  getCharacterRolls,
  getVttKey,
  getVttRolls,
  getSheetD20Rolls,
  getSheetD20Faces,
  canRollFor
};
