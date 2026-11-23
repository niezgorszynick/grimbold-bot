const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');
const shop = require('../shop');
const { setUserRoll } = require('../rollTracker');
const { saleMessage } = require('../characterThreads');

const insertCatalog = db.prepare(`INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock, rarity)
  VALUES (?, ?, ?, ?, '', 1, 1, 1, ?)`);
insertCatalog.run('Longsword', 'Weapon', 'common', 1500, '');
insertCatalog.run('Rope (50 feet)', 'Adventuring Gear', 'staple', 100, '');
insertCatalog.run('Ruby', 'Gems', 'rare', 5000, '');
insertCatalog.run('Cloak of Protection', 'Wondrous', 'magic', 40000, 'Uncommon');
const catalogId = name => db.prepare('SELECT id FROM catalog WHERE name = ?').get(name).id;

function addCharacter(playerId, inventory, goldCp = 0) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Odo', 'Halfling', 'Fighter', 'Champion', 3, 0, 'alive', ?, ?)
  `).run(playerId, goldCp, JSON.stringify({ inventory })).lastInsertRowid);
}
const character = id => db.prepare('SELECT gold_cp, sheet_data FROM characters WHERE id = ?').get(id);
const inventory = id => JSON.parse(character(id).sheet_data).inventory;
const discordOf = playerId => db.prepare('SELECT discord_id FROM players WHERE id = ?').get(playerId).discord_id;

test('the offer: half the price, moved by the weekly roll; treasure from the DM at full value', () => {
  assert.equal(rules.sellShare(0), 0.5);
  assert.equal(rules.sellShare(-20), 0.6);
  assert.equal(rules.sellShare(10), 0.45);
  const longsword = { base_price_cp: 1500, category: 'Weapon' };
  assert.equal(rules.gearOffer({ name: 'Longsword', source: 'shop' }, { catalogRow: longsword }).unitCp, 750);
  assert.equal(rules.gearOffer({ name: 'Longsword', source: 'class' }, { catalogRow: longsword, discountPercent: -15 }).unitCp, 863);
  const ruby = { base_price_cp: 5000, category: 'Gems' };
  assert.equal(rules.gearOffer({ name: 'Ruby', source: 'catalog', addedBy: 'dm' }, { catalogRow: ruby, discountPercent: -20 }).unitCp, 5000);
  assert.equal(rules.gearOffer({ name: 'Ruby', source: 'shop' }, { catalogRow: ruby }).unitCp, 2500, 'a bought gem is gear like any other');
});

test('a player sells paid-for gear: coins in the purse, the stack shrinks, the purse history says why', () => {
  const player = createPlayer();
  const id = addCharacter(player, [{ name: 'Rope (50 feet)', quantity: 3, source: 'shop' }, { name: 'Longsword', quantity: 1, source: 'class', equipped: true }], 200);
  const who = { id, player_id: player, is_admin: false };
  const view = db.getCharacterInventory(who);
  assert.equal(view.items[0].sale.unitCp, 50);
  assert.equal(view.saleRoll, null);

  const result = db.changeCharacterInventory({ ...who, action: 'sell', params: { index: 0, name: 'Rope (50 feet)', quantity: 2 } });
  assert.equal(result.message, 'Sold 2 × Rope (50 feet) to Grimbold for 1 gp.');
  assert.equal(character(id).gold_cp, 300);
  assert.equal(inventory(id)[0].quantity, 1);
  const change = db.prepare('SELECT * FROM gold_changes WHERE character_id = ?').get(id);
  assert.equal(change.reason, 'Sold 2 × Rope (50 feet) to Grimbold');

  // With a natural 20 this week: 60%.
  setUserRoll(discordOf(player), 'tester', 20);
  const sword = db.changeCharacterInventory({ ...who, action: 'sell', params: { index: 1, name: 'Longsword' } });
  assert.equal(sword.sold.unitCp, 900);
  assert.equal(sword.sold.roll, 20);
  assert.equal(inventory(id).length, 1);
  assert.equal(JSON.parse(character(id).sheet_data).soldStartingGear, true);
  assert.match(saleMessage(sword.sold, 'tester').text, /Longsword.*9 gp.*60% of the price \(weekly roll 20\)/);

  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'sell', params: { index: 0, name: 'Rope (50 feet)', quantity: 5 } }), /Sell from 1 to 1/);
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'sell', params: { index: 0, name: 'Longsword' } }), /list changed/);
});

test("a player can't sell what they added or topped up by hand, custom items or magic items; the DM can", () => {
  const player = createPlayer();
  const id = addCharacter(player, [
    { name: 'Rope (50 feet)', quantity: 1, source: 'shop' },
    { name: 'Lucky Stone', quantity: 1, source: 'custom' }
  ]);
  const who = { id, player_id: player, is_admin: false };
  // Added by the player: its own row, not stacked onto the bought rope.
  db.changeCharacterInventory({ ...who, action: 'add', params: { catalogId: catalogId('Rope (50 feet)'), quantity: 5 } });
  assert.deepEqual(inventory(id).map(row => [row.name, row.quantity]), [['Rope (50 feet)', 1], ['Lucky Stone', 1], ['Rope (50 feet)', 5]]);
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'sell', params: { index: 2, name: 'Rope (50 feet)' } }), /by hand/);
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'sell', params: { index: 1, name: 'Lucky Stone' } }), /Custom items/);
  const view = db.getCharacterInventory(who);
  assert.equal(view.items[2].sale.unitCp, 0);
  assert.match(view.items[2].sale.reason, /through the DM/);

  // Raising the bought rope's count by hand: no longer the player's to sell.
  db.changeCharacterInventory({ ...who, action: 'update', params: { index: 0, name: 'Rope (50 feet)', quantity: 9 } });
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'sell', params: { index: 0, name: 'Rope (50 feet)' } }), /by hand/);

  // The DM sells for them, and the DM's own additions (loot) are sellable.
  const dm = { id, player_id: 0, is_admin: true };
  assert.equal(db.changeCharacterInventory({ ...dm, action: 'sell', params: { index: 2, name: 'Rope (50 feet)', quantity: 5 } }).sold.totalCp, 250);
  db.changeCharacterInventory({ ...dm, action: 'add', params: { catalogId: catalogId('Ruby'), quantity: 1 } });
  const rubyIndex = inventory(id).findIndex(row => row.name === 'Ruby');
  assert.equal(db.changeCharacterInventory({ ...who, action: 'sell', params: { index: rubyIndex, name: 'Ruby' } }).sold.totalCp, 5000);
  assert.equal(db.getCharacterInventory(who).items.find(item => item.name === 'Lucky Stone').sale.unitCp, 0);
});

test('bought gear stays sellable: it stacks only with gear of the same kind', () => {
  const player = createPlayer();
  const id = addCharacter(player, [{ name: 'Rope (50 feet)', quantity: 2, source: 'catalog' }], 10000);
  db.prepare("INSERT INTO items (name, category, price, stock, description, is_active, source, rarity) VALUES ('Rope (50 feet)', 'Adventuring Gear', 100, NULL, '', 1, 'mundane', '')").run();
  shop.purchaseItem({ itemName: 'Rope (50 feet)', quantity: 1, characterId: id, playerId: player, buyerTag: 'tester', buyerDiscordId: discordOf(player) });
  assert.deepEqual(inventory(id).map(row => [row.source, row.quantity]), [['catalog', 2], ['shop', 1]]);
});

test('a DM lets the player sell gear added by hand: one item, or all blocked at once', () => {
  const player = createPlayer();
  const id = addCharacter(player, [
    { name: 'Rope (50 feet)', quantity: 1, source: 'catalog' },
    { name: 'Longsword', quantity: 1, source: 'class', unsellable: true },
    { name: 'Rope (50 feet)', quantity: 2, source: 'shop' },
    { name: 'Shaman bag', quantity: 1, source: 'custom' }
  ]);
  const asPlayer = { id, player_id: player, is_admin: false };
  const asDm = { id, player_id: 0, is_admin: true };
  let view = db.getCharacterInventory(asPlayer);
  assert.deepEqual(view.items.map(item => item.playerSaleBlocked), [true, true, false, false], 'custom items are not blocked, just unpriced');
  assert.equal(view.isAdmin, false);
  assert.match(view.items[0].sale.reason, /added to the list by hand/i);
  assert.throws(() => db.changeCharacterInventory({ ...asPlayer, action: 'sell', params: { index: 0, name: 'Rope (50 feet)' } }), /through the DM/);
  assert.throws(() => db.changeCharacterInventory({ ...asPlayer, action: 'allowSale', params: { index: 0, name: 'Rope (50 feet)', allowed: true } }), /Only a DM/);

  db.changeCharacterInventory({ ...asDm, action: 'allowSale', params: { index: 0, name: 'Rope (50 feet)', allowed: true } });
  view = db.getCharacterInventory(asPlayer);
  assert.equal(view.items[0].sellableByDm, true);
  assert.ok(view.items[0].sale.unitCp > 0);
  db.changeCharacterInventory({ ...asPlayer, action: 'sell', params: { index: 0, name: 'Rope (50 feet)' } });

  const all = db.changeCharacterInventory({ ...asDm, action: 'allowSaleAll' });
  assert.match(all.message, /1 more item/);
  assert.ok(db.getCharacterInventory(asPlayer).items.find(item => item.name === 'Longsword').sale.unitCp > 0, 'starting gear after a rebuild too');
  assert.equal(db.getCharacterInventory(asPlayer).items.find(item => item.name === 'Shaman bag').sale.unitCp, 0, 'a custom item still has no price');
  const blockedAgain = db.changeCharacterInventory({ ...asDm, action: 'allowSale', params: { index: 0, name: 'Longsword', allowed: false } });
  assert.equal(blockedAgain.inventory.items[0].playerSaleBlocked, true, 'and back');
});
