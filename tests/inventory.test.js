const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

const insertCatalog = db.prepare(`INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock)
  VALUES (?, ?, ?, 100, ?, 1, 1, 1)`);
const catalogId = name => db.prepare('SELECT id FROM catalog WHERE name = ?').get(name).id;
insertCatalog.run('Rope (50 feet)', 'Adventuring Gear', 'staple', 'Hempen rope.');
insertCatalog.run('Cloak of Protection', 'Wondrous', 'magic', 'A magic cloak.');
insertCatalog.run('Lodging (comfortable)', 'Services', 'service', 'A bed.');

function addCharacter(playerId, sheetData = {}) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Odo', 'Halfling', 'Rogue', 'Thief', 3, 0, 'alive', 0, ?)
  `).run(playerId, JSON.stringify(sheetData)).lastInsertRowid);
}
const sheet = id => JSON.parse(db.getCharacterById(id).sheet_data);

test('items come from the catalog (with its description) or are custom', () => {
  const player = createPlayer();
  const id = addCharacter(player, { inventory: [{ name: 'Rope (50 feet)', quantity: 1, source: 'creation' }] });
  const who = { id, player_id: player, is_admin: false };

  const view = db.getCharacterInventory(who);
  assert.equal(view.items[0].description, 'Hempen rope.', 'starting gear gets the catalog description');

  db.changeCharacterInventory({ ...who, action: 'add', params: { catalogId: catalogId('Rope (50 feet)'), quantity: 2 } });
  const result = db.changeCharacterInventory({ ...who, action: 'add', params: { name: "  Grandma's Locket ", description: 'Holds a tiny portrait.' } });
  assert.equal(result.message, "Added Grandma's Locket.");
  assert.deepEqual(sheet(id).inventory, [
    { name: 'Rope (50 feet)', quantity: 3, source: 'creation' },
    { name: "Grandma's Locket", quantity: 1, source: 'custom', description: 'Holds a tiny portrait.' }
  ]);
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'add', params: { name: ' ' } }), /Give the item a name/);
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'add', params: { catalogId: catalogId('Lodging (comfortable)') } }), /not in the catalog/);
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'add', params: { name: 'Pebble', quantity: 0 } }), /Quantity/);
});

test('changing or removing an item checks the list has not changed meanwhile', () => {
  const player = createPlayer();
  const id = addCharacter(player, { inventory: [{ name: 'Torch', quantity: 5 }, { name: 'Rations', quantity: 3 }] });
  const who = { id, player_id: player, is_admin: false };
  db.changeCharacterInventory({ ...who, action: 'update', params: { index: 0, name: 'Torch', quantity: 2 } });
  assert.equal(sheet(id).inventory[0].quantity, 2);
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'remove', params: { index: 0, name: 'Rations' } }), /list changed/);
  db.changeCharacterInventory({ ...who, action: 'remove', params: { index: 1, name: 'Rations' } });
  assert.deepEqual(sheet(id).inventory.map(row => row.name), ['Torch']);
  assert.throws(() => db.getCharacterInventory({ id, player_id: createPlayer(), is_admin: false }), /Forbidden/);
});

test('magic items from the catalog: only the DM adds them, into Magic Items', () => {
  const player = createPlayer();
  const id = addCharacter(player);
  const cloak = catalogId('Cloak of Protection');
  assert.throws(() => db.changeCharacterInventory({ id, player_id: player, is_admin: false, action: 'add', params: { catalogId: cloak } }),
    /magic item: buy it in the shop or ask your DM/);
  // A custom item may share a name; it is just a note on the player's list.
  db.changeCharacterInventory({ id, player_id: player, is_admin: false, action: 'add', params: { name: 'Cloak of Protection', description: 'A fake.' } });
  assert.equal((sheet(id).magicItems || []).length, 0);

  const result = db.changeCharacterInventory({ id, player_id: 0, is_admin: true, action: 'add', params: { catalogId: cloak } });
  assert.equal(result.message, 'Cloak of Protection added to Magic Items.');
  assert.deepEqual(sheet(id).magicItems.map(entry => entry.name), ['Cloak of Protection']);
});
