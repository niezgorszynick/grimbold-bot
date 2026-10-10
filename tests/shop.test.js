const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const shop = require('../shop');
const { getWeekKey } = require('../rollTracker');

let itemCount = 0;
function addItem({ price = 500, stock = null } = {}) {
  itemCount += 1;
  const name = `Test Potion ${itemCount}`;
  db.addItem({ name, category: 'Potions', price, stock, description: 'Bubbly.' });
  return name;
}

function addCharacter(playerId, { goldCp = 1000, status = 'alive' } = {}) {
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Mira', 'Elf', 'Rogue', 'Thief', 3, 0, ?, ?, '{"equipmentText":"Dagger"}')
  `).run(playerId, status, goldCp).lastInsertRowid);
  return id;
}

const character = id => db.prepare('SELECT gold_cp, gold_gp, sheet_data FROM characters WHERE id = ?').get(id);

test('a purchase takes gold, stock and adds the item to the sheet and ledger', () => {
  const player = createPlayer();
  const id = addCharacter(player, { goldCp: 1237 });
  const itemName = addItem({ price: 500, stock: 3 });

  const result = shop.purchaseItem({ itemName, quantity: 2, characterId: id, playerId: player, buyerTag: 'mira#1', buyerDiscordId: 'disc-1' });
  assert.equal(result.totalCostCp, 1000);
  assert.equal(result.character.gold_cp, 237);
  assert.equal(result.remainingStock, 1);

  const after = character(id);
  assert.equal(after.gold_cp, 237);
  assert.equal(after.gold_gp, 2.37); // mirrored for the previous app version
  const sheet = JSON.parse(after.sheet_data);
  assert.deepEqual(sheet.inventory, [{ name: itemName, quantity: 2, source: 'shop' }]);
  assert.equal(sheet.equipmentText, `Dagger\nBought: ${itemName} ×2`);

  const sale = db.prepare('SELECT * FROM sales WHERE item_name = ?').get(itemName);
  assert.equal(sale.character_id, id);
  assert.equal(sale.total_paid, 1000);
  assert.equal(db.prepare('SELECT stock FROM items WHERE name = ?').get(itemName).stock, 1);
});

test('the weekly roll changes the price', () => {
  const player = createPlayer();
  const id = addCharacter(player);
  const itemName = addItem({ price: 1000 });
  db.saveRoll('disc-roller', 'roller', getWeekKey(), 20); // natural 20: -20%
  const result = shop.purchaseItem({ itemName, characterId: id, playerId: player, buyerDiscordId: 'disc-roller' });
  assert.equal(result.discountPercent, -20);
  assert.equal(result.totalCostCp, 800);
});

test('refused purchases change nothing', () => {
  const player = createPlayer();
  const other = createPlayer();
  const id = addCharacter(player, { goldCp: 400 });
  const itemName = addItem({ price: 500, stock: 1 });
  const buy = overrides => shop.purchaseItem({ itemName, characterId: id, playerId: player, ...overrides });

  assert.throws(() => buy({}), shop.PurchaseError);
  assert.throws(() => buy({}), /Insufficient funds. Mira has 4 gp, but this costs 5 gp/);
  assert.throws(() => buy({ playerId: other }), /doesn't belong to you/);
  assert.throws(() => buy({ quantity: 2 }), /Insufficient stock. Only 1 left/);
  assert.throws(() => buy({ quantity: 0 }), /Invalid quantity/);
  assert.throws(() => buy({ itemName: 'Nothing Here' }), /not available/);
  const dead = addCharacter(player, { goldCp: 9999, status: 'dead' });
  assert.throws(() => buy({ characterId: dead }), /no longer among the living/);

  assert.equal(character(id).gold_cp, 400);
  assert.equal(db.prepare('SELECT stock FROM items WHERE name = ?').get(itemName).stock, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales WHERE item_name = ?').get(itemName).n, 0);
});

test('shopping characters and Discord lookup', () => {
  const player = createPlayer();
  addCharacter(player, { goldCp: 50 });
  addCharacter(player, { status: 'dead' });
  assert.deepEqual(shop.getShoppingCharacters(player).map(c => c.gold_cp), [50]);
  const discordId = db.prepare('SELECT discord_id FROM players WHERE id = ?').get(player).discord_id;
  assert.equal(shop.findPlayerByDiscordId(discordId).id, player);
  assert.equal(shop.findPlayerByDiscordId('nobody'), null);
});

test('DM gold edits are in gp with up to two decimals', () => {
  const player = createPlayer();
  const id = addCharacter(player);
  assert.equal(db.updateCharacterGold(id, '12.37').newGoldCp, 1237);
  assert.equal(character(id).gold_gp, 12.37);
  assert.throws(() => db.updateCharacterGold(id, '1.234'), /two decimal places/);
  assert.throws(() => db.updateCharacterGold(id, '-5'), /non-negative/);
  assert.throws(() => db.updateCharacterGold(9999, '1'), /Character not found/);
});
