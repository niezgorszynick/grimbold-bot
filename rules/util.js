// rules/util.js — Small helpers shared by the rules modules.

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// Expands a sparse { level: value } map into a 20-entry array indexed by level - 1.
// Each value carries forward until the next listed level; levels before the first entry are 0.
function byLevel(map) {
  const table = [];
  let current = 0;
  for (let level = 1; level <= 20; level += 1) {
    if (map[level] !== undefined) current = map[level];
    table.push(current);
  }
  return table;
}

function atLevel(table, level) {
  if (!Array.isArray(table)) return 0;
  return table[Math.min(20, Math.max(1, level)) - 1];
}

function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

function proficiencyBonus(level) {
  return Math.ceil(level / 4) + 1;
}

// Equipment entries may be written as 'Name', ['Name', quantity] or a full object.
function normalizeItems(items) {
  return items.map(item => {
    if (typeof item === 'string') return { name: item, quantity: 1 };
    if (Array.isArray(item)) return { name: item[0], quantity: item[1] };
    return { quantity: 1, ...item };
  });
}

function findCanonical(names, input) {
  const needle = (input || '').trim().toLowerCase();
  return names.find(name => name.toLowerCase() === needle) || null;
}

module.exports = {
  ABILITIES,
  byLevel,
  atLevel,
  abilityModifier,
  proficiencyBonus,
  normalizeItems,
  findCanonical
};
