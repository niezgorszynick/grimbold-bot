const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers/tempDatabase');

const config = { ...db.RESTOCK_DEFAULTS, scroll_count: 2, magic_common_count: 1, magic_uncommon_count: 0 };
const catalog = [
  { id: 1, name: 'Rope', category: 'Gear', tier: 'common', base_price_cp: 100, description: '', min_level: 1, min_stock: 1, max_stock: 1, rarity: '', availability: 'shop' },
  { id: 2, name: 'Potion of Climbing', category: 'Potion', tier: 'magic', base_price_cp: 5000, description: '', min_level: 1, min_stock: 1, max_stock: 1, rarity: 'Common', availability: 'shop' }
];
const spells = [{ name: 'Light', level: 0 }, { name: 'Shield', level: 1 }];
const plan = (extra = {}) => db.planRestock({ shelf: [], catalog, spells, config, level: 3, random: () => 0, ...extra });
const leather = { name: 'Treated Leather Armor', category: 'Armor', price_cp: 2500, description: 'Benet.', per_week: 1, cap: 3 };

test('artisan goods pile up to their cap and leave when no longer made', () => {
  let result = plan({ artisanGoods: [leather] });
  assert.deepEqual(result.insert.filter(row => row.source === 'artisan').map(row => [row.name, row.stock]), [['Treated Leather Armor', 1]]);

  const shelf = [{ id: 7, name: 'Treated Leather Armor', source: 'artisan', stock: 2 }, { id: 8, name: 'Old Boots', source: 'artisan', stock: 1 }];
  result = plan({ shelf, artisanGoods: [leather] });
  assert.deepEqual(result.update, [{ id: 7, stock: 3, price: 2500, source: 'artisan' }]);
  assert.ok(result.remove.includes(8), 'a good no longer made leaves the shelf');
  result = plan({ shelf: [{ ...shelf[0], stock: 3 }], artisanGoods: [leather] });
  assert.equal(result.update[0].stock, 3, 'never above the cap');
});

test('weekly events: a merchant visits, a shortage empties the scroll case, a sale cuts prices', () => {
  const merchant = { kind: 'merchant', params: { min: 2, max: 2, goods: [{ name: 'Dwarven Whetstone', price_cp: 500, category: 'Gear', description: '' }, { name: 'Ale Keg', price_cp: 1000, category: 'Food', description: '' }, { name: 'Lantern', price_cp: 700, category: 'Gear', description: '' }] } };
  let result = plan({ event: merchant, shelf: [{ id: 3, name: 'Last Week Thing', source: 'event', stock: 1 }] });
  assert.equal(result.insert.filter(row => row.source === 'event').length, 2);
  assert.ok(result.remove.includes(3), "last week's merchant has moved on");

  result = plan({ event: { kind: 'shortage', params: { target: 'scroll' } } });
  assert.equal(result.insert.filter(row => row.source === 'scroll').length, 0);
  result = plan({ event: { kind: 'shortage', params: { target: 'magic' } } });
  assert.equal(result.insert.filter(row => row.source === 'magic').length, 0);

  result = plan({ event: { kind: 'sale', params: { target: 'mundane', percent: 50 } } });
  assert.equal(result.insert.find(row => row.name === 'Rope').price, 50);
  assert.equal(result.insert.find(row => row.name === 'Potion of Climbing').price > 4000, true, 'only the chosen part is on sale');
});

test('artisans and events are saved, checked, and one event is rolled by chance and weight', () => {
  const benet = db.saveArtisan({ name: 'Benet the Leatherworker', active: true });
  db.saveArtisanGood({ artisan_id: benet, ...leather, price_gp: '25' });
  assert.throws(() => db.saveArtisanGood({ artisan_id: benet, name: 'Belt', price_gp: 1, per_week: 3, cap: 2 }), /at least/);
  assert.deepEqual(db.activeArtisanGoods().map(good => [good.name, good.price_cp, good.artisan]), [['Treated Leather Armor', 2500, 'Benet the Leatherworker']]);
  db.saveArtisan({ id: benet, name: 'Benet the Leatherworker', active: false });
  assert.deepEqual(db.activeArtisanGoods(), [], 'an away artisan supplies nothing');

  assert.throws(() => db.saveShopEvent({ kind: 'merchant', title: 'Visitor', announcement: 'Hi', goods: 'Lantern | free' }), /price/);
  const visitor = db.saveShopEvent({ kind: 'merchant', title: 'Visitor', announcement: 'A dwarf arrives.', goods: 'Dwarven Whetstone | 5 | Gear | Keeps an edge\nAle Keg | 10', weight: 1, active: true });
  assert.deepEqual(db.getShopEvent(visitor).params.goods.map(good => [good.name, good.price_cp, good.category]), [['Dwarven Whetstone', 500, 'Gear'], ['Ale Keg', 1000, 'Travelling Merchant']]);
  db.saveShopEvent({ kind: 'sale', title: 'Market day', announcement: 'Half off!', target: 'mundane', percent: 50, weight: 3, active: true });

  assert.equal(db.rollWeeklyEvent({ chance: 40, random: () => 0.5 }), null, 'a 50 roll misses a 40% chance');
  const rolls = [0.1, 0.9];
  assert.equal(db.rollWeeklyEvent({ chance: 40, random: () => rolls.shift() }).title, 'Visitor', 'weight 1 of 4 at the top of the range');
});

test('the restock announcement data includes the event', () => {
  db.prepare("INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock, rarity, availability) VALUES ('Rope', 'Gear', 'common', 100, 'Rope.', 1, 1, 1, '', 'shop')").run();
  db.prepare("DELETE FROM shop_events WHERE title = 'Market day'").run();
  db.saveRestockConfig({ ...db.RESTOCK_DEFAULTS, event_chance: 100 });
  const summary = db.runRestock({ random: () => 0 });
  assert.equal(summary.event.title, 'Visitor');
  assert.deepEqual(summary.merchantGoods.length >= 1, true);
});

test('travelling artisans visit through merchant events; shortages can hit staples or a category', () => {
  const thrain = db.saveArtisan({ name: 'Thrain the Armorer', mode: 'travelling', active: true });
  db.saveArtisanGood({ artisan_id: thrain, name: 'Dwarven Chain Shirt', category: 'Armor', price_gp: 60, per_week: 2, cap: 2 });
  assert.ok(!db.activeArtisanGoods().some(good => good.name === 'Dwarven Chain Shirt'), 'no weekly supply from a travelling artisan');
  assert.deepEqual(db.travellingGoods(thrain).map(good => [good.name, good.price_cp, good.stock]), [['Dwarven Chain Shirt', 6000, 2]]);

  assert.throws(() => db.saveShopEvent({ kind: 'merchant', title: 'x', announcement: 'y', artisan_id: 999999 }), /travelling artisans/);
  const visit = db.saveShopEvent({ kind: 'merchant', title: 'Thrain visits', announcement: 'Steel!', artisan_id: thrain, min_goods: 1, max_goods: 1, active: true });
  assert.deepEqual(db.getShopEvent(visit).params, { artisanId: thrain, min: 1, max: 1 });

  // The restock sells the artisan's goods (their per-visit amount).
  const goods = db.travellingGoods(thrain);
  let result = plan({ event: { kind: 'merchant', params: { artisanId: thrain, min: 1, max: 1, goods } } });
  assert.deepEqual(result.insert.filter(row => row.source === 'event').map(row => [row.name, row.stock]), [['Dwarven Chain Shirt', 2]]);

  // Shortages: staples, or a whole catalog category.
  const withStaple = [...catalog, { id: 9, name: 'Torch', category: 'Gear', tier: 'staple', base_price_cp: 1, description: '', min_level: 1, min_stock: 2, max_stock: 2, rarity: '', availability: 'shop' }];
  result = db.planRestock({ shelf: [], catalog: withStaple, spells, config, level: 3, random: () => 0, event: { kind: 'shortage', params: { target: 'staple' } } });
  assert.ok(!result.insert.some(row => row.source === 'staple'));
  result = plan({ event: { kind: 'shortage', params: { target: 'category:Gear' } } });
  assert.ok(!result.insert.some(row => row.name === 'Rope'), 'no Gear this week');
  assert.ok(result.insert.some(row => row.name === 'Potion of Climbing'), 'other categories as usual');
  db.saveShopEvent({ kind: 'shortage', title: 'No blades', announcement: 'The smith is ill.', target: 'category:Weapons', active: false });
  assert.throws(() => db.saveShopEvent({ kind: 'shortage', title: 'x', announcement: 'y', target: 'everything' }), /runs short/);

  const options = db.shortageOptions([
    { name: 'Longsword', category: 'Weapons', tier: 'common', availability: 'shop' },
    { name: 'Dagger', category: 'Weapons', tier: 'common', availability: 'shop' },
    { name: 'Inn Stay', category: 'Services', tier: 'service', availability: 'shop' }
  ]);
  assert.deepEqual(options.map(option => option.value), ['scroll', 'magic', 'staple', 'category:Weapons']);
  assert.match(options[3].description, /Weapons.*2 items, e\.g\. Longsword/);
});

test('a pawn shop: random magic items by rarity, up to its cap, never one already on the shelf', () => {
  const magicCatalog = [
    ...catalog,
    { id: 3, name: 'Potion of Watchful Rest', category: 'Potion', tier: 'magic', base_price_cp: 5000, description: 'Rest.', min_level: 1, min_stock: 1, max_stock: 1, rarity: 'Common', availability: 'shop' },
    { id: 8, name: 'Cloak of Many Fashions', category: 'Wondrous', tier: 'magic', base_price_cp: 5000, description: 'Style.', min_level: 1, min_stock: 1, max_stock: 1, rarity: 'Common', availability: 'shop' },
    { id: 4, name: 'Bag of Holding', category: 'Wondrous', tier: 'magic', base_price_cp: 40000, description: 'Bag.', min_level: 1, min_stock: 1, max_stock: 1, rarity: 'Uncommon', availability: 'shop' },
    { id: 5, name: 'Flame Tongue', category: 'Weapon', tier: 'magic', base_price_cp: 400000, description: 'Fire.', min_level: 1, min_stock: 1, max_stock: 1, rarity: 'Rare', availability: 'shop' },
    { id: 6, name: 'Vorpal Sword', category: 'Weapon', tier: 'magic', base_price_cp: 9000000, description: 'Snicker-snack.', min_level: 1, min_stock: 1, max_stock: 1, rarity: 'Rare', availability: 'adventure' },
    { id: 7, name: 'Spell Scroll (Shield)', category: 'Spell Scroll', tier: 'magic', base_price_cp: 5000, description: '', min_level: 1, min_stock: 1, max_stock: 1, rarity: 'Common', availability: 'shop' }
  ];
  const pawn = { id: 42, name: 'Old Wexley', common: 2, uncommon: 1, rare: 1, cap: 3, scheduled: false };
  const run = extra => db.planRestock({ shelf: [], catalog: magicCatalog, spells, config, level: 3, random: () => 0, artisanMagic: [pawn], ...extra });

  let result = run();
  const pawned = result.insert.filter(row => row.source === 'artisan_magic');
  const grimbolds = result.insert.filter(row => row.source === 'magic').map(row => row.name);
  assert.equal(pawned.length, 3, 'three: two Common and one Uncommon (no Rare below level 5)');
  assert.ok(pawned.every(row => row.artisan_id === 42 && row.stock === 1));
  assert.ok(!pawned.some(row => row.rarity === 'Rare'));
  assert.ok(!pawned.some(row => grimbolds.includes(row.name)), 'never Grimbold\'s own');
  assert.ok(!pawned.some(row => /Scroll/.test(row.name)), 'no scrolls');
  assert.equal(pawned.find(row => row.name === 'Bag of Holding').price, Math.round(40000 * 0.85 / 100) * 100, 'catalog price with the fluctuation');

  result = run({ level: 5 });
  const rare = result.insert.filter(row => row.source === 'artisan_magic' && row.rarity === 'Rare').map(row => row.name);
  assert.ok(rare.every(name => name === 'Flame Tongue'), 'adventure-only Rare items never');

  // Unsold ones stay and fill the cap; sold-out ones leave; an artisan gone takes theirs.
  const shelf = [
    { id: 1, name: 'Potion of Watchful Rest', source: 'artisan_magic', artisan_id: 42, stock: 1, rarity: 'Common' },
    { id: 2, name: 'Bag of Holding', source: 'artisan_magic', artisan_id: 42, stock: 1, rarity: 'Uncommon' },
    { id: 3, name: 'Potion of Climbing', source: 'artisan_magic', artisan_id: 42, stock: 0, rarity: 'Common' },
    { id: 4, name: 'Old Ring', source: 'artisan_magic', artisan_id: 99, stock: 1, rarity: 'Uncommon' }
  ];
  result = run({ shelf });
  assert.ok(!result.remove.includes(1) && !result.remove.includes(2), 'unsold ones stay');
  assert.ok(result.remove.includes(3), 'sold out');
  assert.ok(result.remove.includes(4), 'their artisan is away or gone');
  assert.equal(result.insert.filter(row => row.source === 'artisan_magic').length, 1, 'room for one under the cap of 3');
  assert.equal(run({ shelf, event: { kind: 'shortage', params: { target: 'magic' } } }).insert.filter(row => row.source === 'artisan_magic').length, 0, 'a magic shortage');
  assert.equal(run({ artisanMagic: [{ ...pawn, scheduled: true }] }).insert.filter(row => row.source === 'artisan_magic').length, 0, 'scheduled: they bring them on delivery');

  // The form: saved and checked.
  const id = db.saveArtisan({ name: 'Old Wexley', active: true, magic_common: '2', magic_uncommon: '1', magic_rare: '0', magic_cap: '4' });
  const saved = db.listArtisans().find(artisan => artisan.id === id);
  assert.deepEqual([saved.magic_common, saved.magic_uncommon, saved.magic_rare, saved.magic_cap], [2, 1, 0, 4]);
  assert.throws(() => db.saveArtisan({ id, name: 'Old Wexley', active: true, magic_common: '1', magic_cap: '0' }), /hold at once/);
  db.saveArtisan({ id, name: 'Old Wexley the Pawnbroker', active: true });
  assert.equal(db.listArtisans().find(artisan => artisan.id === id).magic_cap, 4, 'other forms keep it');
  assert.deepEqual(db.activeArtisanMagic().find(entry => entry.id === id), { id, name: 'Old Wexley the Pawnbroker', common: 2, uncommon: 1, rare: 0, cap: 4, scheduled: false });
  db.deleteArtisan(id);
});

test('pawned items stand out in the shop with an outline', () => {
  db.prepare("INSERT INTO items (name, category, price, stock, description, source, rarity, artisan_id) VALUES ('Pawned Lute of Echoes', 'Wondrous', 5000, 1, 'Echo.', 'artisan_magic', 'Common', 1)").run();
  const renderAdminPage = require('../views/adminPage');
  const html = renderAdminPage({ session: { user: { id: 0, discord_tag: 'Root DM', role: 'admin' } }, query: { tab: 'items' } });
  assert.match(html, /class="shop-row-pawned" title="Pawned goods[^"]*">[\s\S]*?Pawned Lute of Echoes<\/strong><span class="visually-hidden"> \(pawned\)/);
  assert.doesNotMatch(html.replace(/[\s\S]*Pawned Lute of Echoes/, ''), /^[\s\S]{0,40}shop-row-pawned/, 'only that row');
});
