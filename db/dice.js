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
const { activeWildShape, starryFormState } = require('./wildShape');

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
// "attack:0:damage2" (two-handed), "spell:Wizard". In Wild Shape also the
// beast's attacks: "beast:0:hit", "beast:0:damage", "beast:0:other:0".
// Circle of the Stars: "starry:archer:hit", "starry:archer:damage",
// "starry:chalice:heal" in Starry Form, and "omen:d6" (Cosmic Omen).
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
  // Jack of All Trades: half proficiency on checks that don't already add it.
  const jack = hasFeature(classes, 'Jack of All Trades') ? Math.floor(pb / 2) : 0;
  // Thaumaturge, Magician, Otherworldly Glamour: a bonus to some checks.
  const featureBonus = rules.featureCheckBonuses(sheetData, ability => rules.effectiveAbilityScore(sheetData, ability));
  const options = new Map();
  // extra: { advantage: [item names], disadvantage: [...] } from item bonuses.
  const add = (id, label, formula, kind, extra = {}) => options.set(id, { id, label, formula, kind, ...extra });
  // Custom item bonuses (a ring's +2 to History, a book's Advantage on Religion).
  const itemTotals = rules.itemBonusTotals(sheetData);
  const fromItems = roll => rules.itemBonusFor(itemTotals, roll);

  for (const [ability, name] of Object.entries(ABILITY_NAMES)) {
    // Jack of All Trades (2024) is for skill checks only, not plain ability checks.
    const check = fromItems({ type: 'check', ability });
    const save = fromItems({ type: 'save', ability });
    add(`check:${ability}`, `${name} check`, d20(mod(ability) + items.checks + (featureBonus.checks[ability] || 0) + check.value), 'check', check);
    add(`save:${ability}`, `${name} save`, d20(mod(ability) + (saves.includes(ability) ? pb : 0) + items.saves + save.value), 'save', save);
  }
  for (const [skill, ability] of Object.entries(rules.SKILLS)) {
    const proficient = skills.includes(skill);
    const bonus = mod(ability) + (proficient ? pb : jack) + (expertise.includes(skill) ? pb : 0) + items.checks +
      Math.max(featureBonus.skills[skill] || 0, featureBonus.checks[ability] || 0);
    const item = fromItems({ type: 'skill', skill, ability });
    add(`skill:${skill}`, `${skill} (${ability.toUpperCase()})`, d20(bonus + item.value), 'check', item);
  }
  add('initiative', 'Initiative', d20(rules.initiativeOf({ classes, sheetData }).total), 'initiative', fromItems({ type: 'initiative' }));

  const combat = buildCharacterCombat(character, sheetData);
  combat.attacks.forEach((attack, index) => {
    if (attack.needsType) return;
    add(`attack:${index}:hit`, `${attack.name} attack`, d20(Number(attack.attackBonus)), 'attack');
    const damage = parseDamage(attack.damage);
    if (damage) {
      add(`attack:${index}:damage`, `${attack.name} damage (${damage.type})`, damage.formula, 'damage');
      if (damage.twoHanded) add(`attack:${index}:damage2`, `${attack.name} damage, two-handed (${damage.type})`, damage.twoHanded, 'damage');
      // The extra Light attack (no ability modifier unless negative / Two-Weapon Fighting).
      const offHand = attack.offHand && parseDamage(attack.offHand.damage);
      if (offHand) add(`attack:${index}:offhand`, `${attack.name} damage, off-hand (${offHand.type})`, offHand.formula, 'damage');
    }
  });
  // Wild Shape: STR, DEX and CON (and what uses them) are the beast's now.
  const form = activeWildShape(character, sheetData);
  if (form && !form.missing) {
    for (const ability of ['str', 'dex', 'con']) {
      add(`check:${ability}`, `${ABILITY_NAMES[ability]} check (${form.name})`, d20(form.mods[ability]), 'check');
      add(`save:${ability}`, `${ABILITY_NAMES[ability]} save (${form.name})`, d20(form.saves[ability]), 'save');
    }
    for (const [skill, ability] of Object.entries(rules.SKILLS)) {
      const current = Number(options.get(`skill:${skill}`).formula.replace('1d20', '')) || 0;
      const bonus = ['str', 'dex', 'con'].includes(ability) ? form.skills[skill] : Math.max(current, form.skills[skill]);
      add(`skill:${skill}`, `${skill} (${ability.toUpperCase()}, ${form.name})`, d20(bonus), 'check');
    }
    add('initiative', `Initiative (${form.name})`, d20(form.initiative), 'initiative');
    form.attacks.forEach((attack, index) => {
      add(`beast:${index}:hit`, `${form.name}: ${attack.name} attack`, d20(attack.attackBonus), 'attack');
      add(`beast:${index}:damage`, `${form.name}: ${attack.name} damage (${attack.damage.type})`, attack.damage.formula, 'damage');
      attack.damage.others.forEach((other, otherIndex) => {
        add(`beast:${index}:other:${otherIndex}`, `${form.name}: ${attack.name} ${other.kind === 'or' ? 'other' : 'extra'} damage (${other.type})`, other.formula, 'damage');
      });
    });
  }
  const starry = starryFormState(character, sheetData);
  if (starry) {
    const [archer, chalice] = starry.constellations;
    if (starry.active === 'Archer') {
      add('starry:archer:hit', 'Starry Form: Luminous Arrow attack', d20(archer.attack.attackBonus), 'attack');
      add('starry:archer:damage', 'Starry Form: Luminous Arrow damage (Radiant)', archer.attack.damage.formula, 'damage');
    }
    if (starry.active === 'Chalice') add('starry:chalice:heal', 'Starry Form: Chalice healing', chalice.healing, 'damage');
    if (starry.cosmicOmen) add('omen:d6', `Cosmic Omen (${starry.cosmicOmen === 'weal' ? 'Weal: add' : 'Woe: subtract'})`, '1d6', 'damage');
  }
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
    // initiative, check, save, attack, damage, custom (Owlbear puts initiative in the tracker).
    kind: detail.kind || null,
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
  let mode = MODES.includes(request.mode) ? request.mode : 'normal';
  let option;
  if (request.roll) {
    option = rollOptions(character).get(String(request.roll));
    if (!option) throw new Error('That roll is not on this character sheet.');
    // An item's Advantage / Disadvantage joins the roller's choice; one of
    // each cancels out (2024 rules).
    const itemAdvantage = (option.advantage || []).length > 0;
    const itemDisadvantage = (option.disadvantage || []).length > 0;
    if (itemAdvantage || itemDisadvantage) {
      const advantage = itemAdvantage || mode === 'advantage';
      const disadvantage = itemDisadvantage || mode === 'disadvantage';
      mode = advantage && disadvantage ? 'normal' : advantage ? 'advantage' : 'disadvantage';
      const notes = [
        itemAdvantage ? `Advantage: ${option.advantage.join(', ')}` : null,
        itemDisadvantage ? `Disadvantage: ${option.disadvantage.join(', ')}` : null
      ].filter(Boolean);
      option = { ...option, label: `${option.label} (${notes.join('; ')})`.slice(0, MAX_LABEL) };
    }
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
  // Initiative during a running encounter: the fight's turn order gets it.
  if (option.kind === 'initiative') require('./encounters').recordInitiativeRoll(character.id, result.total);
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

// ─── Roll history and stats per die ────────────────────────────────────────

// The dice the Rolls History and Analytics tabs follow.
const TRACKED_DICE = [20, 4, 6, 8, 10, 12, 100];

// The faces of one die size in a logged roll: [{ value, kept }]
// ("4d6kh3" or advantage: the dropped dice have kept: false).
function dieFaces(detailJson, sides) {
  let detail;
  try {
    detail = JSON.parse(detailJson);
  } catch {
    return [];
  }
  const faces = [];
  for (const part of detail.parts || []) {
    const match = String(part.dice || '').match(/^\d+d(\d+)$/);
    if (!match || Number(match[1]) !== sides) continue;
    (part.rolls || []).forEach((value, index) => faces.push({ value, kept: (part.kept || []).includes(index) }));
  }
  return faces;
}

// Panel rolls that included the die, newest first, for the Rolls History tab.
// Private rolls show their numbers only to admins (showPrivate) and the roller.
function getSheetRollsByDie({ sides = 20, limit = 100, showPrivate = false, viewerId = null } = {}) {
  return db.prepare(`${ROLL_QUERY} ORDER BY r.id DESC LIMIT 2000`).all()
    .map(row => ({ row, faces: dieFaces(row.detail, sides) }))
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
        formula: hidden ? '' : row.formula,
        mode: row.mode,
        private: Boolean(row.private),
        faces: hidden ? [] : faces,
        total: hidden ? null : row.total
      };
    });
}

// Every face of the die rolled in the panel (dropped dice too), for stats.
function getSheetDieFaces(sides) {
  return db.prepare('SELECT detail FROM dice_rolls WHERE detail LIKE ?').all(`%d${sides}"%`)
    .flatMap(row => dieFaces(row.detail, sides).map(face => face.value))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= sides);
}

const getSheetD20Rolls = options => getSheetRollsByDie({ ...options, sides: 20 });
const getSheetD20Faces = () => getSheetDieFaces(20);

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
// The player a key belongs to (and the key is marked as used).
function vttPlayerForKey(key) {
  const row = typeof key === 'string' && key.length >= 16
    ? db.prepare('SELECT v.player_id, p.discord_tag FROM vtt_keys v JOIN players p ON p.id = v.player_id WHERE v.key = ?').get(key)
    : null;
  if (!row) throw new Error('Unknown key. Copy it again from the panel.');
  return row;
}

function getVttRolls({ key, after }) {
  const row = vttPlayerForKey(key);
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
  vttPlayerForKey,
  TRACKED_DICE,
  getSheetRollsByDie,
  getSheetDieFaces,
  getSheetD20Rolls,
  getSheetD20Faces,
  canRollFor
};
