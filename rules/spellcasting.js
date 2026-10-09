// rules/spellcasting.js — Spell slots, Pact Magic and multiclass caster level (2024 PHB).

const { atLevel } = require('./util');
const { getClass, SUBCLASS_SPELLCASTING } = require('./classes');

// Spell slots per spell level (index 0 = level 1 slots) by caster level 1–20.
const SPELL_SLOT_TABLE = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1]
];

const PACT_SLOT_COUNT = [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4];
const PACT_SLOT_LEVEL = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

function slotsForCasterLevel(casterLevel) {
  if (casterLevel < 1) return [];
  return [...SPELL_SLOT_TABLE[Math.min(20, casterLevel) - 1]];
}

// Spellcasting entry for one class row, including subclass-granted casting (Eldritch Knight etc.).
function spellcastingFor(className, subclassName) {
  const classData = getClass(className);
  if (classData && classData.spellcasting) return classData.spellcasting;
  return SUBCLASS_SPELLCASTING[subclassName] || null;
}

// Single-class caster level uses the class's own table (rounding up).
function singleClassCasterLevel(progression, level) {
  if (progression === 'full') return level;
  if (progression === 'half') return Math.ceil(level / 2);
  if (progression === 'third') return level >= 3 ? Math.ceil(level / 3) : 0;
  return 0;
}

// Multiclass rule: full levels + half (round up) of Paladin/Ranger/Artificer
// + one third (round down) of Eldritch Knight/Arcane Trickster levels.
function multiclassContribution(progression, level) {
  if (progression === 'full') return level;
  if (progression === 'half') return Math.ceil(level / 2);
  if (progression === 'third') return Math.floor(level / 3);
  return 0;
}

// classes: [{ className, subclassName, level }]
// Returns { slots: [count per spell level], pact: { count, slotLevel } | null, casterLevel }.
function getSpellSlots(classes) {
  const casters = classes
    .map(row => ({ ...row, spellcasting: spellcastingFor(row.className, row.subclassName) }))
    .filter(row => row.spellcasting);

  const pactRows = casters.filter(row => row.spellcasting.progression === 'pact');
  const slotRows = casters.filter(row => row.spellcasting.progression !== 'pact');

  let casterLevel = 0;
  if (slotRows.length === 1) {
    casterLevel = singleClassCasterLevel(slotRows[0].spellcasting.progression, slotRows[0].level);
  } else {
    casterLevel = slotRows.reduce(
      (sum, row) => sum + multiclassContribution(row.spellcasting.progression, row.level),
      0
    );
  }

  const pactLevel = pactRows.reduce((sum, row) => sum + row.level, 0);
  return {
    casterLevel,
    slots: slotsForCasterLevel(casterLevel),
    pact: pactLevel > 0
      ? { count: atLevel(PACT_SLOT_COUNT, pactLevel), slotLevel: atLevel(PACT_SLOT_LEVEL, pactLevel) }
      : null
  };
}

// Cantrips known and spells prepared for one class row.
function getSpellsKnown(className, subclassName, level) {
  const spellcasting = spellcastingFor(className, subclassName);
  if (!spellcasting) return { cantrips: 0, prepared: 0, ability: null };
  return {
    cantrips: atLevel(spellcasting.cantrips, level),
    prepared: atLevel(spellcasting.prepared, level),
    ability: spellcasting.ability
  };
}

module.exports = {
  SPELL_SLOT_TABLE,
  getSpellSlots,
  getSpellsKnown,
  spellcastingFor
};
