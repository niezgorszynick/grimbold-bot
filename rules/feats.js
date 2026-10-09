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
// needs that armor training. Check against the book when feats.md is added.
const STR_DEX = ['str', 'dex'];
const MENTAL = ['int', 'wis', 'cha'];
const GENERAL_FEATS = {
  'Ability Score Improvement': { repeatable: true, abilityIncrease: null },
  Actor: { prerequisite: { scores: ['cha'] }, abilityIncrease: ['cha'] },
  Athlete: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  Charger: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  Chef: { abilityIncrease: ['con', 'wis'] },
  'Crossbow Expert': { prerequisite: { scores: ['dex'] }, abilityIncrease: ['dex'] },
  Crusher: { prerequisite: { scores: ['str', 'con'] }, abilityIncrease: ['str', 'con'] },
  'Defensive Duelist': { prerequisite: { scores: ['dex'] }, abilityIncrease: ['dex'] },
  'Dual Wielder': { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  Durable: { abilityIncrease: ['con'] },
  'Elemental Adept': { repeatable: true, prerequisite: { spellcasting: true }, abilityIncrease: MENTAL },
  'Fey Touched': { abilityIncrease: MENTAL },
  Grappler: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  'Great Weapon Master': { prerequisite: { scores: ['str'] }, abilityIncrease: ['str'] },
  'Heavily Armored': { prerequisite: { training: 'Medium armor' }, abilityIncrease: ['str', 'con'], grants: { armorTraining: ['Heavy armor'] } },
  'Heavy Armor Master': { prerequisite: { training: 'Heavy armor' }, abilityIncrease: ['str', 'con'] },
  'Inspiring Leader': { prerequisite: { scores: ['wis', 'cha'] }, abilityIncrease: ['wis', 'cha'] },
  'Keen Mind': { prerequisite: { scores: ['int'] }, abilityIncrease: ['int'] },
  'Lightly Armored': { abilityIncrease: STR_DEX, grants: { armorTraining: ['Light armor', 'Shields'] } },
  'Mage Slayer': { abilityIncrease: STR_DEX },
  'Martial Weapon Training': { abilityIncrease: STR_DEX, grants: { weaponProficiencies: ['Martial weapons'] } },
  'Medium Armor Master': { prerequisite: { training: 'Medium armor' }, abilityIncrease: STR_DEX },
  'Moderately Armored': { prerequisite: { training: 'Light armor' }, abilityIncrease: STR_DEX, grants: { armorTraining: ['Medium armor', 'Shields'] } },
  'Mounted Combatant': { abilityIncrease: ['str', 'dex', 'wis'] },
  Observant: { prerequisite: { scores: ['int', 'wis'] }, abilityIncrease: ['int', 'wis'] },
  Piercer: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  Poisoner: { abilityIncrease: ['dex', 'int'] },
  'Polearm Master': { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  // The increased ability also becomes a saving throw proficiency.
  Resilient: { abilityIncrease: 'any', grants: { saveFromIncrease: true } },
  'Ritual Caster': { prerequisite: { scores: MENTAL }, abilityIncrease: MENTAL },
  Sentinel: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  'Shadow Touched': { abilityIncrease: MENTAL },
  Sharpshooter: { prerequisite: { scores: ['dex'] }, abilityIncrease: ['dex'] },
  'Shield Master': { prerequisite: { training: 'Shields' }, abilityIncrease: ['str'] },
  'Skill Expert': { abilityIncrease: 'any', grants: { skillChoices: 1 } },
  Skulker: { prerequisite: { scores: ['dex'] }, abilityIncrease: ['dex'] },
  Slasher: { prerequisite: { scores: STR_DEX }, abilityIncrease: STR_DEX },
  Speedy: { prerequisite: { scores: ['dex', 'con'] }, abilityIncrease: ['dex', 'con'] },
  'Spell Sniper': { prerequisite: { spellcasting: true }, abilityIncrease: MENTAL },
  Telekinetic: { abilityIncrease: MENTAL },
  Telepathic: { abilityIncrease: MENTAL },
  'War Caster': { prerequisite: { spellcasting: true }, abilityIncrease: MENTAL },
  'Weapon Master': { abilityIncrease: STR_DEX }
};
const GENERAL_FEAT_LEVEL = 4;

// Epic Boons (level 19+): +1 to any ability, up to 30.
const EPIC_BOONS = {
  'Boon of Combat Prowess': {},
  'Boon of Dimensional Travel': {},
  'Boon of Energy Resistance': {},
  'Boon of Fate': {},
  'Boon of Fortitude': { grants: { hpFlat: 40 } },
  'Boon of Irresistible Offense': {},
  'Boon of Recovery': {},
  'Boon of Skill': {},
  'Boon of Speed': {},
  'Boon of Spell Recall': {},
  'Boon of the Night Spirit': {},
  'Boon of Truesight': {}
};
const EPIC_BOON_LEVEL_REQUIREMENT = 19;

// Feats may be stored as 'Tough' or { name: 'Magic Initiate', spellList: 'Wizard' }.
function featName(feat) {
  return typeof feat === 'string' ? feat : feat && feat.name;
}

function featGrants(feat) {
  const name = featName(feat);
  const data = ORIGIN_FEATS[name] || GENERAL_FEATS[name] || EPIC_BOONS[name];
  return (data && data.grants) || {};
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
  EPIC_BOONS,
  EPIC_BOON_LEVEL_REQUIREMENT,
  featName,
  featGrants,
  hpPerLevelFromFeats,
  hpFlatFromFeats
};
