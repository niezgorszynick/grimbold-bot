const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { db, createPlayer } = require('./helpers/tempDatabase');
const { MIGRATIONS, runMigrations } = require('../db/migrations');

process.env.ADVENTURE_CHANNEL_ID = 'chan-zlecenia';
const threads = require('../adventureThreads');

const discordIdOf = playerId => db.prepare('SELECT discord_id FROM players WHERE id = ?').get(playerId).discord_id;
const addCharacter = (playerId, name, xp = 2) => Number(db.prepare(`
  INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
  VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, ?, 'alive', 0, '{}')
`).run(playerId, name, xp).lastInsertRowid);

test('an adventure can award 0 XP: nobody gains any, it is on record, and Grimbrandt says so', async () => {
  const dm = createPlayer();
  const hero = addCharacter(createPlayer(), 'Brunhilda', 2);
  const posts = [];
  const hook = { name: 'Grimbrandt', owner: { id: 'bot' }, send: async message => { posts.push(message); } };
  const thread = {
    id: 'thread-zero', guildId: 'guild-1', parentId: 'chan-zlecenia', name: 'Pusta jaskinia', ownerId: discordIdOf(dm), createdTimestamp: Date.now() + 1000,
    joinable: true, join: async () => {}, send: async () => {}, setName: async name => { thread.name = name; },
    parent: { id: 'chan-zlecenia', fetchWebhooks: async () => [hook], createWebhook: async () => hook }
  };
  threads.setClientForTests({ user: { id: 'bot' }, channels: { fetch: async id => (id === thread.id ? thread : null) } });
  try {
    const adventure = await threads.logAdventureThread(thread);
    const asDm = { adventureId: adventure.id, user: { id: dm, role: 'player' } };
    db.setPartyMember({ ...asDm, characterId: hero, inParty: true });
    const points = db.prepare('SELECT dm_points FROM players WHERE id = ?').get(dm).dm_points;

    assert.deepEqual(db.finishAdventure({ ...asDm, xp: 0 }), { adventureId: adventure.id, party: 1, xp: 0, dmReward: 'point' });
    assert.equal(db.getCharacterById(hero).xp, 2, 'no XP gained');
    assert.equal(db.getAdventureById(adventure.id).xp_awarded, 0);
    assert.equal(db.prepare('SELECT xp FROM adventure_rewards WHERE adventure_id = ? AND character_id = ?').get(adventure.id, hero).xp, 0, 'still on record as taking part');
    assert.equal(db.prepare('SELECT dm_points FROM players WHERE id = ?').get(dm).dm_points, points + 1, 'the DM still ran it');

    await threads.announceAdventureEnd(adventure.id);
    assert.match(posts[posts.length - 1].content, /Brunhilda/);
    assert.match(posts[posts.length - 1].content, /0 XP|zero|nothing/i);
  } finally {
    threads.setClientForTests(null);
  }

  // The older Adventures form keeps 0 as 0 (an empty value is still 1).
  const kept = db.recordAdventure({ title: 'Nic', description: '', xp_awarded: '0', dm_player_id: null, dm_character_id: null, character_ids: [hero] });
  assert.equal(db.getAdventureById(kept.adventureId ?? kept).xp_awarded, 0);
});

test('migration 33 rebuilds adventures for 0 XP and keeps every row that points to them', () => {
  const file = path.join(os.tmpdir(), `grimbold-zero-xp-${process.pid}-${Date.now()}.sqlite`);
  const old = new Database(file);
  try {
    // A database as it was at version 32, with adventures in use.
    for (const migration of MIGRATIONS.filter(entry => entry.version <= 32)) {
      old.transaction(() => { migration.up(old); old.pragma(`user_version = ${migration.version}`); })();
    }
    old.prepare("INSERT INTO players (discord_id, discord_tag) VALUES ('p1', 'Ola')").run();
    old.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
      VALUES (1, 'Kael', 'Human', 'Fighter', 'Champion', 3, 2, 'alive', 0, '{}')`).run();
    for (const title of ['Wilki', 'Ruiny', 'Dynie']) old.prepare("INSERT INTO adventures (title, xp_awarded, status) VALUES (?, 2, 'completed')").run(title);
    old.prepare('DELETE FROM adventures WHERE id = 3').run(); // the next id must still be 4
    old.prepare('INSERT INTO adventure_party (adventure_id, character_id) VALUES (1, 1)').run();
    old.prepare('INSERT INTO adventure_rewards (adventure_id, character_id, xp) VALUES (1, 1, 2)').run();
    old.prepare("INSERT INTO sessions (adventure_id, starts_at, ends_at) VALUES (2, '2026-12-01T19:00:00Z', '2026-12-01T23:00:00Z')").run();
    assert.throws(() => old.prepare("INSERT INTO adventures (title, xp_awarded) VALUES ('x', 0)").run(), /CHECK/);

    runMigrations(old);
    assert.equal(old.pragma('user_version', { simple: true }), MIGRATIONS[MIGRATIONS.length - 1].version);
    assert.equal(old.pragma('foreign_keys', { simple: true }), 1, 'foreign keys back on');
    assert.deepEqual(old.prepare('SELECT id, title FROM adventures ORDER BY id').all(), [{ id: 1, title: 'Wilki' }, { id: 2, title: 'Ruiny' }]);
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM adventure_party').get().n, 1);
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM adventure_rewards').get().n, 1);
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.ok(old.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'adventures_discord_thread'").get(), 'its index is back');
    assert.equal(Number(old.prepare("INSERT INTO adventures (title, xp_awarded) VALUES ('Zero', 0)").run().lastInsertRowid), 4);
    assert.throws(() => old.prepare("INSERT INTO adventures (title, xp_awarded) VALUES ('x', -1)").run(), /CHECK/);
    // Cascades still work through the rebuilt table.
    old.prepare('DELETE FROM adventures WHERE id = 1').run();
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM adventure_party').get().n, 0);
  } finally {
    old.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  }
});
