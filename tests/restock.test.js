const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers/tempDatabase');

const config = { ...db.RESTOCK_DEFAULTS };
let nextId = 1;
const row = (name, extra = {}) => ({
  id: nextId++, name, category: 'Gear', tier: 'common', base_price_cp: 100, description: name, min_level: 1, min_stock: 1, max_stock: 1,
  rarity: '', availability: 'shop', ...extra
});
const magic = (name, rarity, extra = {}) => row(name, { tier: 'magic', rarity, base_price_cp: { Common: 10000, Uncommon: 40000, Rare: 400000 }[rarity], ...extra });
const spells = [0, 0, 1, 1, 2, 3, 4, 5, 6].map((level, index) => ({ name: `Spell ${index} L${level}`, level, school: 'Evocation' }));
const catalog = [
  row('Rope'), row('Torch', { tier: 'staple', min_stock: 2, max_stock: 5 }), row('Plate Armor', { min_level: 5 }), row('Inn Stay', { tier: 'service' }),
  row('Spell Scroll (Level 1: Shield)', { category: 'Spell Scroll', rarity: 'Common' }),
  magic('Potion of Climbing', 'Common'), magic('Cloak of Billowing', 'Common'), magic('Hat of Wizardry', 'Common'), magic('Candle of the Deep', 'Common'),
  magic('Bag of Holding', 'Uncommon'), magic('Cloak of Protection', 'Uncommon'), magic('Boots of Elvenkind', 'Uncommon'),
  magic('Ring of Protection', 'Rare', { min_level: 5 }), magic('Amulet of Health', 'Rare', { availability: 'adventure', min_level: 5 }),
  magic('Flame Tongue', 'Uncommon', { availability: 'adventure' })
];
const fixedRandom = () => 0;

test('the restock plan: mundane counter, staples, a small magic vault and a capped scroll case', () => {
  const plan = db.planRestock({ shelf: [], catalog, spells, config, level: 3, random: fixedRandom });
  const by = source => plan.insert.filter(item => item.source === source);
  assert.deepEqual(by('mundane').map(item => item.name), ['Rope'], 'level-gated gear, services and scrolls stay out');
  assert.equal(by('mundane')[0].stock, null, 'always in stock');
  assert.deepEqual(by('staple').map(item => [item.name, item.stock]), [['Torch', 2]]);
  assert.deepEqual(by('magic').map(item => item.rarity), ['Common', 'Common', 'Common', 'Uncommon', 'Uncommon'], 'no Rare below level 5');
  assert.ok(!by('magic').some(item => ['Flame Tongue', 'Amulet of Health'].includes(item.name)), 'adventure-only items never');
  assert.deepEqual(by('scroll').map(item => item.name.match(/L(\d)/)[1]).map(Number).sort(), [0, 0, 1, 1, 2], 'level 3 party: scrolls up to level 2 (a short range falls back to any level)');
  assert.equal(by('scroll').find(item => item.name.includes('L2')).price, 17000, 'scroll price with fluctuation, rounded to whole gold');

  const high = db.planRestock({ shelf: [], catalog, spells, config, level: 9, random: fixedRandom });
  assert.deepEqual(high.insert.filter(item => item.source === 'magic' && item.rarity === 'Rare').map(item => item.name), ['Ring of Protection']);
  assert.ok(high.insert.some(item => item.name === 'Plate Armor'));
  assert.ok(high.insert.filter(item => item.source === 'scroll').some(item => /L[45]$/.test(item.name.replace(/\)$/, ''))), 'a level 4–5 scroll at party level 9');
});

test('half the magic stays a second week; sold-out items, staples and scrolls are replaced; DM additions stay', () => {
  const shelf = [
    { id: 101, name: 'Potion of Climbing', source: 'magic', rarity: 'Common', weeks: 0, stock: 1 },
    { id: 102, name: 'Cloak of Billowing', source: 'magic', rarity: 'Common', weeks: 1, stock: 1 },
    { id: 103, name: 'Bag of Holding', source: 'magic', rarity: 'Uncommon', weeks: 0, stock: 0 },
    { id: 104, name: 'Old Scroll', source: 'scroll', rarity: 'Common', weeks: 0, stock: 1 },
    { id: 105, name: 'Ale Barrel', source: 'manual', rarity: '', weeks: 0, stock: 3 },
    { id: 106, name: 'Empty Crate', source: 'manual', rarity: '', weeks: 0, stock: 0 },
    { id: 107, name: 'Leftover', source: 'legacy', rarity: '', weeks: 0, stock: 2 }
  ];
  const plan = db.planRestock({ shelf, catalog, spells, config, level: 3, random: fixedRandom });
  assert.deepEqual(plan.keep, [{ id: 101, weeks: 1 }], 'a first-week item stays');
  assert.deepEqual([...plan.remove].sort(), [102, 103, 104, 106, 107]);
  const magicNames = plan.insert.filter(item => item.source === 'magic').map(item => item.name);
  assert.equal(magicNames.filter(name => ['Potion of Climbing', 'Cloak of Billowing', 'Hat of Wizardry', 'Candle of the Deep'].includes(name)).length, 2, 'two new Commons beside the kept one');
  assert.ok(!magicNames.includes('Potion of Climbing'), 'no duplicate of a kept item');
});

test('running the restock writes the shelf; the party level can follow the characters', () => {
  db.prepare("INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock, rarity, availability) VALUES ('Rope', 'Gear', 'common', 100, 'Rope.', 1, 1, 1, '', 'shop'), ('Bag of Holding', 'Wondrous Item', 'magic', 40000, 'Bag.', 3, 1, 1, 'Uncommon', 'shop')").run();
  db.prepare("INSERT INTO items (name, category, price, stock, description, is_active, source) VALUES ('Old Thing', 'Gear', 5, 1, 'x', 1, 'legacy')").run();
  const summary = db.runRestock({ random: fixedRandom });
  assert.deepEqual(summary.newMagic, ['Bag of Holding']);
  const shelf = db.prepare('SELECT name, source, stock FROM items ORDER BY name').all();
  assert.ok(shelf.some(item => item.name === 'Rope' && item.source === 'mundane' && item.stock === null));
  assert.ok(!shelf.some(item => item.name === 'Old Thing'), 'rows from the old restock are cleared');
  assert.ok(shelf.some(item => item.source === 'scroll'), 'scrolls from the spell list');

  db.saveRestockConfig({ ...db.RESTOCK_DEFAULTS, party_level: 2, party_level_auto: true });
  assert.equal(db.readRestockConfig().party_level_auto, true);
  assert.throws(() => db.saveRestockConfig({ ...db.RESTOCK_DEFAULTS, scroll_count: 50 }), /scroll count/);
});
