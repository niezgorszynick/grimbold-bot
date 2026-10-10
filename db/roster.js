// db/roster.js — The campaign roster for DMs: every character with the
// numbers a DM looks up during play (HP, AC, Passive Perception, spell DC).

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { buildCharacterCombat } = require('./combat');

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Each part on its own, so one odd sheet never hides the whole roster.
function attempt(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

function passivePerception(sheetData) {
  const wis = rules.abilityModifier(rules.effectiveAbilityScore(sheetData, 'wis'));
  const skills = Array.isArray(sheetData.skillProficiencies) ? sheetData.skillProficiencies : [];
  const expertise = Array.isArray(sheetData.expertise) ? sheetData.expertise : [];
  return { wis, proficient: skills.includes('Perception'), expert: expertise.includes('Perception') };
}

function getCampaignRoster() {
  const characters = db.prepare(`
    SELECT c.*, p.discord_tag AS player_tag
    FROM characters c JOIN players p ON p.id = c.player_id
    ORDER BY p.discord_tag COLLATE NOCASE, c.name COLLATE NOCASE
  `).all();
  const classRows = db.prepare('SELECT * FROM character_classes ORDER BY character_id, id').all();
  const classesBy = new Map();
  for (const row of classRows) {
    if (!classesBy.has(row.character_id)) classesBy.set(row.character_id, []);
    classesBy.get(row.character_id).push({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level });
  }

  return characters.map(character => {
    const sheetData = readSheet(character.sheet_data);
    const stored = classesBy.get(character.id) || [];
    const classes = stored.length
      ? stored
      : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
    const appliedLevel = classes.reduce((sum, row) => sum + row.level, 0);
    const totalLevel = stored.length ? appliedLevel : character.level;
    const pb = rules.proficiencyBonus(Math.max(1, totalLevel));

    const vitals = attempt(() => {
      const context = rules.deriveVitalsContext({ species: character.race, sheetData, classRows: classes });
      const current = rules.normalizeVitals(sheetData, context.hpMax);
      return { current: current.hpCurrent, max: context.hpMax, temp: current.hpTemp, stable: current.stable };
    });
    const combat = attempt(() => buildCharacterCombat(character, sheetData));
    const perception = attempt(() => passivePerception(sheetData));
    const spellDc = attempt(() => {
      const dcs = rules.getSpellSources({ classes, species: character.race, sheetData })
        .filter(source => source.kind === 'class').map(source => source.saveDc);
      return dcs.length ? Math.max(...dcs) : null;
    });

    return {
      id: character.id,
      name: character.name,
      species: character.race,
      playerId: character.player_id,
      player: character.player_tag,
      status: character.status,
      xp: character.xp,
      goldCp: character.gold_cp,
      level: totalLevel,
      pendingLevels: character.status === 'alive' && stored.length ? Math.max(0, character.level - appliedLevel) : 0,
      classes,
      hp: vitals,
      armorClass: combat ? combat.armorClass.value : (Number.isInteger(sheetData.armorClass) ? sheetData.armorClass : null),
      passivePerception: perception
        ? 10 + perception.wis + (perception.proficient ? pb : 0) + (perception.expert ? pb : 0)
        : null,
      spellDc
    };
  });
}

module.exports = { getCampaignRoster };
