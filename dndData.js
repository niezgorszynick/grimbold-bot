// dndData.js — Canonical D&D 2024 (Revised 5e) Reference Data

const rules = require('./rules');

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
    ],
    skillProficiencies: ['Perception']
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
    ],
    skillChoiceCount: 1
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

const DND_DATA = {
  // Class, background and multiclass rules live in ./rules (levels 1–20, 2024 PHB).
  classes: rules.CLASSES,
  supplementalClasses: rules.SUPPLEMENTAL_CLASSES,
  species: DND_SPECIES_DATA,
  backgrounds: rules.BACKGROUNDS,
  abilityScores: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
  generationMethods: ['Standard Array', 'Manual/Rolled', 'Point Buy'],
  getProficiencyBonus: level => Math.ceil(level / 4) + 1,
  getModifier: score => Math.floor((score - 10) / 2)
};

const POINT_BUY_COSTS = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9
};

const TOTAL_POINT_BUY_POINTS = 27;

const STANDARD_ARRAY_SUGGESTIONS = {
  Barbarian: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
  Bard: { str: 8, dex: 14, con: 12, int: 13, wis: 10, cha: 15 },
  Cleric: { str: 14, dex: 8, con: 13, int: 10, wis: 15, cha: 12 },
  Druid: { str: 8, dex: 12, con: 14, int: 13, wis: 15, cha: 10 },
  Fighter: { str: 15, dex: 14, con: 13, int: 8, wis: 10, cha: 12 },
  Monk: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
  Paladin: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  Ranger: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  Rogue: { str: 12, dex: 15, con: 13, int: 14, wis: 10, cha: 8 },
  Sorcerer: { str: 10, dex: 13, con: 14, int: 8, wis: 12, cha: 15 },
  Warlock: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  Wizard: { str: 8, dex: 12, con: 13, int: 15, wis: 14, cha: 10 }
};

function calculatePointBuyCost(baseScores) {
  if (!baseScores || typeof baseScores !== 'object' || Array.isArray(baseScores)) {
    throw new Error('Point Buy ability scores must be an object.');
  }

  let totalSpent = 0;
  for (const ability of DND_DATA.abilityScores) {
    const score = baseScores[ability];
    if (!Number.isInteger(score) || score < 8 || score > 15) {
      throw new Error(`Score for ${ability.toUpperCase()} must be between 8 and 15.`);
    }
    totalSpent += POINT_BUY_COSTS[score];
  }
  return totalSpent;
}

function validatePointBuy(pointBuy) {
  if (!pointBuy || typeof pointBuy !== 'object' || Array.isArray(pointBuy)) {
    throw new Error('Point Buy data must be an object.');
  }
  const { baseScores, background, bonusMode, bonusAbilities } = pointBuy;
  const pointsSpent = calculatePointBuyCost(baseScores);
  if (pointsSpent !== TOTAL_POINT_BUY_POINTS) {
    throw new Error(`Point Buy must spend exactly ${TOTAL_POINT_BUY_POINTS} points (currently spent: ${pointsSpent}).`);
  }
  if (typeof background !== 'string') {
    throw new Error('Select a valid D&D 2024 background for Point Buy bonuses.');
  }

  const canonicalBackground = Object.keys(DND_DATA.backgrounds)
    .find(name => normalizeName(name) === normalizeName(background));
  if (!canonicalBackground) {
    throw new Error('Select a valid D&D 2024 background for Point Buy bonuses.');
  }
  if (!Array.isArray(bonusAbilities)) {
    throw new Error('Background ability bonuses must be a list.');
  }
  const expectedBonusCount = bonusMode === '2+1' ? 2 : bonusMode === '1+1+1' ? 3 : 0;
  if (!expectedBonusCount || bonusAbilities.length !== expectedBonusCount) {
    throw new Error('Choose either +2/+1 or +1/+1/+1 background bonuses.');
  }

  const allowedAbilities = DND_DATA.backgrounds[canonicalBackground].abilityBoosts;
  const selectedAbilities = bonusAbilities.map(ability =>
    typeof ability === 'string' ? ability.toLowerCase() : ''
  );
  if (
    selectedAbilities.some(ability => !allowedAbilities.includes(ability)) ||
    new Set(selectedAbilities).size !== selectedAbilities.length
  ) {
    throw new Error('Background bonuses must apply to distinct abilities allowed by that background.');
  }

  const abilities = { ...baseScores };
  if (bonusMode === '2+1') {
    abilities[selectedAbilities[0]] += 2;
    abilities[selectedAbilities[1]] += 1;
  } else {
    selectedAbilities.forEach(ability => { abilities[ability] += 1; });
  }
  if (Object.values(abilities).some(score => score > 20)) {
    throw new Error('No ability score can exceed 20 after background bonuses.');
  }

  return {
    background: canonicalBackground,
    bonusMode,
    bonusAbilities: selectedAbilities,
    baseScores: { ...baseScores },
    pointsSpent,
    abilities
  };
}

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
  MULTICLASS_REQUIREMENTS: rules.MULTICLASS_REQUIREMENTS,
  MULTICLASS_PROFICIENCIES: rules.MULTICLASS_PROFICIENCIES,
  validateCharacterOptions,
  POINT_BUY_COSTS,
  TOTAL_POINT_BUY_POINTS,
  STANDARD_ARRAY_SUGGESTIONS,
  calculatePointBuyCost,
  validatePointBuy,
  getAbilityModifier: DND_DATA.getModifier
};