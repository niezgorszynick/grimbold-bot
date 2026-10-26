const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

function addCharacter(playerId, name) {
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, '{}')
  `).run(playerId, name).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary) VALUES (?, ?, ?, 3, 1)')
    .run(id, 'Fighter', 'Champion');
  return id;
}
const exists = id => Boolean(db.prepare('SELECT 1 FROM characters WHERE id = ?').get(id));

test('players delete their own characters (typing the name); not others\'', () => {
  const ola = createPlayer();
  const tom = createPlayer();
  const kael = addCharacter(ola, 'Kael Stormborn');
  const asOla = { id: ola, role: 'player' };

  assert.throws(() => db.removeCharacter({ characterId: kael, user: { id: tom, role: 'player' }, confirmName: 'Kael Stormborn' }), /Forbidden/);
  assert.throws(() => db.removeCharacter({ characterId: kael, user: asOla, confirmName: 'Kael' }), /Type "Kael Stormborn" to confirm/);
  assert.ok(exists(kael));
  assert.deepEqual(db.removeCharacter({ characterId: kael, user: asOla, confirmName: ' kael stormborn ' }), { deleted: true, name: 'Kael Stormborn' });
  assert.equal(exists(kael), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_classes WHERE character_id = ?').get(kael).n, 0, 'class rows go too');
  assert.throws(() => db.removeCharacter({ characterId: kael, user: asOla, confirmName: 'Kael Stormborn' }), /not found/);
});

test('not while in a running adventure (a DM takes them out), nor with an open auction', () => {
  const dm = createPlayer();
  const ola = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('del-dm', dm);
  const brin = addCharacter(ola, 'Brin');
  const asOla = { id: ola, role: 'player' };
  const { adventure } = db.createAdventureFromThread({ threadId: 'del-thread', title: 'The Long Road', ownerDiscordId: 'del-dm' });
  const asDm = { adventureId: adventure.id, user: { id: dm, role: 'player' } };
  db.setPartyMember({ ...asDm, characterId: brin, inParty: true });
  const encounterId = db.createEncounter({ ...asDm, name: 'Bridge' }).encounters.list[0].id;
  db.addEncounterCharacters({ ...asDm, encounterId, characterId: brin });

  assert.throws(() => db.removeCharacter({ characterId: brin, user: asOla, confirmName: 'Brin' }), /party of "The Long Road", which is still running/);
  assert.ok(exists(brin));

  // Selling at auction: gold or an item is held, so nobody deletes them.
  const auction = Number(db.prepare(`
    INSERT INTO auctions (seller_character_id, seller_player_id, item_name, rarity, item_data, value_cp, opening_bid_cp, npc_cap_cp, status, created_at, ends_at)
    VALUES (?, ?, 'Cloak of Protection', 'Uncommon', '{}', 50000, 25000, 0, 'open', '2026-01-01', '2026-01-08')
  `).run(brin, ola).lastInsertRowid);
  assert.throws(() => db.removeCharacter({ characterId: brin, user: { id: 0, role: 'admin' } }), /auction for Cloak of Protection/);
  db.prepare("UPDATE auctions SET status = 'sold' WHERE id = ?").run(auction);

  // A DM may: the running party and the fight lose them; the adventure stays.
  db.removeCharacter({ characterId: brin, user: { id: 0, role: 'admin' } });
  assert.equal(exists(brin), false);
  const table = db.getAdventureTable(asDm);
  assert.deepEqual(table.party, []);
  assert.deepEqual(table.encounters.list[0].combatants, []);
});

test("the Players tab's delete cleans up the same way", () => {
  const ola = createPlayer();
  const id = addCharacter(ola, 'Odo');
  db.deleteCharacter(id);
  assert.equal(exists(id), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_classes WHERE character_id = ?').get(id).n, 0);
});
