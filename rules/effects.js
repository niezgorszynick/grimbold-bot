// rules/effects.js — Class features that are switched on for a while and change
// the attacks while they last: Rage (Barbarian) and Sacred Weapon (Oath of
// Devotion Channel Divinity). Starting one spends a use of its feature; it
// ends with the End button, any rest, or dropping to 0 Hit Points.
// The keys of the active ones are stored as sheetData.activeEffects.

const { atLevel, abilityModifier } = require('./util');
const { getClass } = require('./classes');

const levelOf = (classes, className) => (classes || []).filter(row => row.className === className).reduce((sum, row) => sum + row.level, 0);

const EFFECTS = {
  rage: {
    name: 'Rage',
    resource: 'rage',
    available: classes => levelOf(classes, 'Barbarian') >= 1,
    // 2024: Strength attacks with a weapon or an Unarmed Strike.
    damageBonus: classes => atLevel(getClass('Barbarian').resources.rageDamage, levelOf(classes, 'Barbarian')),
    text: 'Bonus Action, up to 10 minutes. Damage bonus on Strength attacks; Resistance to Bludgeoning, Piercing and Slashing; Advantage on Strength checks and saves; no spells or Concentration.'
  },
  sacredWeapon: {
    name: 'Sacred Weapon',
    resource: 'channelDivinityPaladin',
    available: classes => (classes || []).some(row => row.className === 'Paladin' && row.subclassName === 'Oath of Devotion' && row.level >= 3),
    // CHA modifier (minimum +1) to attack rolls with the melee weapon.
    attackBonus: scores => Math.max(1, abilityModifier(scores.cha)),
    text: '10 minutes. Add your Charisma modifier (min. +1) to attack rolls with the melee weapon; it can deal Radiant damage and sheds Bright Light 20 ft.'
  }
};

const EFFECT_KEYS = Object.keys(EFFECTS);

// The effects this character's classes allow.
function availableEffects(classes) {
  return EFFECT_KEYS.filter(key => EFFECTS[key].available(classes));
}

// Stored keys, cleaned: known, and allowed for these classes.
function activeEffectsOf(sheetData, classes) {
  const stored = Array.isArray(sheetData && sheetData.activeEffects) ? sheetData.activeEffects : [];
  const allowed = availableEffects(classes);
  return [...new Set(stored.filter(key => allowed.includes(key)))];
}

module.exports = { EFFECTS, EFFECT_KEYS, availableEffects, activeEffectsOf };
