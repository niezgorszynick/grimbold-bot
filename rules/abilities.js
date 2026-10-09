// rules/abilities.js — Ability score generation and background bonuses (2024 PHB).
//
// Generation (Point Buy, Standard Array, Manual/Rolled) produces base scores;
// the background then adds +2/+1 or +1/+1/+1 to its three listed abilities,
// whichever method was used. No score may exceed 20 after the bonus.

const { ABILITIES, abilityModifier } = require('./util');
const { BACKGROUNDS } = require('./backgrounds');

const GENERATION_METHODS = ['Point Buy', 'Standard Array', 'Manual/Rolled'];
const POINT_BUY_COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const TOTAL_POINT_BUY_POINTS = 27;
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
// Rolled scores come from 4d6 drop lowest.
const ROLLED_MIN = 3;
const ROLLED_MAX = 18;
const MAX_STARTING_SCORE = 20;

const STANDARD_ARRAY_SUGGESTIONS = {
  Artificer: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
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

function assertScoreObject(scores, label) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    throw new Error(`${label} must be an object.`);
  }
}

function calculatePointBuyCost(baseScores) {
  assertScoreObject(baseScores, 'Point Buy ability scores');
  let totalSpent = 0;
  for (const ability of ABILITIES) {
    const score = baseScores[ability];
    if (!Number.isInteger(score) || score < 8 || score > 15) {
      throw new Error(`Score for ${ability.toUpperCase()} must be between 8 and 15.`);
    }
    totalSpent += POINT_BUY_COSTS[score];
  }
  return totalSpent;
}

// Validates base scores for the chosen method and returns them as a clean object.
function validateBaseScores(method, baseScores) {
  if (!GENERATION_METHODS.includes(method)) {
    throw new Error('Choose Point Buy, Standard Array, or Manual/Rolled.');
  }
  assertScoreObject(baseScores, 'Ability scores');
  const scores = Object.fromEntries(ABILITIES.map(ability => [ability, baseScores[ability]]));

  if (method === 'Point Buy') {
    const spent = calculatePointBuyCost(scores);
    if (spent !== TOTAL_POINT_BUY_POINTS) {
      throw new Error(`Point Buy must spend exactly ${TOTAL_POINT_BUY_POINTS} points (currently spent: ${spent}).`);
    }
  } else if (method === 'Standard Array') {
    const sorted = Object.values(scores).filter(Number.isInteger).sort((a, b) => b - a);
    if (sorted.join(',') !== STANDARD_ARRAY.join(',')) {
      throw new Error('Standard Array must use 15, 14, 13, 12, 10, and 8 once each.');
    }
  } else if (Object.values(scores).some(score =>
    !Number.isInteger(score) || score < ROLLED_MIN || score > ROLLED_MAX
  )) {
    throw new Error(`Rolled ability scores must be whole numbers from ${ROLLED_MIN} to ${ROLLED_MAX}.`);
  }
  return scores;
}

// bonuses: { ability: 0 | 1 | 2 } — must be +2/+1 or +1/+1/+1 on the background's abilities.
// Returns { mode, bonuses } with every ability present.
function validateBackgroundBonuses(backgroundName, bonuses) {
  const background = BACKGROUNDS[backgroundName];
  if (!background) throw new Error('Select a valid D&D 2024 background.');
  assertScoreObject(bonuses, 'Background bonuses');
  if (Object.keys(bonuses).some(ability => !ABILITIES.includes(ability))) {
    throw new Error('Background bonuses must use ability abbreviations.');
  }
  const normalized = Object.fromEntries(ABILITIES.map(ability => [ability, bonuses[ability] ?? 0]));
  if (Object.values(normalized).some(value => !Number.isInteger(value) || value < 0 || value > 2)) {
    throw new Error('Each background bonus must be a whole number from 0 to 2.');
  }
  const boosted = ABILITIES.filter(ability => normalized[ability] > 0);
  if (boosted.some(ability => !background.abilityBoosts.includes(ability))) {
    throw new Error(`${backgroundName} can only increase ${background.abilityBoosts.map(a => a.toUpperCase()).join(', ')}.`);
  }
  const values = boosted.map(ability => normalized[ability]).sort((a, b) => b - a).join(',');
  const mode = values === '2,1' ? '2+1' : values === '1,1,1' ? '1+1+1' : null;
  if (!mode) throw new Error('Choose either +2/+1 or +1/+1/+1 background bonuses.');
  return { mode, bonuses: normalized };
}

// Full ability step: base scores for the method plus the background bonus.
function generateAbilityScores({ method, baseScores, background, bonuses }) {
  const base = validateBaseScores(method, baseScores);
  const { mode, bonuses: applied } = validateBackgroundBonuses(background, bonuses);
  const scores = Object.fromEntries(ABILITIES.map(ability => [ability, base[ability] + applied[ability]]));
  const tooHigh = ABILITIES.filter(ability => scores[ability] > MAX_STARTING_SCORE);
  if (tooHigh.length) {
    throw new Error('No ability score can exceed 20 after background bonuses.');
  }
  return {
    method,
    baseScores: base,
    bonusMode: mode,
    bonuses: applied,
    scores,
    modifiers: Object.fromEntries(ABILITIES.map(ability => [ability, abilityModifier(scores[ability])]))
  };
}

module.exports = {
  GENERATION_METHODS,
  POINT_BUY_COSTS,
  TOTAL_POINT_BUY_POINTS,
  STANDARD_ARRAY,
  STANDARD_ARRAY_SUGGESTIONS,
  calculatePointBuyCost,
  validateBaseScores,
  validateBackgroundBonuses,
  generateAbilityScores
};
