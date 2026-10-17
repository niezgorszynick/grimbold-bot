// rules/itemBonuses.js — Custom bonuses on equipment items, for things the
// rules engine doesn't know: a ring giving +2 to History checks, a holy book
// giving Advantage on Religion checks while held close.
//
// Stored on the inventory row: bonuses: [{ target, kind, value }] and
// bonusesActive (false while the item isn't in use; default true).
//   target: 'skill:History' | 'check:int' | 'save:wis' | 'checks' (every
//           ability check, skills too) | 'saves' (every saving throw) | 'initiative'
//   kind:   'bonus' (value -10…10) | 'advantage' | 'disadvantage'

const { SKILLS } = require('./util');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const KINDS = ['bonus', 'advantage', 'disadvantage'];
const MAX_BONUSES = 6;

function targetLabel(target) {
  const [type, key] = String(target).split(':');
  if (type === 'skill') return `${key} checks`;
  if (type === 'check') return `${ABILITY_NAMES[key]} checks`;
  if (type === 'save') return `${ABILITY_NAMES[key]} saves`;
  return { checks: 'all ability checks', saves: 'all saving throws', initiative: 'Initiative' }[target] || target;
}

function validTarget(target) {
  const [type, key] = String(target || '').split(':');
  if (type === 'skill') return Object.hasOwn(SKILLS, key);
  if (type === 'check' || type === 'save') return ABILITIES.includes(key);
  return ['checks', 'saves', 'initiative'].includes(target);
}

// "+2 to History checks", "Advantage on Religion checks".
function describeBonus(bonus) {
  const what = targetLabel(bonus.target);
  if (bonus.kind === 'advantage') return `Advantage on ${what}`;
  if (bonus.kind === 'disadvantage') return `Disadvantage on ${what}`;
  return `${bonus.value >= 0 ? '+' : ''}${bonus.value} to ${what}`;
}

// Checks a list from the sheet; returns the clean list.
function validateItemBonuses(list) {
  if (list === null || list === undefined) return [];
  if (!Array.isArray(list)) throw new Error('Bonuses must be a list.');
  if (list.length > MAX_BONUSES) throw new Error(`At most ${MAX_BONUSES} bonuses per item.`);
  return list.map(raw => {
    const bonus = raw || {};
    if (!validTarget(bonus.target)) throw new Error('Choose what the bonus applies to.');
    if (!KINDS.includes(bonus.kind)) throw new Error('Choose a bonus, Advantage or Disadvantage.');
    if (bonus.kind !== 'bonus') return { target: bonus.target, kind: bonus.kind };
    const value = Number(bonus.value);
    if (!Number.isInteger(value) || value === 0 || value < -10 || value > 10) throw new Error('A bonus must be a whole number from -10 to 10 (not 0).');
    return { target: bonus.target, kind: 'bonus', value };
  });
}

// The bonuses of items in use, added up:
// { skills: { History: 2 }, checks: { int: 0 }, saves: {}, allChecks, allSaves,
//   initiative, advantage: { 'skill:Religion': ['Holy Book'] }, disadvantage: {} }.
function itemBonusTotals(sheetData) {
  const totals = { skills: {}, checks: {}, saves: {}, allChecks: 0, allSaves: 0, initiative: 0, advantage: {}, disadvantage: {} };
  const inventory = Array.isArray((sheetData || {}).inventory) ? sheetData.inventory : [];
  for (const row of inventory) {
    if (!row || !Array.isArray(row.bonuses) || row.bonusesActive === false) continue;
    const item = row.nickname || row.name;
    for (const bonus of row.bonuses) {
      if (!validTarget(bonus.target)) continue;
      if (bonus.kind === 'advantage' || bonus.kind === 'disadvantage') {
        (totals[bonus.kind][bonus.target] = totals[bonus.kind][bonus.target] || []).push(item);
        continue;
      }
      const value = Number(bonus.value) || 0;
      const [type, key] = bonus.target.split(':');
      if (type === 'skill') totals.skills[key] = (totals.skills[key] || 0) + value;
      else if (type === 'check') totals.checks[key] = (totals.checks[key] || 0) + value;
      else if (type === 'save') totals.saves[key] = (totals.saves[key] || 0) + value;
      else if (bonus.target === 'checks') totals.allChecks += value;
      else if (bonus.target === 'saves') totals.allSaves += value;
      else if (bonus.target === 'initiative') totals.initiative += value;
    }
  }
  return totals;
}

// What items add to one roll, and who grants Advantage / Disadvantage on it.
// roll: { type: 'skill', skill, ability } | { type: 'check', ability } |
//       { type: 'save', ability } | { type: 'initiative' }.
function itemBonusFor(totals, roll) {
  let value = 0;
  const targets = [];
  if (roll.type === 'skill') {
    value = (totals.skills[roll.skill] || 0) + (totals.checks[roll.ability] || 0) + totals.allChecks;
    targets.push(`skill:${roll.skill}`, `check:${roll.ability}`, 'checks');
  } else if (roll.type === 'check') {
    value = (totals.checks[roll.ability] || 0) + totals.allChecks;
    targets.push(`check:${roll.ability}`, 'checks');
  } else if (roll.type === 'save') {
    value = (totals.saves[roll.ability] || 0) + totals.allSaves;
    targets.push(`save:${roll.ability}`, 'saves');
  } else if (roll.type === 'initiative') {
    value = totals.initiative;
    targets.push('initiative');
  }
  const from = kind => [...new Set(targets.flatMap(target => totals[kind][target] || []))];
  return { value, advantage: from('advantage'), disadvantage: from('disadvantage') };
}

module.exports = {
  ITEM_BONUS_KINDS: KINDS,
  describeItemBonus: describeBonus,
  itemBonusTargetLabel: targetLabel,
  validateItemBonuses,
  itemBonusTotals,
  itemBonusFor
};
