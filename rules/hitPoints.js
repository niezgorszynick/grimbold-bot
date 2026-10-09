// rules/hitPoints.js — Hit Point maximum and Hit Dice using the fixed-average rule.
//
// Campaign rule: HP is never rolled. Level 1 of the first class grants the
// Hit Die maximum; every later level grants the fixed average (die / 2 + 1).
// The Constitution modifier is applied to every level, so a CON change
// retroactively changes the maximum, as the 2024 rules require.

const { abilityModifier } = require('./util');
const { getClass } = require('./classes');
const { hpPerLevelFromFeats } = require('./feats');

function averageHitDieValue(hitDie) {
  return hitDie / 2 + 1;
}

// Extra HP per character level granted by species traits.
const SPECIES_HP_PER_LEVEL = { Dwarf: 1 };

// Draconic Resilience: +3 at Sorcerer level 3 and +1 per Sorcerer level after,
// which equals the Sorcerer level once the subclass is gained.
function subclassHpBonus(classes) {
  return classes.reduce((total, row) => {
    if (row.className === 'Sorcerer' && row.subclassName === 'Draconic Sorcery' && row.level >= 3) {
      return total + row.level;
    }
    return total;
  }, 0);
}

// classes: [{ className, subclassName, level }] — the first entry is the starting class.
// Returns the maximum with a breakdown for display on the sheet.
function calculateMaxHp({ classes, constitution, species = '', feats = [] }) {
  if (!Array.isArray(classes) || classes.length === 0) {
    throw new Error('At least one class is required to calculate Hit Points.');
  }
  const conModifier = abilityModifier(constitution);
  const totalLevel = classes.reduce((sum, row) => sum + row.level, 0);

  let fromHitDice = 0;
  let fromConstitution = 0;
  classes.forEach((row, index) => {
    const classData = getClass(row.className);
    if (!classData) throw new Error(`Unknown class "${row.className}".`);
    for (let level = 1; level <= row.level; level += 1) {
      const isFirstCharacterLevel = index === 0 && level === 1;
      const dieValue = isFirstCharacterLevel ? classData.hitDie : averageHitDieValue(classData.hitDie);
      // A level never grants less than 1 HP, even with a negative CON modifier.
      const gained = Math.max(1, dieValue + conModifier);
      fromHitDice += dieValue;
      fromConstitution += gained - dieValue;
    }
  });

  const fromSpecies = (SPECIES_HP_PER_LEVEL[species] || 0) * totalLevel;
  const fromFeats = hpPerLevelFromFeats(feats) * totalLevel;
  const fromSubclass = subclassHpBonus(classes);

  return {
    max: fromHitDice + fromConstitution + fromSpecies + fromFeats + fromSubclass,
    breakdown: { fromHitDice, fromConstitution, fromSpecies, fromFeats, fromSubclass }
  };
}

// HP gained when a single new level is added, for the level-up summary.
function hpGainForLevel({ className, constitution, isFirstCharacterLevel = false, species = '', feats = [] }) {
  const classData = getClass(className);
  if (!classData) throw new Error(`Unknown class "${className}".`);
  const dieValue = isFirstCharacterLevel ? classData.hitDie : averageHitDieValue(classData.hitDie);
  return Math.max(1, dieValue + abilityModifier(constitution)) +
    (SPECIES_HP_PER_LEVEL[species] || 0) +
    hpPerLevelFromFeats(feats);
}

// Hit Dice pool grouped by die size, e.g. { d10: 3, d8: 2 }.
function getHitDicePool(classes) {
  const pool = {};
  for (const row of classes) {
    const classData = getClass(row.className);
    if (!classData) continue;
    const key = `d${classData.hitDie}`;
    pool[key] = (pool[key] || 0) + row.level;
  }
  return pool;
}

function formatHitDicePool(pool) {
  return Object.entries(pool)
    .sort((a, b) => Number(b[0].slice(1)) - Number(a[0].slice(1)))
    .map(([die, count]) => `${count}${die}`)
    .join(' + ');
}

module.exports = {
  averageHitDieValue,
  calculateMaxHp,
  hpGainForLevel,
  getHitDicePool,
  formatHitDicePool
};
