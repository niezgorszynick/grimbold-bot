// rules/vitals.js — Hit Points, Hit Point Dice, death saves, exhaustion, spell
// slot usage and rests (2024 PHB). Pure functions: each takes the current
// vitals and returns { vitals, events } without mutating its input.
//
// Stored vitals (inside sheet_data):
//   hpCurrent, hpTemp, hpMaxBonus, hitDiceSpent { d8: 1 }, deathSaves
//   { successes, failures }, exhaustion 0–6, spellSlotsSpent [per level],
//   pactSlotsSpent.
// Derived values (hpMax, hit dice pool, slot totals) are passed in by the
// caller from the character's classes so they always follow the rules.

const crypto = require('crypto');
const { abilityModifier } = require('./util');
const { calculateMaxHp, getHitDicePool } = require('./hitPoints');
const { getSpellSlots } = require('./spellcasting');
const { collectCharacterFeats } = require('./feats');

const MAX_EXHAUSTION = 6;

function rollDie(sides, rng = crypto.randomInt) {
  return rng(1, sides + 1);
}

function toCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function requireAmount(amount, label) {
  const number = Number(amount);
  if (!Number.isInteger(number) || number < 0 || number > 10000) {
    throw new Error(`${label} must be a whole number from 0 to 10000.`);
  }
  return number;
}

// Fills defaults for characters created before vitals were tracked.
function normalizeVitals(sheetData, hpMax) {
  const data = sheetData || {};
  const current = Number.isInteger(data.hpCurrent) ? data.hpCurrent : hpMax;
  const saves = data.deathSaves || {};
  return {
    hpCurrent: Math.max(0, Math.min(current, hpMax)),
    hpTemp: toCount(data.hpTemp),
    hpMaxBonus: Number.isInteger(data.hpMaxBonus) ? data.hpMaxBonus : 0,
    hitDiceSpent: Object.fromEntries(
      Object.entries(data.hitDiceSpent || {}).map(([die, count]) => [die, toCount(count)])
    ),
    deathSaves: { successes: toCount(saves.successes), failures: toCount(saves.failures) },
    stable: Boolean(data.stable),
    exhaustion: Math.min(MAX_EXHAUSTION, toCount(data.exhaustion)),
    spellSlotsSpent: Array.isArray(data.spellSlotsSpent) ? data.spellSlotsSpent.map(toCount) : [],
    pactSlotsSpent: toCount(data.pactSlotsSpent)
  };
}

function resetDying(vitals) {
  return { ...vitals, deathSaves: { successes: 0, failures: 0 }, stable: false };
}

// Damage hits Temporary HP first. Damage at 0 HP is a failed death save
// (two on a critical hit); damage that leaves a remainder of at least the
// HP maximum after dropping to 0 kills outright.
function applyDamage(vitals, amount, { hpMax, critical = false }) {
  const damage = requireAmount(amount, 'Damage');
  const events = [];
  const absorbed = Math.min(vitals.hpTemp, damage);
  let remaining = damage - absorbed;
  let next = { ...vitals, hpTemp: vitals.hpTemp - absorbed };
  if (remaining === 0) return { vitals: next, events };

  if (next.hpCurrent === 0) {
    if (remaining >= hpMax) {
      events.push('instantDeath');
      return { vitals: next, events };
    }
    const failures = Math.min(3, next.deathSaves.failures + (critical ? 2 : 1));
    next = { ...next, stable: false, deathSaves: { ...next.deathSaves, failures } };
    events.push(failures >= 3 ? 'dead' : 'deathSaveFailed');
    return { vitals: next, events };
  }

  if (remaining >= next.hpCurrent) {
    remaining -= next.hpCurrent;
    next = resetDying({ ...next, hpCurrent: 0 });
    events.push(remaining >= hpMax ? 'instantDeath' : 'droppedToZero');
    return { vitals: next, events };
  }
  return { vitals: { ...next, hpCurrent: next.hpCurrent - remaining }, events };
}

function heal(vitals, amount, { hpMax }) {
  const healing = requireAmount(amount, 'Healing');
  if (healing === 0) return { vitals, events: [] };
  const wasDying = vitals.hpCurrent === 0;
  const next = { ...vitals, hpCurrent: Math.min(hpMax, vitals.hpCurrent + healing) };
  return { vitals: wasDying ? resetDying(next) : next, events: wasDying ? ['revived'] : [] };
}

// Temporary HP don't stack: the higher value is kept.
function setTempHp(vitals, amount) {
  const temp = requireAmount(amount, 'Temporary Hit Points');
  return { vitals: { ...vitals, hpTemp: Math.max(vitals.hpTemp, temp) }, events: [] };
}

function clearTempHp(vitals) {
  return { vitals: { ...vitals, hpTemp: 0 }, events: [] };
}

// roll: the d20 result (1–20). Rolled server-side when omitted.
function deathSave(vitals, { roll, rng } = {}) {
  if (vitals.hpCurrent > 0) throw new Error('Death saves are only rolled at 0 Hit Points.');
  if (vitals.stable) throw new Error('The character is stable and does not roll death saves.');
  if (vitals.deathSaves.failures >= 3) throw new Error('The character has already failed three death saves.');
  const d20 = roll === undefined ? rollDie(20, rng) : Number(roll);
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) throw new Error('Death save roll must be from 1 to 20.');

  if (d20 === 20) {
    return { vitals: resetDying({ ...vitals, hpCurrent: 1 }), events: ['revived'], roll: d20 };
  }
  const saves = { ...vitals.deathSaves };
  if (d20 === 1) saves.failures = Math.min(3, saves.failures + 2);
  else if (d20 < 10) saves.failures += 1;
  else saves.successes += 1;

  if (saves.failures >= 3) return { vitals: { ...vitals, deathSaves: saves }, events: ['dead'], roll: d20 };
  if (saves.successes >= 3) {
    return { vitals: { ...vitals, deathSaves: { successes: 0, failures: 0 }, stable: true }, events: ['stabilized'], roll: d20 };
  }
  return { vitals: { ...vitals, deathSaves: saves }, events: [d20 >= 10 ? 'deathSaveSucceeded' : 'deathSaveFailed'], roll: d20 };
}

function stabilize(vitals) {
  if (vitals.hpCurrent > 0) throw new Error('Only a character at 0 Hit Points can be stabilized.');
  return { vitals: { ...vitals, deathSaves: { successes: 0, failures: 0 }, stable: true }, events: ['stabilized'] };
}

// spend: { d10: 2, d6: 1 }. Each die restores roll + CON modifier (minimum 1).
// Pact Magic slots return on every Short Rest.
function shortRest(vitals, spend, { hpMax, hitDicePool, conModifier, rng }) {
  const request = spend && typeof spend === 'object' ? spend : {};
  const rolls = [];
  const spent = { ...vitals.hitDiceSpent };
  for (const [die, rawCount] of Object.entries(request)) {
    const count = Number(rawCount);
    if (!Number.isInteger(count) || count < 0) throw new Error('Hit Point Dice to spend must be whole numbers.');
    if (count === 0) continue;
    const available = (hitDicePool[die] || 0) - (spent[die] || 0);
    if (count > available) throw new Error(`Only ${available} ${die} Hit Point Dice remaining.`);
    const sides = Number(die.slice(1));
    for (let i = 0; i < count; i += 1) {
      const roll = rollDie(sides, rng);
      rolls.push({ die, roll, healed: Math.max(1, roll + conModifier) });
    }
    spent[die] = (spent[die] || 0) + count;
  }
  if (rolls.length > 0 && vitals.hpCurrent === 0) {
    throw new Error('A character at 0 Hit Points must be healed or stabilized before spending Hit Point Dice.');
  }
  const healed = rolls.reduce((sum, item) => sum + item.healed, 0);
  const next = {
    ...vitals,
    hitDiceSpent: spent,
    hpCurrent: Math.min(hpMax, vitals.hpCurrent + healed),
    pactSlotsSpent: 0
  };
  return { vitals: next, events: ['shortRest'], rolls, healed };
}

// Long Rest: full HP, all Hit Point Dice and spell slots back, Temporary HP
// end, Exhaustion drops by 1. Requires at least 1 Hit Point to start.
function longRest(vitals, { hpMax }) {
  if (vitals.hpCurrent === 0) throw new Error('A character needs at least 1 Hit Point to start a Long Rest.');
  return {
    vitals: resetDying({
      ...vitals,
      hpCurrent: hpMax,
      hpTemp: 0,
      hitDiceSpent: {},
      exhaustion: Math.max(0, vitals.exhaustion - 1),
      spellSlotsSpent: [],
      pactSlotsSpent: 0
    }),
    events: ['longRest']
  };
}

function setExhaustion(vitals, level) {
  const value = Number(level);
  if (!Number.isInteger(value) || value < 0 || value > MAX_EXHAUSTION) {
    throw new Error(`Exhaustion must be from 0 to ${MAX_EXHAUSTION}.`);
  }
  return { vitals: { ...vitals, exhaustion: value }, events: value === MAX_EXHAUSTION ? ['dead'] : [] };
}

// level: spell slot level (1–9), or 'pact'. delta: +1 to spend, -1 to restore.
function changeSlot(vitals, level, delta, { slots, pact }) {
  if (delta !== 1 && delta !== -1) throw new Error('Slot change must be +1 or -1.');
  if (level === 'pact') {
    const total = pact ? pact.count : 0;
    const spent = vitals.pactSlotsSpent + delta;
    if (spent < 0 || spent > total) throw new Error(delta > 0 ? 'No Pact Magic slots remaining.' : 'No spent Pact Magic slots to restore.');
    return { vitals: { ...vitals, pactSlotsSpent: spent }, events: [] };
  }
  const slotLevel = Number(level);
  const total = slots[slotLevel - 1] || 0;
  if (!Number.isInteger(slotLevel) || total === 0) throw new Error(`No level ${level} spell slots.`);
  const spentList = [...vitals.spellSlotsSpent];
  while (spentList.length < slotLevel) spentList.push(0);
  const spent = spentList[slotLevel - 1] + delta;
  if (spent < 0 || spent > total) {
    throw new Error(delta > 0 ? `No level ${slotLevel} spell slots remaining.` : `No spent level ${slotLevel} slots to restore.`);
  }
  spentList[slotLevel - 1] = spent;
  return { vitals: { ...vitals, spellSlotsSpent: spentList }, events: [] };
}

// Manual adjustment to the HP maximum (e.g. the Aid spell or a curse).
function setMaxHpBonus(vitals, bonus) {
  const value = Number(bonus);
  if (!Number.isInteger(value) || value < -1000 || value > 1000) {
    throw new Error('HP maximum adjustment must be a whole number from -1000 to 1000.');
  }
  return { vitals: { ...vitals, hpMaxBonus: value }, events: [] };
}

// ─── Character-level helpers ────────────────────────────────────────────────

function abilityScore(sheetData, ability) {
  const value = ((sheetData || {}).abilities || {})[ability];
  const score = value && typeof value === 'object' ? (value.score ?? value.total) : value;
  return Number.isInteger(score) ? score : 10;
}

// classRows: [{ className, subclassName, level }], starting class first.
function deriveVitalsContext({ species, sheetData, classRows }) {
  const constitution = abilityScore(sheetData, 'con');
  const feats = collectCharacterFeats(sheetData);
  const hp = calculateMaxHp({ classes: classRows, constitution, species, feats });
  const bonus = Number.isInteger((sheetData || {}).hpMaxBonus) ? sheetData.hpMaxBonus : 0;
  const spellSlots = getSpellSlots(classRows);
  return {
    baseHpMax: hp.max,
    hpBreakdown: hp.breakdown,
    hpMax: Math.max(1, hp.max + bonus),
    hitDicePool: getHitDicePool(classRows),
    conModifier: abilityModifier(constitution),
    slots: spellSlots.slots,
    pact: spellSlots.pact
  };
}

const ACTIONS = {
  damage: (vitals, params, context) => applyDamage(vitals, params.amount, { hpMax: context.hpMax, critical: Boolean(params.critical) }),
  heal: (vitals, params, context) => heal(vitals, params.amount, context),
  tempHp: (vitals, params) => setTempHp(vitals, params.amount),
  clearTempHp: vitals => clearTempHp(vitals),
  deathSave: (vitals, params, context) => deathSave(vitals, { roll: params.roll, rng: context.rng }),
  stabilize: vitals => stabilize(vitals),
  shortRest: (vitals, params, context) => shortRest(vitals, params.hitDice, context),
  longRest: (vitals, params, context) => longRest(vitals, context),
  exhaustion: (vitals, params) => setExhaustion(vitals, params.level),
  spendSlot: (vitals, params, context) => changeSlot(vitals, params.level, 1, context),
  restoreSlot: (vitals, params, context) => changeSlot(vitals, params.level, -1, context),
  maxHpBonus: (vitals, params) => setMaxHpBonus(vitals, params.bonus)
};
const VITALS_ACTIONS = Object.keys(ACTIONS);

// Applies one action and returns the updated vitals plus anything to report
// (events, dice rolls). hpMax is re-derived when the bonus changes.
function applyVitalsAction(vitals, action, params, context) {
  const handler = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!handler) throw new Error(`Unknown action "${action}".`);
  const result = handler(vitals, params || {}, context);
  const hpMax = Math.max(1, context.baseHpMax + result.vitals.hpMaxBonus);
  return {
    ...result,
    vitals: { ...result.vitals, hpCurrent: Math.min(result.vitals.hpCurrent, hpMax) },
    hpMax
  };
}

// Read-only view for the sheet.
function buildVitalsView(vitals, context, hpMax = context.hpMax) {
  return {
    hpCurrent: vitals.hpCurrent,
    hpMax,
    hpTemp: vitals.hpTemp,
    hpMaxBonus: vitals.hpMaxBonus,
    hpBreakdown: context.hpBreakdown,
    hitDice: Object.entries(context.hitDicePool)
      .sort((a, b) => Number(b[0].slice(1)) - Number(a[0].slice(1)))
      .map(([die, total]) => ({ die, total, spent: Math.min(total, vitals.hitDiceSpent[die] || 0) })),
    conModifier: context.conModifier,
    deathSaves: vitals.deathSaves,
    stable: vitals.stable,
    exhaustion: vitals.exhaustion,
    spellSlots: context.slots.map((total, index) => ({
      level: index + 1,
      total,
      spent: Math.min(total, vitals.spellSlotsSpent[index] || 0)
    })),
    pact: context.pact ? { ...context.pact, spent: Math.min(context.pact.count, vitals.pactSlotsSpent) } : null
  };
}

module.exports = {
  MAX_EXHAUSTION,
  VITALS_ACTIONS,
  deriveVitalsContext,
  applyVitalsAction,
  buildVitalsView,
  normalizeVitals,
  applyDamage,
  heal,
  setTempHp,
  clearTempHp,
  deathSave,
  stabilize,
  shortRest,
  longRest,
  setExhaustion,
  changeSlot,
  setMaxHpBonus
};
