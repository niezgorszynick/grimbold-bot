// rules/multiclass.js — Multiclass prerequisites and proficiencies (2024 PHB).
//
// To add a class you need a score of 13+ in the primary ability of every class
// you already have AND of the new class.

const MULTICLASS_REQUIREMENTS = {
  Artificer: { abilities: ['int'] },
  Barbarian: { abilities: ['str'] },
  Bard: { abilities: ['cha'] },
  Cleric: { abilities: ['wis'] },
  Druid: { abilities: ['wis'] },
  Fighter: { abilities: ['str', 'dex'], logic: 'OR' },
  Monk: { abilities: ['dex', 'wis'], logic: 'AND' },
  Paladin: { abilities: ['str', 'cha'], logic: 'AND' },
  Ranger: { abilities: ['dex', 'wis'], logic: 'AND' },
  Rogue: { abilities: ['dex'] },
  Sorcerer: { abilities: ['cha'] },
  Warlock: { abilities: ['cha'] },
  Wizard: { abilities: ['int'] }
};
const MULTICLASS_MIN_SCORE = 13;

// Proficiencies gained when a class is added as a second (or later) class.
const MULTICLASS_PROFICIENCIES = {
  Artificer: { armor: ['Light armor', 'Medium armor', 'Shields'], tools: ["Thieves' Tools", "Tinker's Tools"] },
  Barbarian: { armor: ['Shields'], weapons: ['Martial weapons'] },
  Bard: { armor: ['Light armor'], skillChoices: { count: 1, options: 'any' }, toolChoices: { count: 1, category: 'instrument' } },
  Cleric: { armor: ['Light armor', 'Medium armor', 'Shields'] },
  Druid: { armor: ['Light armor', 'Shields'] },
  Fighter: { armor: ['Light armor', 'Medium armor', 'Shields'], weapons: ['Martial weapons'] },
  Monk: {},
  Paladin: { armor: ['Light armor', 'Medium armor', 'Shields'], weapons: ['Martial weapons'] },
  Ranger: {
    armor: ['Light armor', 'Medium armor', 'Shields'],
    weapons: ['Martial weapons'],
    skillChoices: { count: 1, options: 'class' }
  },
  Rogue: { armor: ['Light armor'], tools: ["Thieves' Tools"], skillChoices: { count: 1, options: 'class' } },
  Sorcerer: {},
  Warlock: { armor: ['Light armor'] },
  Wizard: {}
};

function meetsRequirement(className, scores) {
  const requirement = MULTICLASS_REQUIREMENTS[className];
  if (!requirement) return false;
  const passes = ability => (scores[ability] || 0) >= MULTICLASS_MIN_SCORE;
  return requirement.logic === 'OR'
    ? requirement.abilities.some(passes)
    : requirement.abilities.every(passes);
}

// Returns { allowed, missing: [class names whose prerequisite fails] }.
function checkMulticlass({ currentClasses, newClass, scores }) {
  const toCheck = [...new Set([...currentClasses, newClass])];
  const missing = toCheck.filter(className => !meetsRequirement(className, scores));
  return { allowed: missing.length === 0, missing };
}

module.exports = {
  MULTICLASS_REQUIREMENTS,
  MULTICLASS_MIN_SCORE,
  MULTICLASS_PROFICIENCIES,
  checkMulticlass
};
