const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

test('players add any magic item from the catalog themselves; the DM can see it was them', () => {
  const insert = db.prepare(`INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock)
    VALUES (?, 'Potion', 'magic', 5000, '', 1, 1, 1)`);
  const potion = Number(insert.run('Potion of Healing').lastInsertRowid);
  const elixir = Number(insert.run('Elixir of Health').lastInsertRowid);
  const owner = createPlayer();
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Odo', 'Halfling', 'Rogue', 'Thief', 3, 0, 'alive', 0, '{}')
  `).run(owner).lastInsertRowid);
  const add = catalogId => db.changeCharacterInventory({ id, player_id: owner, is_admin: false, action: 'add', params: { catalogId, quantity: 2 } });

  assert.equal(add(potion).message, 'Potion of Healing added to Magic Items.');
  assert.equal(add(elixir).message, 'Elixir of Health added to Magic Items.', 'rare items too');
  const stored = JSON.parse(db.getCharacterById(id).sheet_data).magicItems;
  assert.deepEqual(stored.map(entry => [entry.name, entry.variant || null, entry.quantity, entry.source]),
    [['Potions of Healing', 'Healing', 2, 'player'], ['Elixir of Health', null, 2, 'player']]);
  assert.throws(() => db.changeCharacterInventory({ id, player_id: createPlayer(), is_admin: false, action: 'add', params: { catalogId: potion } }), /Forbidden/,
    "only on the player's own characters");
});
