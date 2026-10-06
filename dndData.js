// dndData.js — Canonical D&D 2024 (Revised 5e) Reference Data

// Official 2024 Core Species
const DND_SPECIES_DATA = {
  Aasimar: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Celestial Resistance', description: 'You resist radiant and necrotic damage.' },
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Healing Hands', description: 'Once per Long Rest, touch a creature to restore Hit Points by rolling a number of d4s equal to your Proficiency Bonus.' },
      { name: 'Light Bearer', description: 'You know the Light cantrip; Charisma is your spellcasting ability for it.' },
      { name: 'Celestial Revelation', description: 'Once per Long Rest, reveal your celestial nature for 1 minute, choosing an option that grants wings, radiant energy, or a frightening aura.' }
    ]
  },
  Dragonborn: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Draconic Ancestry', description: 'Choose a dragon ancestry; it determines the damage type and shape of your Breath Weapon.' },
      { name: 'Breath Weapon', description: 'Exhale damaging energy in a cone or line. Uses scale with your Proficiency Bonus and return after a Long Rest.' },
      { name: 'Damage Resistance', description: 'You resist the damage type associated with your draconic ancestry.' },
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' }
    ]
  },
  Dwarf: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 120 feet, though only in shades of gray.' },
      { name: 'Dwarven Resilience', description: 'You have advantage on saves against Poisoned and resistance to poison damage.' },
      { name: 'Dwarven Toughness', description: 'Your Hit Point maximum increases by 1 for each character level you have.' },
      { name: 'Stonecunning', description: 'As a Bonus Action, gain Tremorsense out to 60 feet for 10 minutes; uses scale with your Proficiency Bonus and return after a Long Rest.' }
    ]
  },
  Elf: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Elven Lineage', description: 'Choose a lineage—Drow, High Elf, or Wood Elf—which grants spells as you gain character levels.' },
      { name: 'Fey Ancestry', description: 'You have advantage on saves to avoid or end the Charmed condition on yourself.' },
      { name: 'Keen Senses', description: 'You have proficiency in the Perception skill.' },
      { name: 'Trance', description: 'You do not need to sleep, and magic cannot put you to sleep. Meditation lets you finish a Long Rest in 4 hours.' }
    ]
  },
  Gnome: {
    size: 'Small', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Gnomish Cunning', description: 'You have advantage on Intelligence, Wisdom, and Charisma saves against magical effects.' }
    ]
  },
  Goliath: {
    size: 'Medium', speed: 35, traits: [
      { name: 'Giant Ancestry', description: 'Choose a giant type to gain a special ability, such as teleporting, dealing elemental damage, or reducing incoming damage.' },
      { name: 'Large Form', description: 'As a Bonus Action, become Large for 10 minutes if space allows; your Speed increases by 10 feet. Uses scale with your Proficiency Bonus and return after a Long Rest.' },
      { name: 'Powerful Build', description: 'You have advantage on checks to end the Grappled condition, and count as one size larger when determining carrying capacity.' }
    ]
  },
  Halfling: {
    size: 'Small', speed: 30, traits: [
      { name: 'Brave', description: 'You have advantage on saves to avoid or end the Frightened condition on yourself.' },
      { name: 'Halfling Nimbleness', description: 'You can move through the space of a creature that is larger than you.' },
      { name: 'Lucky', description: 'When you roll a 1 on a d20 Test, you can reroll the die; you must use the new roll.' }
    ]
  },
  Human: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Resourceful', description: 'You gain Heroic Inspiration whenever you finish a Long Rest.' },
      { name: 'Skillful', description: 'You gain proficiency in one skill of your choice.' },
      { name: 'Versatile', description: 'You gain one Origin feat of your choice.' }
    ]
  },
  Orc: {
    size: 'Medium', speed: 30, traits: [
      { name: 'Adrenaline Rush', description: 'As a Bonus Action, move up to your Speed and gain Temporary Hit Points. Uses scale with your Proficiency Bonus and return after a Short or Long Rest.' },
      { name: 'Darkvision', description: 'You can see in darkness up to 120 feet, though only in shades of gray.' },
      { name: 'Relentless Endurance', description: 'When reduced to 0 Hit Points but not killed outright, drop to 1 Hit Point instead. Once per Long Rest.' }
    ]
  },
  Tiefling: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Fiendish Legacy', description: 'Choose an Abyssal, Chthonic, or Infernal legacy that grants spells as you gain character levels.' },
      { name: 'Otherworldly Presence', description: 'You know the Thaumaturgy cantrip; Charisma is your spellcasting ability for it.' }
    ]
  }
};
const DND_SPECIES = Object.keys(DND_SPECIES_DATA);

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

const DND_DATA = {
  // The 2024 Core Rules classes. Artificer remains available as a supplement below.
  classes: {
    Barbarian: { hitDice: '1d12', savingThrows: ['str', 'con'] },
    Bard: { hitDice: '1d8', savingThrows: ['dex', 'cha'] },
    Cleric: { hitDice: '1d8', savingThrows: ['wis', 'cha'] },
    Druid: { hitDice: '1d8', savingThrows: ['int', 'wis'] },
    Fighter: { hitDice: '1d10', savingThrows: ['str', 'con'] },
    Monk: { hitDice: '1d8', savingThrows: ['str', 'dex'] },
    Paladin: { hitDice: '1d10', savingThrows: ['wis', 'cha'] },
    Ranger: { hitDice: '1d10', savingThrows: ['str', 'dex'] },
    Rogue: { hitDice: '1d8', savingThrows: ['dex', 'int'] },
    Sorcerer: { hitDice: '1d6', savingThrows: ['con', 'cha'] },
    Warlock: { hitDice: '1d8', savingThrows: ['wis', 'cha'] },
    Wizard: { hitDice: '1d6', savingThrows: ['int', 'wis'] }
  },
  supplementalClasses: {
    Artificer: { hitDice: '1d8', savingThrows: ['con', 'int'] }
  },
  species: DND_SPECIES_DATA,
  backgrounds: {
    Acolyte: { abilityBoosts: ['int', 'wis', 'cha'], skillProficiencies: ['Insight', 'Religion'] },
    Criminal: { abilityBoosts: ['dex', 'con', 'int'], skillProficiencies: ['Sleight of Hand', 'Stealth'] },
    Sage: { abilityBoosts: ['con', 'int', 'wis'], skillProficiencies: ['Arcana', 'History'] },
    Soldier: { abilityBoosts: ['str', 'dex', 'con'], skillProficiencies: ['Athletics', 'Intimidation'] }
  },
  abilityScores: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
  generationMethods: ['Standard Array', 'Manual/Rolled', 'Point Buy'],
  getProficiencyBonus: level => Math.ceil(level / 4) + 1,
  getModifier: score => Math.floor((score - 10) / 2)
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
  DND_DATA,
  DND_CLASSES_AND_SUBCLASSES,
  MULTICLASS_REQUIREMENTS,
  MULTICLASS_PROFICIENCIES,
  validateCharacterOptions
};