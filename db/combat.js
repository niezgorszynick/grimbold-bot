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
// The attack a custom weapon would have on this character, before it is saved:
// the sheet's own calculation, with a made-up row at the end of the equipment.
function previewCustomWeapon({ id, player_id, is_admin, name, weapon }) {
  const character = loadCharacter(id, player_id, is_admin);
  const sheetData = readSheet(character.sheet_data);
  const row = { name: String(name || 'Custom weapon').slice(0, 100) || 'Custom weapon', quantity: 1, source: 'custom', weapon: rules.validateCustomWeapon(weapon), equipped: true };
  const inventory = [...(Array.isArray(sheetData.inventory) ? sheetData.inventory : []), row];
  const combat = rules.calculateCombat(combatCharacter(character, { ...sheetData, inventory }));
  const attack = combat.attacks.find(entry => entry.from === 'inventory' && entry.index === inventory.length - 1) ||
    combat.attacks.filter(entry => entry.from === 'inventory').pop();
  return { attack };
}

function buildCombat(character, sheetData) {
  const combat = rules.calculateCombat(combatCharacter(character, sheetData));
  const wearsArmor = Boolean(combat.armorClass.armor || combat.armorClass.shield);
  const manual = !isRulesManaged(sheetData) && !wearsArmor;
  const blade = Array.isArray(sheetData.invocations) && sheetData.invocations.some(entry => entry && entry.name === 'Pact of the Blade');
  return {
    ...combat,
    // Pact of the Blade: the conjured weapon's settings, and what can be picked.
    pactWeapon: blade ? { current: sheetData.pactWeapon || null, weapons: rules.PACT_WEAPONS, damageTypes: rules.PACT_DAMAGE_TYPES } : null,
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

// Pact of the Blade: the weapon the warlock conjures (null clears it).
function setCharacterPactWeapon({ id, player_id, is_admin, pactWeapon }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    if (!(Array.isArray(sheetData.invocations) && sheetData.invocations.some(entry => entry && entry.name === 'Pact of the Blade'))) {
      throw new Error('Only a Warlock with Pact of the Blade has a pact weapon.');
    }
    const nextSheet = { ...sheetData, pactWeapon: pactWeapon ? rules.validatePactWeapon(pactWeapon) : null };
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return buildCombat(character, nextSheet);
  })();
}

module.exports = { setCharacterPactWeapon, previewCustomWeapon, getCharacterCombat, setCharacterAcAdjustment, combatWithArmorClass: withArmorClass, buildCharacterCombat: buildCombat };
