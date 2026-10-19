// rules/encounters.js — Encounter building (2024 DMG): the XP budget per
// character level for a Low, Moderate or High difficulty encounter, and the
// dice a monster's statblock offers (attacks, damage, saves, checks).

const { SKILLS, abilityModifier } = require('./util');

// XP budget per character: [Low, Moderate, High], by level 1–20.
const XP_BUDGET_BY_LEVEL = [
  null,
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100],
  [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800],
  [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000]
];

// levels: the party's character levels. { low, moderate, high } in XP.
function encounterBudget(levels) {
  const budget = { low: 0, moderate: 0, high: 0 };
  for (const level of levels) {
    const row = XP_BUDGET_BY_LEVEL[Math.min(20, Math.max(1, Math.floor(Number(level)) || 1))];
    budget.low += row[0];
    budget.moderate += row[1];
    budget.high += row[2];
  }
  return budget;
}

// Where an encounter's XP falls against the budget.
function encounterDifficulty(xp, budget) {
  if (!budget.high) return null;
  if (xp <= 0) return 'None';
  if (xp <= budget.low) return 'Low';
  if (xp <= budget.moderate) return 'Moderate';
  if (xp <= budget.high) return 'High';
  return 'Beyond High';
}

const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const SECTIONS = ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions'];
const signed = n => (n >= 0 ? `+${n}` : `${n}`);
const d20 = modifier => `1d20${modifier ? signed(modifier) : ''}`;
// "13 (3d6 + 3) Piercing damage" in an entry's text.
const DAMAGE = /(\d+) \((\d+d\d+(?:\s*[+-]\s*\d+)?)\) ([A-Z][a-z]+) damage/g;

// Everything a creature can roll, by id: "initiative", "save:dex",
// "check:dex", "skill:Perception", and per statblock entry
// "<section>:<index>:hit" and "<section>:<index>:damage:<n>".
// source: a monster (rules/monsters.js), or { abilities } for an NPC without one.
function creatureRollOptions(source) {
  const options = new Map();
  const add = (id, label, formula, kind) => options.set(id, { id, label, formula, kind });
  const abilities = source.abilities || {};
  const mod = ability => (abilities[ability] ? abilityModifier(abilities[ability]) : 0);
  const dexInitiative = Number.isInteger(source.initiative) ? source.initiative : mod('dex');
  add('initiative', 'Initiative', d20(dexInitiative), 'initiative');
  for (const [ability, name] of Object.entries(ABILITY_NAMES)) {
    add(`check:${ability}`, `${name} check`, d20(mod(ability)), 'check');
    add(`save:${ability}`, `${name} save`, d20((source.saves || {})[ability] ?? mod(ability)), 'save');
  }
  for (const [skill, bonus] of Object.entries(source.skills || {})) {
    if (SKILLS[skill]) add(`skill:${skill}`, skill, d20(bonus), 'check');
  }
  for (const section of SECTIONS) {
    (source[section] || []).forEach((entry, index) => {
      if (entry.attack) add(`${section}:${index}:hit`, `${entry.name} attack`, d20(entry.attack.bonus), 'attack');
      const seen = new Set();
      let n = 0;
      for (const match of String(entry.text || '').replace(/[–—−]/g, '-').matchAll(DAMAGE)) {
        const formula = match[2].replace(/\s+/g, '');
        if (seen.has(formula + match[3])) continue;
        seen.add(formula + match[3]);
        add(`${section}:${index}:damage:${n}`, `${entry.name} damage (${match[3]})`, formula, 'damage');
        n += 1;
      }
    });
  }
  return options;
}

module.exports = { XP_BUDGET_BY_LEVEL, encounterBudget, encounterDifficulty, creatureRollOptions };
