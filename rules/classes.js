// rules/classes.js — 2024 class progressions, levels 1–20.
//
// featuresByLevel is assembled from each class's core features plus the shared
// structure: the subclass choice, subclass feature levels, Ability Score
// Improvements, and the Epic Boon at level 19.
//
// Per-level tables (cantrips, prepared spells, resources) are 20-entry arrays
// indexed by level - 1; use atLevel() from ./util to read them.

const { byLevel, normalizeItems } = require('./util');

const SUBCLASS_LEVEL = 3;
const STANDARD_ASI_LEVELS = [4, 8, 12, 16];
const EPIC_BOON_LEVEL = 19;

// Prepared-spell tables shared by several classes.
const FULL_CASTER_PREPARED = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const HALF_CASTER_PREPARED = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];

const RAW_CLASSES = {
  Barbarian: {
    hitDie: 12,
    primaryAbilities: ['str'],
    savingThrows: ['str', 'con'],
    skillChoices: { count: 2, options: ['Animal Handling', 'Athletics', 'Intimidation', 'Nature', 'Perception', 'Survival'] },
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    armorTraining: ['Light armor', 'Medium armor', 'Shields'],
    toolProficiencies: {},
    startingEquipment: {
      A: { items: ['Greataxe', ['Handaxe', 4], "Explorer's Pack"], gp: 15 },
      B: { items: [], gp: 75 }
    },
    subclassFeatureLevels: [3, 6, 10, 14],
    resources: {
      rages: byLevel({ 1: 2, 3: 3, 6: 4, 12: 5, 17: 6 }),
      rageDamage: byLevel({ 1: 2, 9: 3, 16: 4 }),
      weaponMastery: byLevel({ 1: 2, 4: 3, 10: 4 })
    },
    features: {
      1: ['Rage', 'Unarmored Defense', 'Weapon Mastery'],
      2: ['Danger Sense', 'Reckless Attack'],
      3: ['Primal Knowledge'],
      5: ['Extra Attack', 'Fast Movement'],
      7: ['Feral Instinct', 'Instinctive Pounce'],
      9: ['Brutal Strike'],
      11: ['Relentless Rage'],
      13: ['Improved Brutal Strike'],
      15: ['Persistent Rage'],
      17: ['Improved Brutal Strike'],
      18: ['Indomitable Might'],
      20: ['Primal Champion']
    }
  },
  Bard: {
    hitDie: 8,
    primaryAbilities: ['cha'],
    savingThrows: ['dex', 'cha'],
    skillChoices: { count: 3, options: 'any' },
    weaponProficiencies: ['Simple weapons'],
    armorTraining: ['Light armor'],
    toolProficiencies: { choose: { count: 3, category: 'instrument' } },
    startingEquipment: {
      A: { items: ['Leather Armor', ['Dagger', 2], { name: 'Musical Instrument', choose: 'instrument' }, "Entertainer's Pack"], gp: 19 },
      B: { items: [], gp: 90 }
    },
    subclassFeatureLevels: [3, 6, 14],
    spellcasting: {
      progression: 'full',
      ability: 'cha',
      cantrips: byLevel({ 1: 2, 4: 3, 10: 4 }),
      prepared: FULL_CASTER_PREPARED
    },
    resources: {
      bardicInspirationDie: byLevel({ 1: 6, 5: 8, 10: 10, 15: 12 })
    },
    features: {
      1: ['Bardic Inspiration', 'Spellcasting'],
      2: ['Expertise', 'Jack of All Trades'],
      5: ['Font of Inspiration'],
      7: ['Countercharm'],
      9: ['Expertise'],
      10: ['Magical Secrets'],
      18: ['Superior Inspiration'],
      20: ['Words of Creation']
    }
  },
  Cleric: {
    hitDie: 8,
    primaryAbilities: ['wis'],
    savingThrows: ['wis', 'cha'],
    skillChoices: { count: 2, options: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'] },
    weaponProficiencies: ['Simple weapons'],
    armorTraining: ['Light armor', 'Medium armor', 'Shields'],
    toolProficiencies: {},
    startingEquipment: {
      A: { items: ['Chain Shirt', 'Shield', 'Mace', 'Holy Symbol', "Priest's Pack"], gp: 7 },
      B: { items: [], gp: 110 }
    },
    subclassFeatureLevels: [3, 6, 17],
    spellcasting: {
      progression: 'full',
      ability: 'wis',
      cantrips: byLevel({ 1: 3, 4: 4, 10: 5 }),
      prepared: FULL_CASTER_PREPARED
    },
    resources: {
      channelDivinity: byLevel({ 2: 2, 6: 3, 18: 4 })
    },
    features: {
      1: ['Divine Order', 'Spellcasting'],
      2: ['Channel Divinity'],
      5: ['Sear Undead'],
      7: ['Blessed Strikes'],
      10: ['Divine Intervention'],
      14: ['Improved Blessed Strikes'],
      20: ['Greater Divine Intervention']
    }
  },
  Druid: {
    hitDie: 8,
    primaryAbilities: ['wis'],
    savingThrows: ['int', 'wis'],
    skillChoices: { count: 2, options: ['Arcana', 'Animal Handling', 'Insight', 'Medicine', 'Nature', 'Perception', 'Religion', 'Survival'] },
    weaponProficiencies: ['Simple weapons'],
    armorTraining: ['Light armor', 'Shields'],
    toolProficiencies: { fixed: ['Herbalism Kit'] },
    startingEquipment: {
      A: { items: ['Leather Armor', 'Shield', 'Sickle', 'Druidic Focus (Quarterstaff)', "Explorer's Pack", 'Herbalism Kit'], gp: 9 },
      B: { items: [], gp: 50 }
    },
    subclassFeatureLevels: [3, 6, 10, 14],
    spellcasting: {
      progression: 'full',
      ability: 'wis',
      cantrips: byLevel({ 1: 2, 4: 3, 10: 4 }),
      prepared: FULL_CASTER_PREPARED
    },
    resources: {
      wildShape: byLevel({ 2: 2, 6: 3, 17: 4 })
    },
    features: {
      1: ['Druidic', 'Primal Order', 'Spellcasting'],
      2: ['Wild Shape', 'Wild Companion'],
      5: ['Wild Resurgence'],
      7: ['Elemental Fury'],
      15: ['Improved Elemental Fury'],
      18: ['Beast Spells'],
      20: ['Archdruid']
    }
  },
  Fighter: {
    hitDie: 10,
    primaryAbilities: ['str', 'dex'],
    savingThrows: ['str', 'con'],
    skillChoices: { count: 2, options: ['Acrobatics', 'Animal Handling', 'Athletics', 'History', 'Insight', 'Intimidation', 'Persuasion', 'Perception', 'Survival'] },
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    armorTraining: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'],
    toolProficiencies: {},
    startingEquipment: {
      A: { items: ['Chain Mail', 'Greatsword', 'Flail', ['Javelin', 8], "Dungeoneer's Pack"], gp: 4 },
      B: { items: ['Studded Leather Armor', 'Scimitar', 'Shortsword', 'Longbow', ['Arrow', 20], 'Quiver', "Dungeoneer's Pack"], gp: 11 },
      C: { items: [], gp: 155 }
    },
    extraAsiLevels: [6, 14],
    subclassFeatureLevels: [3, 7, 10, 15, 18],
    resources: {
      secondWind: byLevel({ 1: 2, 4: 3, 10: 4 }),
      actionSurge: byLevel({ 2: 1, 17: 2 }),
      indomitable: byLevel({ 9: 1, 13: 2, 17: 3 }),
      weaponMastery: byLevel({ 1: 3, 4: 4, 10: 5, 16: 6 })
    },
    features: {
      1: ['Fighting Style', 'Second Wind', 'Weapon Mastery'],
      2: ['Action Surge', 'Tactical Mind'],
      5: ['Extra Attack', 'Tactical Shift'],
      9: ['Indomitable', 'Tactical Master'],
      11: ['Two Extra Attacks'],
      13: ['Studied Attacks'],
      20: ['Three Extra Attacks']
    }
  },
  Monk: {
    hitDie: 8,
    primaryAbilities: ['dex', 'wis'],
    savingThrows: ['str', 'dex'],
    skillChoices: { count: 2, options: ['Acrobatics', 'Athletics', 'History', 'Insight', 'Religion', 'Stealth'] },
    weaponProficiencies: ['Simple weapons', 'Martial weapons with the Light property'],
    armorTraining: [],
    toolProficiencies: { choose: { count: 1, category: ['artisan', 'instrument'] } },
    startingEquipment: {
      A: { items: ['Spear', ['Dagger', 5], { name: "Artisan's Tools or Musical Instrument", fromToolChoice: true }, "Explorer's Pack"], gp: 11 },
      B: { items: [], gp: 50 }
    },
    subclassFeatureLevels: [3, 6, 11, 17],
    resources: {
      martialArtsDie: byLevel({ 1: 6, 5: 8, 11: 10, 17: 12 }),
      focusPoints: byLevel({ 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14, 15: 15, 16: 16, 17: 17, 18: 18, 19: 19, 20: 20 }),
      unarmoredMovement: byLevel({ 2: 10, 6: 15, 10: 20, 14: 25, 18: 30 })
    },
    features: {
      1: ['Martial Arts', 'Unarmored Defense'],
      2: ["Monk's Focus", 'Unarmored Movement', 'Uncanny Metabolism'],
      3: ['Deflect Attacks'],
      4: ['Slow Fall'],
      5: ['Extra Attack', 'Stunning Strike'],
      6: ['Empowered Strikes'],
      7: ['Evasion'],
      9: ['Acrobatic Movement'],
      10: ['Heightened Focus', 'Self-Restoration'],
      13: ['Deflect Energy'],
      14: ['Disciplined Survivor'],
      15: ['Perfect Focus'],
      18: ['Superior Defense'],
      20: ['Body and Mind']
    }
  },
  Paladin: {
    hitDie: 10,
    primaryAbilities: ['str', 'cha'],
    savingThrows: ['wis', 'cha'],
    skillChoices: { count: 2, options: ['Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion'] },
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    armorTraining: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'],
    toolProficiencies: {},
    startingEquipment: {
      A: { items: ['Chain Mail', 'Shield', 'Longsword', ['Javelin', 6], 'Holy Symbol', "Priest's Pack"], gp: 9 },
      B: { items: [], gp: 150 }
    },
    subclassFeatureLevels: [3, 7, 15, 20],
    spellcasting: {
      progression: 'half',
      ability: 'cha',
      cantrips: byLevel({}),
      prepared: HALF_CASTER_PREPARED
    },
    resources: {
      channelDivinity: byLevel({ 3: 2, 11: 3 }),
      weaponMastery: byLevel({ 1: 2 })
    },
    features: {
      1: ['Lay On Hands', 'Spellcasting', 'Weapon Mastery'],
      2: ['Fighting Style', "Paladin's Smite"],
      3: ['Channel Divinity'],
      5: ['Extra Attack', 'Faithful Steed'],
      6: ['Aura of Protection'],
      9: ['Abjure Foes'],
      10: ['Aura of Courage'],
      11: ['Radiant Strikes'],
      14: ['Restoring Touch'],
      18: ['Aura Expansion']
    }
  },
  Ranger: {
    hitDie: 10,
    primaryAbilities: ['dex', 'wis'],
    savingThrows: ['str', 'dex'],
    skillChoices: { count: 3, options: ['Animal Handling', 'Athletics', 'Insight', 'Investigation', 'Nature', 'Perception', 'Stealth', 'Survival'] },
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    armorTraining: ['Light armor', 'Medium armor', 'Shields'],
    toolProficiencies: {},
    startingEquipment: {
      A: { items: ['Studded Leather Armor', 'Scimitar', 'Shortsword', 'Longbow', ['Arrow', 20], 'Quiver', 'Druidic Focus (sprig of mistletoe)', "Explorer's Pack"], gp: 7 },
      B: { items: [], gp: 150 }
    },
    subclassFeatureLevels: [3, 7, 11, 15],
    spellcasting: {
      progression: 'half',
      ability: 'wis',
      cantrips: byLevel({}),
      prepared: HALF_CASTER_PREPARED
    },
    resources: {
      favoredEnemy: byLevel({ 1: 2, 5: 3, 9: 4, 13: 5, 17: 6 }),
      weaponMastery: byLevel({ 1: 2 })
    },
    features: {
      1: ['Favored Enemy', 'Spellcasting', 'Weapon Mastery'],
      2: ['Deft Explorer', 'Fighting Style'],
      5: ['Extra Attack'],
      6: ['Roving'],
      9: ['Expertise'],
      10: ['Tireless'],
      13: ['Relentless Hunter'],
      14: ["Nature's Veil"],
      17: ['Precise Hunter'],
      18: ['Feral Senses'],
      20: ['Foe Slayer']
    }
  },
  Rogue: {
    hitDie: 8,
    primaryAbilities: ['dex'],
    savingThrows: ['dex', 'int'],
    skillChoices: { count: 4, options: ['Acrobatics', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Perception', 'Persuasion', 'Sleight of Hand', 'Stealth'] },
    weaponProficiencies: ['Simple weapons', 'Martial weapons with the Finesse or Light property'],
    armorTraining: ['Light armor'],
    toolProficiencies: { fixed: ["Thieves' Tools"] },
    startingEquipment: {
      A: { items: ['Leather Armor', ['Dagger', 2], 'Shortsword', 'Shortbow', ['Arrow', 20], 'Quiver', "Thieves' Tools", "Burglar's Pack"], gp: 8 },
      B: { items: [], gp: 100 }
    },
    extraAsiLevels: [10],
    subclassFeatureLevels: [3, 9, 13, 17],
    resources: {
      sneakAttackDice: byLevel({ 1: 1, 3: 2, 5: 3, 7: 4, 9: 5, 11: 6, 13: 7, 15: 8, 17: 9, 19: 10 }),
      weaponMastery: byLevel({ 1: 2 })
    },
    features: {
      1: ['Expertise', 'Sneak Attack', "Thieves' Cant", 'Weapon Mastery'],
      2: ['Cunning Action'],
      3: ['Steady Aim'],
      5: ['Cunning Strike', 'Uncanny Dodge'],
      6: ['Expertise'],
      7: ['Evasion', 'Reliable Talent'],
      11: ['Improved Cunning Strike'],
      14: ['Devious Strikes'],
      15: ['Slippery Mind'],
      18: ['Elusive'],
      20: ['Stroke of Luck']
    }
  },
  Sorcerer: {
    hitDie: 6,
    primaryAbilities: ['cha'],
    savingThrows: ['con', 'cha'],
    skillChoices: { count: 2, options: ['Arcana', 'Deception', 'Insight', 'Intimidation', 'Persuasion', 'Religion'] },
    weaponProficiencies: ['Simple weapons'],
    armorTraining: [],
    toolProficiencies: {},
    startingEquipment: {
      A: { items: ['Spear', ['Dagger', 2], 'Arcane Focus (crystal)', "Dungeoneer's Pack"], gp: 28 },
      B: { items: [], gp: 50 }
    },
    subclassFeatureLevels: [3, 6, 14, 18],
    spellcasting: {
      progression: 'full',
      ability: 'cha',
      cantrips: byLevel({ 1: 4, 4: 5, 10: 6 }),
      prepared: [2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22]
    },
    resources: {
      sorceryPoints: byLevel({ 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14, 15: 15, 16: 16, 17: 17, 18: 18, 19: 19, 20: 20 })
    },
    features: {
      1: ['Innate Sorcery', 'Spellcasting'],
      2: ['Font of Magic', 'Metamagic'],
      5: ['Sorcerous Restoration'],
      7: ['Sorcery Incarnate'],
      10: ['Metamagic'],
      17: ['Metamagic'],
      20: ['Arcane Apotheosis']
    }
  },
  Warlock: {
    hitDie: 8,
    primaryAbilities: ['cha'],
    savingThrows: ['wis', 'cha'],
    skillChoices: { count: 2, options: ['Arcana', 'Deception', 'History', 'Intimidation', 'Investigation', 'Nature', 'Religion'] },
    weaponProficiencies: ['Simple weapons'],
    armorTraining: ['Light armor'],
    toolProficiencies: {},
    startingEquipment: {
      A: { items: ['Leather Armor', 'Sickle', ['Dagger', 2], 'Arcane Focus (orb)', 'Book (occult lore)', "Scholar's Pack"], gp: 15 },
      B: { items: [], gp: 100 }
    },
    subclassFeatureLevels: [3, 6, 10, 14],
    spellcasting: {
      progression: 'pact',
      ability: 'cha',
      cantrips: byLevel({ 1: 2, 4: 3, 10: 4 }),
      prepared: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15]
    },
    resources: {
      invocations: [1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10]
    },
    features: {
      1: ['Eldritch Invocations', 'Pact Magic'],
      2: ['Magical Cunning'],
      9: ['Contact Patron'],
      11: ['Mystic Arcanum (level 6 spell)'],
      13: ['Mystic Arcanum (level 7 spell)'],
      15: ['Mystic Arcanum (level 8 spell)'],
      17: ['Mystic Arcanum (level 9 spell)'],
      20: ['Eldritch Master']
    }
  },
  Wizard: {
    hitDie: 6,
    primaryAbilities: ['int'],
    savingThrows: ['int', 'wis'],
    skillChoices: { count: 2, options: ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Nature', 'Religion'] },
    weaponProficiencies: ['Simple weapons'],
    armorTraining: [],
    toolProficiencies: {},
    startingEquipment: {
      A: { items: [['Dagger', 2], 'Arcane Focus (Quarterstaff)', 'Robe', 'Spellbook', "Scholar's Pack"], gp: 5 },
      B: { items: [], gp: 55 }
    },
    subclassFeatureLevels: [3, 6, 10, 14],
    spellcasting: {
      progression: 'full',
      ability: 'int',
      cantrips: byLevel({ 1: 3, 4: 4, 10: 5 }),
      prepared: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25]
    },
    resources: {},
    features: {
      1: ['Arcane Recovery', 'Ritual Adept', 'Spellcasting'],
      2: ['Scholar'],
      5: ['Memorize Spell'],
      18: ['Spell Mastery'],
      20: ['Signature Spells']
    }
  }
};

// Artificer (Eberron: Forge of the Artificer). Feature names and tables should be
// checked against the book text when it is added to rules/content/classes.md.
const RAW_SUPPLEMENTAL_CLASSES = {
  Artificer: {
    hitDie: 8,
    primaryAbilities: ['int'],
    savingThrows: ['con', 'int'],
    skillChoices: { count: 2, options: ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Sleight of Hand'] },
    weaponProficiencies: ['Simple weapons'],
    armorTraining: ['Light armor', 'Medium armor', 'Shields'],
    toolProficiencies: { fixed: ["Thieves' Tools", "Tinker's Tools"], choose: { count: 1, category: 'artisan' } },
    startingEquipment: {
      A: { items: ['Studded Leather Armor', 'Dagger', "Thieves' Tools", "Tinker's Tools", "Dungeoneer's Pack"], gp: 16 },
      B: { items: [], gp: 150 }
    },
    subclassFeatureLevels: [3, 5, 9, 15],
    spellcasting: {
      progression: 'half',
      ability: 'int',
      cantrips: byLevel({ 1: 2, 10: 3, 14: 4 }),
      prepared: HALF_CASTER_PREPARED
    },
    resources: {},
    features: {
      1: ['Spellcasting', "Tinker's Magic"],
      2: ['Replicate Magic Item'],
      6: ['Magic Item Tinker'],
      7: ['Flash of Genius'],
      10: ['Magic Item Adept'],
      11: ['Spell-Storing Item'],
      14: ['Advanced Artifice'],
      18: ['Magic Item Master'],
      20: ['Soul of Artifice']
    },
    needsVerification: true
  }
};

// Subclasses that turn a non-caster into a one-third caster.
const SUBCLASS_SPELLCASTING = {
  'Eldritch Knight': {
    progression: 'third',
    ability: 'int',
    cantrips: byLevel({ 3: 2, 10: 3 }),
    prepared: byLevel({ 3: 3, 4: 4, 7: 5, 8: 6, 10: 7, 11: 8, 13: 9, 14: 10, 16: 11, 19: 12, 20: 13 })
  },
  'Arcane Trickster': {
    progression: 'third',
    ability: 'int',
    cantrips: byLevel({ 3: 3, 10: 4 }),
    prepared: byLevel({ 3: 3, 4: 4, 7: 5, 8: 6, 10: 7, 11: 8, 13: 9, 14: 10, 16: 11, 19: 12, 20: 13 })
  }
};

function getAsiLevels(classData) {
  return [...STANDARD_ASI_LEVELS, ...(classData.extraAsiLevels || [])].sort((a, b) => a - b);
}

function buildFeaturesByLevel(className, classData) {
  const asiLevels = getAsiLevels(classData);
  const featuresByLevel = {};
  for (let level = 1; level <= 20; level += 1) {
    const features = [...(classData.features[level] || [])];
    if (level === SUBCLASS_LEVEL) features.push(`${className} Subclass`);
    else if (classData.subclassFeatureLevels.includes(level)) features.push('Subclass Feature');
    if (asiLevels.includes(level)) features.push('Ability Score Improvement');
    if (level === EPIC_BOON_LEVEL) features.push('Epic Boon');
    if (features.length) featuresByLevel[level] = features;
  }
  return featuresByLevel;
}

function finalizeClass(className, classData) {
  const startingEquipment = Object.fromEntries(
    Object.entries(classData.startingEquipment).map(([option, pack]) => [
      option,
      { items: normalizeItems(pack.items), gp: pack.gp }
    ])
  );
  return {
    ...classData,
    // Legacy string form kept for existing sheet code ("1d12").
    hitDice: `1d${classData.hitDie}`,
    subclassLevel: SUBCLASS_LEVEL,
    asiLevels: getAsiLevels(classData),
    epicBoonLevel: EPIC_BOON_LEVEL,
    spellcasting: classData.spellcasting || null,
    startingEquipment,
    featuresByLevel: buildFeaturesByLevel(className, classData)
  };
}

const finalizeAll = raw => Object.fromEntries(
  Object.entries(raw).map(([name, data]) => [name, finalizeClass(name, data)])
);

const CLASSES = finalizeAll(RAW_CLASSES);
const SUPPLEMENTAL_CLASSES = finalizeAll(RAW_SUPPLEMENTAL_CLASSES);
const ALL_CLASSES = { ...CLASSES, ...SUPPLEMENTAL_CLASSES };

function getClass(className) {
  return ALL_CLASSES[className] || null;
}

// Features gained when reaching exactly classLevel in className.
function getFeaturesAtLevel(className, classLevel) {
  const classData = getClass(className);
  if (!classData) return [];
  return classData.featuresByLevel[classLevel] || [];
}

module.exports = {
  CLASSES,
  SUPPLEMENTAL_CLASSES,
  ALL_CLASSES,
  SUBCLASS_LEVEL,
  EPIC_BOON_LEVEL,
  SUBCLASS_SPELLCASTING,
  getClass,
  getFeaturesAtLevel
};
