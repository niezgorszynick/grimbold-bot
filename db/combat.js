// db/combat.js — Armor Class and attacks for the character sheet, worked out
// from worn armor and wielded weapons (see rules/combat.js).

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { getCharacterClasses } = require('./characters');

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('Stored character sheet data is invalid.');
  }
}

function loadCharacter(characterId, playerId, isAdmin) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) throw new Error('Character not found.');
  if (!isAdmin && character.player_id !== Number(playerId)) throw new Error('Forbidden.');
  return character;
}

function combatCharacter(character, sheetData) {
  const rows = getCharacterClasses(character.id);
  const classes = rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
  return { classes, species: character.race, sheetData };
}

function isRulesManaged(sheetData) {
  return Array.isArray(sheetData.originFeats) || Array.isArray(sheetData.levelHistory);
}

// Characters made before the rules engine keep a hand-typed AC until they
// wear armor or a shield from their equipment list.
function buildCombat(character, sheetData) {
  const combat = rules.calculateCombat(combatCharacter(character, sheetData));
  const wearsArmor = Boolean(combat.armorClass.armor || combat.armorClass.shield);
  const manual = !isRulesManaged(sheetData) && !wearsArmor;
  return {
    ...combat,
    armorClass: {
      ...combat.armorClass,
      manual,
      value: manual && Number.isInteger(sheetData.armorClass) ? sheetData.armorClass : combat.armorClass.value
    }
  };
}

// Keeps the stored Armor Class (used by summaries) in step with the gear.
function withArmorClass(character, sheetData) {
  const combat = buildCombat(character, sheetData);
  return combat.armorClass.manual ? sheetData : { ...sheetData, armorClass: combat.armorClass.value };
}

function getCharacterCombat({ id, player_id, is_admin }) {
  const character = loadCharacter(id, player_id, is_admin);
  return buildCombat(character, readSheet(character.sheet_data));
}

// A fixed bonus or penalty for things the sheet doesn't model.
function setCharacterAcAdjustment({ id, player_id, is_admin, value }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    const nextSheet = withArmorClass(character, { ...sheetData, acAdjustment: rules.validateAcAdjustment(value) });
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return buildCombat(character, nextSheet);
  })();
}

module.exports = { getCharacterCombat, setCharacterAcAdjustment, combatWithArmorClass: withArmorClass, buildCharacterCombat: buildCombat };
