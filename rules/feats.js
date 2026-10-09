// rules/feats.js — Origin feats (2024 PHB) with the mechanical grants the engine applies.
//
// General feats, Fighting Style feats and Epic Boons are loaded from rules/content/feats.md
// once that text is provided; the engine only needs their names and prerequisites.

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

// Feats may be stored as 'Tough' or { name: 'Magic Initiate', spellList: 'Wizard' }.
function featName(feat) {
  return typeof feat === 'string' ? feat : feat && feat.name;
}

function hpPerLevelFromFeats(feats = []) {
  return feats.reduce((total, feat) => {
    const data = ORIGIN_FEATS[featName(feat)];
    return total + ((data && data.grants.hpPerLevel) || 0);
  }, 0);
}

module.exports = { ORIGIN_FEATS, ORIGIN_FEAT_NAMES, featName, hpPerLevelFromFeats };
