const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

const root = { id: 0, role: 'admin' };
const addCharacter = (playerId, name, xp = 0) => Number(db.prepare(`
  INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
  VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, ?, 'alive', 0, '{}')
`).run(playerId, name, xp).lastInsertRowid);
const xpOf = id => db.getCharacterById(id).xp;
const pointsOf = id => db.prepare('SELECT dm_points FROM players WHERE id = ?').get(id).dm_points;

test('deleting test adventures: finished ones give their XP and DM reward back; running ones must be cancelled first', () => {
  const dm = createPlayer('admin');
  const ola = createPlayer();
  const kael = addCharacter(ola, 'Kael', 2);
  const dmHero = addCharacter(dm, 'DM Hero', 2);
  const asDm = { id: dm, role: 'admin' };
  const open = title => db.startAdventure({ title, dmPlayerId: dm });

  // A finished test adventure: +3 XP to Kael, +1 DM point banked.
  const points = pointsOf(dm);
  const finished = open('Test');
  db.setPartyMember({ adventureId: finished, user: asDm, characterId: kael, inParty: true });
  db.setAdventureHex({ user: root, adventureId: finished, hex: '9.6' });
  db.finishAdventure({ adventureId: finished, user: asDm, xp: 3 });
  assert.deepEqual([xpOf(kael), pointsOf(dm)], [5, points + 1]);

  // Another, with the DM reward on the DM's own character.
  const second = open('teścik');
  db.setPartyMember({ adventureId: second, user: asDm, characterId: kael, inParty: true });
  db.finishAdventure({ adventureId: second, user: asDm, xp: 1, dmCharacterId: dmHero });
  assert.deepEqual([xpOf(kael), xpOf(dmHero)], [6, 3]);

  const running = open('123');
  const cancelled = open('testing testing');
  db.cancelAdventure({ adventureId: cancelled, user: asDm });
  assert.deepEqual(db.getWorldMap({ user: root }).routes.map(route => route.title).sort(), ['123', 'Test', 'teścik'], 'cancelled ones are not on the map');
  assert.deepEqual(db.getCancelledAdventures().map(adventure => adventure.title), ['testing testing']);

  assert.throws(() => db.deleteAdventure({ adventureId: finished, user: { id: ola, role: 'player' } }), /Only a DM/);
  assert.throws(() => db.deleteAdventure({ adventureId: running, user: asDm }), /still running: cancel it/);

  assert.deepEqual(db.deleteAdventure({ adventureId: finished, user: asDm }), { title: 'Test', xpTakenBack: 1 });
  assert.deepEqual([xpOf(kael), pointsOf(dm)], [3, points], 'its XP and DM point taken back');
  assert.equal(db.getAdventureById(finished), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM adventure_hexes WHERE adventure_id = ?').get(finished).n, 0, 'its map route goes too');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM adventure_rewards WHERE adventure_id = ?').get(finished).n, 0);

  db.deleteAdventure({ adventureId: second, user: asDm });
  assert.deepEqual([xpOf(kael), xpOf(dmHero)], [2, 2], 'back where they started');
  db.deleteAdventure({ adventureId: cancelled, user: asDm });
  assert.deepEqual(db.getCancelledAdventures(), []);
  assert.deepEqual(db.getWorldMap({ user: root }).routes.map(route => route.title), ['123']);
  assert.throws(() => db.deleteAdventure({ adventureId: cancelled, user: asDm }), /not found/);
});
