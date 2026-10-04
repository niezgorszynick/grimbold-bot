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
  validateCharacterOptions
};