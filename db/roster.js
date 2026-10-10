// db/roster.js — Character snapshots for DMs: the campaign roster (every
// character) and the adventure table (the party of one adventure), with the
// numbers looked up during play.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { buildCharacterCombat } = require('./combat');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Each part on its own, so one odd sheet never hides the whole list.
function attempt(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

function classRowsBy() {
  const rows = db.prepare('SELECT * FROM character_classes ORDER BY character_id, id').all();
  const byCharacter = new Map();
  for (const row of rows) {
    if (!byCharacter.has(row.character_id)) byCharacter.set(row.character_id, []);
    byCharacter.get(row.character_id).push({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level });
  }
  return byCharacter;
}

// character: a characters row with player_tag. detail: also slots, saves, etc.
function snapshot(character, storedClasses, { detail = false } = {}) {
  const sheetData = readSheet(character.sheet_data);
  const classes = storedClasses.length
    ? storedClasses
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
  const appliedLevel = classes.reduce((sum, row) => sum + row.level, 0);
  const totalLevel = storedClasses.length ? appliedLevel : character.level;
  const pb = rules.proficiencyBonus(Math.max(1, totalLevel));
  const mod = ability => rules.abilityModifier(rules.effectiveAbilityScore(sheetData, ability));

  const vitals = attempt(() => {
    const context = rules.deriveVitalsContext({ species: character.race, sheetData, classRows: classes });
    const view = rules.buildVitalsView(rules.normalizeVitals(sheetData, context.hpMax), context);
    return { context, view };
  });
  const combat = attempt(() => buildCharacterCombat(character, sheetData));
  const skills = Array.isArray(sheetData.skillProficiencies) ? sheetData.skillProficiencies : [];
  const expertise = Array.isArray(sheetData.expertise) ? sheetData.expertise : [];
  const spellSources = attempt(() => rules.getSpellSources({ classes, species: character.race, sheetData })
    .filter(source => source.kind === 'class')) || [];

  const row = {
    id: character.id,
    name: character.name,
    species: character.race,
    playerId: character.player_id,
    player: character.player_tag,
    status: character.status,
    xp: character.xp,
    goldCp: character.gold_cp,
    level: totalLevel,
    pendingLevels: character.status === 'alive' && storedClasses.length ? Math.max(0, character.level - appliedLevel) : 0,
    classes,
    hp: vitals ? {
      current: vitals.view.hpCurrent,
      max: vitals.view.hpMax,
      temp: vitals.view.hpTemp,
      stable: vitals.view.stable,
      deathSaves: vitals.view.deathSaves
    } : null,
    armorClass: combat ? combat.armorClass.value : (Number.isInteger(sheetData.armorClass) ? sheetData.armorClass : null),
    passivePerception: attempt(() => 10 + mod('wis') + (skills.includes('Perception') ? pb : 0) + (expertise.includes('Perception') ? pb : 0)),
    spellDc: spellSources.length ? Math.max(...spellSources.map(source => source.saveDc)) : null
  };
  if (!detail) return row;

  const feats = attempt(() => rules.collectCharacterFeats(sheetData).map(rules.featName)) || [];
  const saveBonus = attempt(() => rules.magicItemEffects(sheetData).saves) || 0;
  const saves = Array.isArray(sheetData.savingProficiencies) ? sheetData.savingProficiencies : [];
  const concentration = sheetData.spellcasting && sheetData.spellcasting.concentration;
  return {
    ...row,
    initiative: attempt(() => mod('dex') + (feats.includes('Alert') ? pb : 0)),
    speed: typeof sheetData.speed === 'string' && sheetData.speed.trim() ? sheetData.speed : '30 ft.',
    proficiencyBonus: pb,
    saves: attempt(() => Object.fromEntries(ABILITIES.map(ability => [ability, mod(ability) + (saves.includes(ability) ? pb : 0) + saveBonus]))),
    spellcasting: spellSources.map(source => ({ label: source.label, ability: source.ability, saveDc: source.saveDc, attackBonus: source.attackBonus })),
    spellSlots: vitals ? vitals.view.spellSlots.filter(slot => slot.total > 0) : [],
    pact: vitals ? vitals.view.pact : null,
    hitDice: vitals ? vitals.view.hitDice : [],
    exhaustion: vitals ? vitals.view.exhaustion : 0,
    concentration: concentration ? concentration.spell : null,
    // index: the attack's place in the character's roll list (db/dice.js).
    attacks: combat ? combat.attacks.map((attack, index) => ({ index, name: attack.name, attackBonus: attack.attackBonus, damage: attack.damage, needsType: attack.needsType }))
      .filter(attack => !attack.needsType).slice(0, 4).map(({ needsType, ...attack }) => attack) : []
  };
}

const CHARACTER_QUERY = `
  SELECT c.*, p.discord_tag AS player_tag
  FROM characters c JOIN players p ON p.id = c.player_id
`;

function getCampaignRoster() {
  const characters = db.prepare(`${CHARACTER_QUERY} ORDER BY p.discord_tag COLLATE NOCASE, c.name COLLATE NOCASE`).all();
  const classes = classRowsBy();
  return characters.map(character => snapshot(character, classes.get(character.id) || []));
}

// Detailed snapshots of the given characters, in the order given.
function getCharacterSnapshots(characterIds) {
  const ids = [...new Set(characterIds.map(Number))].filter(Number.isSafeInteger);
  if (!ids.length) return [];
  const rows = db.prepare(`${CHARACTER_QUERY} WHERE c.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = new Map(rows.map(row => [row.id, row]));
  const classes = classRowsBy();
  return ids.filter(id => byId.has(id)).map(id => snapshot(byId.get(id), classes.get(id) || [], { detail: true }));
}

module.exports = { getCampaignRoster, getCharacterSnapshots };
