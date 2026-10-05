// dndData.js — Canonical D&D 2024 (Revised 5e) Reference Data

// Official 2024 Core Species
const DND_SPECIES = [
  'Aasimar',
  'Dragonborn',
  'Dwarf',
  'Elf',
  'Gnome',
  'Goliath',
  'Halfling',
  'Human',
  'Orc',
  'Tiefling'
];

// Official 2024 Classes & Subclasses (4 per class in 2024 PHB)
const DND_CLASSES_AND_SUBCLASSES = {
  'Artificer': [
    'Alchemist',
    'Armorer',
    'Artillerist',
    'Battle Smith',
    'Cartographer',
    'Reanimator'
  ],
  'Barbarian': [
    'Path of the Berserker',
    'Path of the Wild Heart',
    'Path of the World Tree',
    'Path of the Zealot'
  ],
  'Bard': [
    'College of Dance',
    'College of Glamour',
    'College of Lore',
    'College of Valor'
  ],
  'Cleric': [
    'Life Domain',
    'Light Domain',
    'Trickery Domain',
    'War Domain'
  ],
  'Druid': [
    'Circle of the Land',
    'Circle of the Moon',
    'Circle of the Sea',
    'Circle of the Stars'
  ],
  'Fighter': [
    'Battle Master',
    'Champion',
    'Eldritch Knight',
    'Psi Warrior'
  ],
  'Monk': [
    'Warrior of Mercy',
    'Warrior of Shadow',
    'Warrior of the Elements',
    'Warrior of the Open Hand'
  ],
  'Paladin': [
    'Oath of Devotion',
    'Oath of Glory',
    'Oath of the Ancients',
    'Oath of Vengeance'
  ],
  'Ranger': [
    'Beast Master',
    'Fey Wanderer',
    'Gloom Stalker',
    'Hunter'
  ],
  'Rogue': [
    'Arcane Trickster',
    'Assassin',
    'Soulknife',
    'Thief'
  ],
  'Sorcerer': [
    'Aberrant Sorcery',
    'Clockwork Sorcery',
    'Draconic Sorcery',
    'Wild Magic Sorcery'
  ],
  'Warlock': [
    'Archfey Patron',
    'Celestial Patron',
    'Fiend Patron',
    'Great Old One Patron'
  ],
  'Wizard': [
    'Abjurer',
    'Diviner',
    'Evoker',
    'Illusionist'
  ]
};

const MULTICLASS_REQUIREMENTS = {
  Artificer: { abilities: ['intelligence'], minScore: 13 },
  Barbarian: { abilities: ['strength'], minScore: 13 },
  Bard: { abilities: ['charisma'], minScore: 13 },
  Cleric: { abilities: ['wisdom'], minScore: 13 },
  Druid: { abilities: ['wisdom'], minScore: 13 },
  Fighter: { abilities: ['strength', 'dexterity'], logic: 'OR', minScore: 13 },
  Monk: { abilities: ['dexterity', 'wisdom'], logic: 'AND', minScore: 13 },
  Paladin: { abilities: ['strength', 'charisma'], logic: 'AND', minScore: 13 },
  Ranger: { abilities: ['dexterity', 'wisdom'], logic: 'AND', minScore: 13 },
  Rogue: { abilities: ['dexterity'], minScore: 13 },
  Sorcerer: { abilities: ['charisma'], minScore: 13 },
  Warlock: { abilities: ['charisma'], minScore: 13 },
  Wizard: { abilities: ['intelligence'], minScore: 13 }
};

const MULTICLASS_PROFICIENCIES = {
  Artificer: { lightArmor: true, mediumArmor: true, shields: true },
  Barbarian: { shields: true, martialWeapons: true },
  Bard: { lightArmor: true, oneSkillOfChoice: true },
  Cleric: { lightArmor: true, mediumArmor: true, shields: true },
  Druid: { lightArmor: true, mediumArmor: true, shields: true },
  Fighter: { lightArmor: true, mediumArmor: true, shields: true, martialWeapons: true },
  Monk: { simpleWeapons: true, martialWeaponsLight: true },
  Paladin: { lightArmor: true, mediumArmor: true, shields: true, martialWeapons: true },
  Ranger: { lightArmor: true, mediumArmor: true, shields: true, martialWeapons: true, oneSkillFromList: true },
  Rogue: { lightArmor: true, oneSkillFromList: true, thievesTools: true },
  Sorcerer: {},
  Warlock: { lightArmor: true, simpleWeapons: true },
  Wizard: {}
};

function normalizeName(input) {
  return (input || '').trim().toLowerCase();
}

function validateCharacterOptions(species, className, subclass) {
  const normSpecies = normalizeName(species);
  const matchedSpecies = DND_SPECIES.find(s => normalizeName(s) === normSpecies);
  if (!matchedSpecies) {
    throw new Error(`Invalid species "${species}". Please select a canonical D&D 2024 species.`);
  }

  const normClass = normalizeName(className);
  const matchedClass = Object.keys(DND_CLASSES_AND_SUBCLASSES).find(c => normalizeName(c) === normClass);
  if (!matchedClass) {
    throw new Error(`Invalid class "${className}". Please select a canonical D&D 2024 class.`);
  }

  let matchedSubclass = '';
  if (subclass && subclass.trim() !== '') {
    const validSubclasses = DND_CLASSES_AND_SUBCLASSES[matchedClass];
    const normSubclass = normalizeName(subclass);
    matchedSubclass = validSubclasses.find(sub => normalizeName(sub) === normSubclass);
    if (!matchedSubclass) {
      throw new Error(`Invalid subclass "${subclass}" for 2024 ${matchedClass}.`);
    }
  }

  return {
    canonicalSpecies: matchedSpecies,
    canonicalClass: matchedClass,
    canonicalSubclass: matchedSubclass
  };
}

module.exports = {
  DND_SPECIES,
  DND_CLASSES_AND_SUBCLASSES,
  MULTICLASS_REQUIREMENTS,
  MULTICLASS_PROFICIENCIES,
  validateCharacterOptions
};