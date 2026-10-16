const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers/tempDatabase');
const rules = require('../rules');

function addCatalog(name, category, tier, gp, extra = {}) {
  db.addCatalogItem({ name, category, tier, base_price_cp: Math.round(gp * 100), description: 'Test entry.', min_level: 1, min_stock: 1, max_stock: 1, ...extra });
  return db.prepare('SELECT * FROM catalog WHERE name = ?').get(name);
}

test('catalog items get their rarity from the magic item list, the spell level or the price', () => {
  const classify = (name, category, tier, gp) => rules.classifyCatalogItem({ name, category, tier, base_price_cp: gp * 100 });
  assert.deepEqual(classify('Wand of Magic Missiles', 'Wand', 'magic', 8720),
    { rarity: 'Uncommon', priceCp: 40000, availability: 'shop', minLevel: 3, source: 'magic item list' }, 'an old odd price is corrected');
  assert.equal(classify('Potion of Superior Healing', 'Potion', 'magic', 502).priceCp, 200000, 'a Rare potion costs half of 4,000 gp');
  assert.equal(classify('Frost Brand', 'Weapon', 'magic', 40000).availability, 'adventure');
  assert.equal(classify('Spell Scroll (Level 1: Shield)', 'Spell Scroll', 'common', 50).rarity, 'Common');
  assert.equal(classify('Spell Scroll (Level 1: Shield)', 'Spell Scroll', 'common', 50).priceCp, null, 'scroll prices are kept');
  assert.equal(classify('Ring of Warmth', 'Ring', 'magic', 4000).rarity, 'Rare', 'not in the list: rarity from the price table');
  assert.equal(classify('Rope (50 feet)', 'Adventuring Gear', 'staple', 1).rarity, '', 'mundane gear has no rarity');
  assert.equal(classify('Breastplate', 'Armor', 'rare', 400).rarity, '', 'an expensive mundane armor is still mundane');
});

test('the review lists only what changes; applying it updates the ticked rows', () => {
  const wand = addCatalog('Wand of Magic Missiles', 'Wand', 'magic', 8720);
  const bag = addCatalog('Bag of Holding', 'Wondrous Item', 'magic', 400, { rarity: 'Uncommon', availability: 'shop' });
  const brand = addCatalog('Frost Brand', 'Weapon', 'magic', 40000);
  addCatalog('Rope (50 feet)', 'Adventuring Gear', 'staple', 1);
  db.prepare('UPDATE catalog SET min_level = 3 WHERE id = ?').run(bag.id);

  const review = db.reviewCatalogRarity();
  assert.deepEqual(review.map(entry => entry.name).sort(), ['Frost Brand', 'Wand of Magic Missiles']);
  assert.deepEqual(review.find(entry => entry.id === wand.id).changes, { rarity: 'Uncommon', base_price_cp: 40000, min_level: 3 });
  assert.deepEqual(review.find(entry => entry.id === brand.id).changes, { rarity: 'Very Rare', availability: 'adventure', min_level: 11 });

  assert.equal(db.applyCatalogRarityReview([wand.id]), 1, 'only the ticked row');
  assert.deepEqual(db.prepare('SELECT rarity, base_price_cp, availability FROM catalog WHERE id = ?').get(wand.id), { rarity: 'Uncommon', base_price_cp: 40000, availability: 'shop' });
  assert.equal(db.getCatalogItemById(brand.id).availability, 'shop', 'unticked rows stay as they were');
});

test('a DM can open a Rare item to the shop, never a Very Rare one', () => {
  const ring = addCatalog('Ring of Protection', 'Ring', 'magic', 4000, { rarity: 'Rare', availability: 'adventure', min_level: 5 });
  const update = changes => db.updateCatalogItem({ ...db.getCatalogItemById(ring.id), ...changes });
  update({ availability: 'shop' });
  assert.equal(db.getCatalogItemById(ring.id).availability, 'shop');
  assert.equal(db.reviewCatalogRarity().some(entry => entry.id === ring.id), false, "a DM's own choice isn't suggested back");
  assert.throws(() => update({ rarity: 'Very Rare', availability: 'shop' }), /adventures only/);
  assert.throws(() => addCatalog('Vorpal Thing', 'Weapon', 'magic', 200000, { rarity: 'Legendary', availability: 'shop' }), /adventures only/);
  assert.equal(addCatalog('Shiny Blade', 'Weapon', 'magic', 200000, { rarity: 'Legendary' }).availability, 'adventure', 'adventure only by default');
});

test('editing a catalog item on the shelf keeps its shelf price in copper', () => {
  const cloak = addCatalog('Cloak of Protection', 'Wondrous Item', 'magic', 400, { rarity: 'Uncommon' });
  db.prepare("INSERT INTO items (name, category, price, stock, description, is_active) VALUES ('Cloak of Protection', 'Wondrous Item', 40000, 1, 'x', 1)").run();
  db.updateCatalogItem({ ...cloak, base_price_cp: 45000 });
  assert.equal(db.prepare("SELECT price FROM items WHERE name = 'Cloak of Protection'").get().price, 45000);
});
