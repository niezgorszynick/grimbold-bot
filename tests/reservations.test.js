const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const shop = require('../shop');
const threads = require('../characterThreads');

function addCharacter(playerId, name, goldCp) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, 0, 'alive', ?, '{}')
  `).run(playerId, name, goldCp).lastInsertRowid);
}
function shelve(name, { price = 10000, stock = 1, source = 'magic' } = {}) {
  return Number(db.prepare(`
    INSERT INTO items (name, category, price, stock, description, is_active, source, rarity, weeks) VALUES (?, 'Wondrous Item', ?, ?, '', 1, ?, 'Uncommon', 1)
  `).run(name, price, stock, source).lastInsertRowid);
}
const gold = id => db.getCharacterById(id).gold_cp;
const stillOnShelf = id => Boolean(db.prepare('SELECT 1 FROM items WHERE id = ?').get(id));

test('reserving: a 10% deposit, one per character and per item, rotating stock only', () => {
  const ola = createPlayer();
  const tom = createPlayer();
  const kael = addCharacter(ola, 'Kael', 5000);
  const brin = addCharacter(tom, 'Brin', 50000);
  shelve('Cloak of Mist');
  shelve('Lantern of Truth');
  db.prepare("INSERT INTO items (name, category, price, stock, description, is_active, source, rarity) VALUES ('Rope', 'Gear', 100, NULL, '', 1, 'mundane', '')").run();

  assert.throws(() => shop.reserveItem({ itemName: 'Rope', characterId: kael, playerId: ola }), /no need to reserve/);
  assert.throws(() => shop.reserveItem({ itemName: 'Cloak of Mist', characterId: kael, playerId: tom }), /doesn't belong to you/);
  const result = shop.reserveItem({ itemName: 'Cloak of Mist', characterId: kael, playerId: ola });
  assert.equal(result.reservation.depositCp, 1000);
  assert.equal(gold(kael), 4000);
  assert.equal(result.reservation.restocksLeft, 2);
  assert.throws(() => shop.reserveItem({ itemName: 'Lantern of Truth', characterId: kael, playerId: ola }), /already has Cloak of Mist reserved/);
  assert.throws(() => shop.reserveItem({ itemName: 'Cloak of Mist', characterId: brin, playerId: tom }), /already reserved by someone else/);
  const purse = db.prepare('SELECT reason, old_cp, new_cp FROM gold_changes WHERE character_id = ? ORDER BY id DESC').get(kael);
  assert.deepEqual(purse, { reason: "Deposit: Cloak of Mist reserved at Grimbold's", old_cp: 5000, new_cp: 4000 });
  assert.match(threads.reservationMessage('reserved', result.reservation).text, /ties a tag on \*\*Cloak of Mist\*\* for Kael.*Deposit: \*\*10 gp\*\*.*next 2 restocks/);

  // The reserver buys it: the deposit comes off.
  assert.throws(() => shop.purchaseItem({ itemName: 'Cloak of Mist', characterId: kael, playerId: ola }), /costs 90 gp \(after the 10 gp deposit\)/);
  db.prepare('UPDATE characters SET gold_cp = 9000 WHERE id = ?').run(kael);
  const bought = shop.purchaseItem({ itemName: 'Cloak of Mist', characterId: kael, playerId: ola });
  assert.deepEqual([bought.totalCostCp, bought.depositUsedCp, bought.character.gold_cp], [10000, 1000, 0]);
  assert.equal(db.getReservation(result.reservation.id).status, 'bought');
  assert.match(threads.purchaseMessage(bought, 'ola').text, /10 gp of it the deposit paid before/);
  // Free again for another reservation.
  db.prepare('UPDATE characters SET gold_cp = 5000 WHERE id = ?').run(kael);
  assert.equal(shop.reserveItem({ itemName: 'Lantern of Truth', characterId: kael, playerId: ola }).reservation.item, 'Lantern of Truth');
});

test('someone else buys the last one: the deposit comes back; giving up keeps it with Grimbold', () => {
  const ola = createPlayer();
  const tom = createPlayer();
  const kael = addCharacter(ola, 'Kael', 2000);
  const brin = addCharacter(tom, 'Brin', 100000);
  shelve('Scroll of Fog', { price: 5000, stock: 2, source: 'scroll' });
  const { reservation } = shop.reserveItem({ itemName: 'Scroll of Fog', characterId: kael, playerId: ola });
  assert.equal(gold(kael), 1500);

  let sale = shop.purchaseItem({ itemName: 'Scroll of Fog', characterId: brin, playerId: tom });
  assert.equal(sale.refundedReservation, null, 'one is still there');
  sale = shop.purchaseItem({ itemName: 'Scroll of Fog', characterId: brin, playerId: tom });
  assert.equal(sale.refundedReservation.status, 'refunded');
  assert.equal(gold(kael), 2000, 'the deposit is back');
  assert.match(threads.reservationMessage('refunded', sale.refundedReservation).text, /deposit is returned/);
  assert.equal(db.getReservation(reservation.id).status, 'refunded');

  shelve('Wand of Sparks', { price: 3000 });
  const again = shop.reserveItem({ itemName: 'Wand of Sparks', characterId: kael, playerId: ola }).reservation;
  assert.throws(() => db.cancelReservation({ reservationId: again.id, user: { id: tom, role: 'player' } }), /Forbidden/);
  const cancelled = db.cancelReservation({ reservationId: again.id, user: { id: ola, role: 'player' } });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(gold(kael), 1700, 'a player giving up loses the deposit');

  shelve('Ring of Echoes', { price: 3000 });
  const third = shop.reserveItem({ itemName: 'Ring of Echoes', characterId: kael, playerId: ola }).reservation;
  assert.equal(db.cancelReservation({ reservationId: third.id, user: { id: 0, role: 'admin' } }).status, 'refunded');
  assert.equal(gold(kael), 1700, 'a DM cancelling refunds it');
});

test('a reserved item stays through two restocks, then the reservation runs out', () => {
  const ola = createPlayer();
  const kael = addCharacter(ola, 'Kael', 5000);
  const amulet = shelve('Amulet of Dusk', { source: 'magic' });
  const scroll = shelve('Scroll of Echo', { price: 1000, source: 'scroll' });
  const { reservation } = shop.reserveItem({ itemName: 'Amulet of Dusk', characterId: kael, playerId: ola });

  let summary = db.runRestock({ random: () => 0.5 });
  assert.ok(stillOnShelf(amulet), 'held through the first restock (a magic item two weeks old would go)');
  assert.equal(stillOnShelf(scroll), false, 'unreserved scrolls go as usual');
  assert.deepEqual(summary.reserved.held.filter(entry => entry.id === reservation.id).map(entry => [entry.item, entry.restocksLeft]), [['Amulet of Dusk', 1]]);

  summary = db.runRestock({ random: () => 0.5 });
  assert.ok(stillOnShelf(amulet), 'and the second');
  assert.equal(db.getReservation(reservation.id).restocksLeft, 0);

  summary = db.runRestock({ random: () => 0.5 });
  assert.ok(summary.reserved.expired.some(entry => entry.id === reservation.id));
  assert.equal(db.getReservation(reservation.id).status, 'expired');
  assert.equal(stillOnShelf(amulet), false, 'then it leaves like any other');
  assert.equal(gold(kael), 4000, 'the deposit stays with Grimbold');

  // An item a DM took off the shelf: the deposit comes back at the next restock.
  const lamp = shelve('Lamp of Ages', { source: 'event' });
  const lampReservation = shop.reserveItem({ itemName: 'Lamp of Ages', characterId: kael, playerId: ola }).reservation;
  db.prepare('DELETE FROM items WHERE id = ?').run(lamp);
  summary = db.runRestock({ random: () => 0.5 });
  assert.deepEqual(summary.reserved.refunded.map(entry => entry.id), [lampReservation.id]);
  assert.equal(gold(kael), 4000);
});
