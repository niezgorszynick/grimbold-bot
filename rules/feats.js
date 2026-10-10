// rules/feats.js — Origin feats (2024 PHB) with the mechanical grants the engine applies.
//
// Also general feats and Epic Boons for Ability Score Improvement levels. Descriptive
// text comes from rules/content/feats.md once it is provided.

const ORIGIN_FEATS = {
  Alert: {
    repeatable: false,
    grants: { initiativeAddsProficiency: true }
  },
  Crafter: {
    repeatable: false,
    grants: { toolChoices: { count: 3, category: 'artisan' } }
  },
  Healer: {
    repeatable: false,
    grants: {}
  },
  Lucky: {
    repeatable: false,
    grants: { luckPointsEqualProficiency: true }
  },
  'Magic Initiate': {
    // Repeatable, but each copy must use a different spell list.
    repeatable: true,
    spellLists: ['Cleric', 'Druid', 'Wizard'],
    grants: { spells: { cantrips: 2, level1: 1, abilityChoices: ['int', 'wis', 'cha'] } }
  },
  Musician: {
    repeatable: false,
    grants: { toolChoices: { count: 3, category: 'instrument' } }
  },
  'Savage Attacker': {
    repeatable: false,
    grants: {}
  },
  Skilled: {
    repeatable: true,
    grants: { skillOrToolChoices: 3 }
  },
  'Tavern Brawler': {
    repeatable: false,
    grants: { unarmedStrikeDie: 'd4' }
  },
  Tough: {
    repeatable: false,
    grants: { hpPerLevel: 2 }
  }
};

const ORIGIN_FEAT_NAMES = Object.keys(ORIGIN_FEATS);

// General feats (level 4+) with prerequisites and the +1 ability increase each
// grants. prerequisite: { scores: [...] } needs 13+ in any listed ability,
// { spellcasting: true } needs Spellcasting or Pact Magic, { training: name }
// needs that armor training. Checked against the 2024 PHB feat text.
//
// grants used by the engine:
//   armorTraining / weaponProficiencies / tools — added to the sheet
//   skillChoice: { options } — a skill from the list (Expertise if already proficient)
//   skillChoices: n + expertise: n — Skill Expert
//   saveFromIncrease — Resilient
//   spells — spells the feat gives (handled by rules/spellbook.js)
const STR_DEX = ['str', 'dex'];
const MENTAL = ['int', 'wis', 'cha'];
const GENERAL_FEATS = {
  'Ability Score Improvement': { repeatable: true, abilityIncrease: null },
  Actor: { prerequisite: { scores: ['cha'] }, abilityIncrease: ['cha'] },
  Athlete: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  Charger: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  Chef: { abilityIncrease: ['con', 'wis'], grants: { tools: ["Cook's Utensils"] } },
  'Crossbow Expert': { prerequisite: { scores: ['dex'] }, abilityIncrease: ['dex'] },
  Crusher: { abilityIncrease: ['str', 'con'] },
  'Defensive Duelist': { prerequisite: { scores: ['dex'] }, abilityIncrease: ['dex'] },
  'Dual Wielder': { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  Durable: { abilityIncrease: ['con'] },
  'Elemental Adept': { repeatable: true, prerequisite: { spellcasting: true }, abilityIncrease: MENTAL },
  'Fey-Touched': {
    abilityIncrease: MENTAL,
    grants: { spells: { fixed: ['Misty Step'], choose: { count: 1, level: 1, schools: ['Divination', 'Enchantment'] }, freeEach: 1 } }
  },
  Grappler: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  'Great Weapon Master': { prerequisite: { scores: ['str'] }, abilityIncrease: ['str'] },
  'Heavily Armored': { prerequisite: { training: 'Medium armor' }, abilityIncrease: ['str', 'con'], grants: { armorTraining: ['Heavy armor'] } },
  'Heavy Armor Master': { prerequisite: { training: 'Heavy armor' }, abilityIncrease: ['str', 'con'] },
  'Inspiring Leader': { prerequisite: { scores: ['wis', 'cha'] }, abilityIncrease: ['wis', 'cha'] },
  'Keen Mind': {
    prerequisite: { scores: ['int'] },
    abilityIncrease: ['int'],
    grants: { skillChoice: { options: ['Arcana', 'History', 'Investigation', 'Nature', 'Religion'] } }
  },
  'Lightly Armored': { abilityIncrease: STR_DEX, grants: { armorTraining: ['Light armor', 'Shields'] } },
  'Mage Slayer': { abilityIncrease: STR_DEX },
  'Martial Weapon Training': { abilityIncrease: STR_DEX, grants: { weaponProficiencies: ['Martial weapons'] } },
  'Medium Armor Master': { prerequisite: { training: 'Medium armor' }, abilityIncrease: STR_DEX },
  'Moderately Armored': { prerequisite: { training: 'Light armor' }, abilityIncrease: STR_DEX, grants: { armorTraining: ['Medium armor', 'Shields'] } },
  'Mounted Combatant': { abilityIncrease: ['str', 'dex', 'wis'] },
  Observant: {
    prerequisite: { scores: ['int', 'wis'] },
    abilityIncrease: ['int', 'wis'],
    grants: { skillChoice: { options: ['Insight', 'Investigation', 'Perception'] } }
  },
  Piercer: { abilityIncrease: STR_DEX },
  Poisoner: { abilityIncrease: ['dex', 'int'], grants: { tools: ["Poisoner's Kit"] } },
  'Polearm Master': { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  // The increased ability also becomes a saving throw proficiency.
  Resilient: { abilityIncrease: 'any', grants: { saveFromIncrease: true } },
  'Ritual Caster': {
    prerequisite: { scores: MENTAL },
    abilityIncrease: MENTAL,
    grants: { spells: { choose: { count: 'proficiency', level: 1, ritual: true } } }
  },
  Sentinel: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  'Shadow-Touched': {
    abilityIncrease: MENTAL,
    grants: { spells: { fixed: ['Invisibility'], choose: { count: 1, level: 1, schools: ['Illusion', 'Necromancy'] }, freeEach: 1 } }
  },
  Sharpshooter: { prerequisite: { scores: ['dex'] }, abilityIncrease: ['dex'] },
  'Shield Master': { prerequisite: { training: 'Shields' }, abilityIncrease: ['str'] },
  'Skill Expert': { abilityIncrease: 'any', grants: { skillChoices: 1, expertise: 1 } },
  Skulker: { prerequisite: { scores: ['dex'] }, abilityIncrease: ['dex'] },
  Slasher: { abilityIncrease: STR_DEX },
  Speedy: { prerequisite: { scores: ['dex', 'con'] }, abilityIncrease: ['dex', 'con'] },
  'Spell Sniper': { prerequisite: { spellcasting: true }, abilityIncrease: MENTAL },
  Telekinetic: { abilityIncrease: MENTAL, grants: { spells: { cantrips: ['Mage Hand'] } } },
  Telepathic: { abilityIncrease: MENTAL, grants: { spells: { fixed: ['Detect Thoughts'], freeEach: 1 } } },
  'War Caster': { prerequisite: { spellcasting: true }, abilityIncrease: MENTAL },
  'Weapon Master': { abilityIncrease: STR_DEX }
};
const GENERAL_FEAT_LEVEL = 4;

// Fighting Style feats: chosen with the Fighting Style feature (Fighter 1,
// Paladin 2, Ranger 2) or at an Ability Score Improvement if you have it.
const FIGHTING_STYLE_FEATS = {
  Archery: {},
  'Blind Fighting': {},
  // +1 AC while wearing Light, Medium or Heavy armor.
  Defense: { grants: { armoredAcBonus: 1 } },
  Dueling: {},
  'Great Weapon Fighting': {},
  Interception: {},
  Protection: {},
  'Thrown Weapon Fighting': {},
  'Two-Weapon Fighting': {},
  'Unarmed Fighting': {}
};
const FIGHTING_STYLE_NAMES = Object.keys(FIGHTING_STYLE_FEATS);

// Classes whose Fighting Style feature lets them take Fighting Style feats.
const FIGHTING_STYLE_FEATURE_LEVELS = { Fighter: 1, Paladin: 2, Ranger: 2 };

function hasFightingStyleFeature(classes) {
  return classes.some(row => FIGHTING_STYLE_FEATURE_LEVELS[row.className] !== undefined &&
    row.level >= FIGHTING_STYLE_FEATURE_LEVELS[row.className]);
}

// Epic Boons (level 19+): +1 to an ability, up to 30.
const EPIC_BOONS = {
  'Boon of Combat Prowess': { abilityIncrease: 'any' },
  'Boon of Dimensional Travel': { abilityIncrease: 'any' },
  'Boon of Energy Resistance': { abilityIncrease: 'any' },
  'Boon of Fate': { abilityIncrease: 'any' },
  'Boon of Fortitude': { abilityIncrease: 'any', grants: { hpFlat: 40 } },
  'Boon of Irresistible Offense': { abilityIncrease: STR_DEX },
  'Boon of Recovery': { abilityIncrease: 'any' },
  'Boon of Skill': { abilityIncrease: 'any' },
  'Boon of Speed': { abilityIncrease: 'any' },
  'Boon of Spell Recall': { abilityIncrease: MENTAL, prerequisite: { spellcasting: true } },
  'Boon of the Night Spirit': { abilityIncrease: 'any' },
  'Boon of Truesight': { abilityIncrease: 'any' }
};
const EPIC_BOON_LEVEL_REQUIREMENT = 19;

// Earlier versions stored these names without the hyphen.
const FEAT_ALIASES = { 'Fey Touched': 'Fey-Touched', 'Shadow Touched': 'Shadow-Touched' };

// Feats may be stored as 'Tough' or { name: 'Magic Initiate', spellList: 'Wizard' }.
function featName(feat) {
  const name = typeof feat === 'string' ? feat : feat && feat.name;
  return FEAT_ALIASES[name] || name;
}

function featData(feat) {
  const name = featName(feat);
  return ORIGIN_FEATS[name] || GENERAL_FEATS[name] || EPIC_BOONS[name] || FIGHTING_STYLE_FEATS[name] || null;
}

function featGrants(feat) {
  const data = featData(feat);
  return (data && data.grants) || {};
}

// Every feat a character has: Origin feats, Fighting Style picks, feats from
// level-ups and from Lessons of the First Ones.
function collectCharacterFeats(sheetData) {
  const data = sheetData || {};
  const list = value => (Array.isArray(value) ? value : []);
  return [
    ...list(data.originFeats),
    ...list(data.fightingStyles),
    ...list(data.levelHistory).flatMap(entry => [entry.feat, entry.fightingStyle].filter(Boolean)),
    ...list(data.invocations).filter(entry => entry.feat).map(entry => entry.feat)
  ];
}

function hpPerLevelFromFeats(feats = []) {
  return feats.reduce((total, feat) => total + (featGrants(feat).hpPerLevel || 0), 0);
}

function hpFlatFromFeats(feats = []) {
  return feats.reduce((total, feat) => total + (featGrants(feat).hpFlat || 0), 0);
}

module.exports = {
  ORIGIN_FEATS,
  ORIGIN_FEAT_NAMES,
  GENERAL_FEATS,
  GENERAL_FEAT_LEVEL,
  FIGHTING_STYLE_FEATS,
  FIGHTING_STYLE_NAMES,
  FIGHTING_STYLE_FEATURE_LEVELS,
  hasFightingStyleFeature,
  EPIC_BOONS,
  EPIC_BOON_LEVEL_REQUIREMENT,
  featName,
  featData,
  featGrants,
  collectCharacterFeats,
  hpPerLevelFromFeats,
  hpFlatFromFeats
};
