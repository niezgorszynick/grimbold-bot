const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

process.env.ADVENTURE_CHANNEL_ID = 'chan-zlecenia';
process.env.PANEL_URL = 'https://panel.example/';
const threads = require('../adventureThreads');

const discordIdOf = playerId => db.prepare('SELECT discord_id FROM players WHERE id = ?').get(playerId).discord_id;
const userOf = (playerId, role = 'player') => ({ id: playerId, role });
function addCharacter(playerId, name, { status = 'alive', xp = 0 } = {}) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, ?, ?, 0, '{}')
  `).run(playerId, name, xp, status).lastInsertRowid);
}
let threadCount = 0;
function fakeThread({ parentId = 'chan-zlecenia', name = 'Zlecenie: Wilki z Doliny', ownerId, createdTimestamp = Date.now() + 1000 } = {}) {
  threadCount += 1;
  const sent = [];
  const thread = { id: `thread-${threadCount}`, guildId: 'guild-1', parentId, name, ownerId, createdTimestamp, sent, send: async message => { sent.push(message); } };
  Object.assign(thread, { joinable: true, joined: false, join: async () => { thread.joined = true; } });
  return thread;
}

test('a new thread in the adventures channel opens an active adventure run by its starter', async () => {
  const dm = createPlayer();
  assert.equal(await threads.logAdventureThread(fakeThread({ parentId: 'other-channel', ownerId: discordIdOf(dm) })), null);

  const thread = fakeThread({ ownerId: discordIdOf(dm) });
  const adventure = await threads.logAdventureThread(thread);
  assert.equal(adventure.status, 'active');
  assert.equal(adventure.title, 'Zlecenie: Wilki z Doliny');
  assert.equal(adventure.dm_player_id, dm);
  assert.equal(adventure.discord_thread_id, thread.id);
  assert.equal(thread.joined, true, 'the bot joins the thread');
  assert.equal(thread.sent.length, 1);
  assert.match(thread.sent[0].content, /Grimbrandt/);
  assert.ok(thread.sent[0].content.includes(`<@${discordIdOf(dm)}>`), 'the DM is asked to list the company');
  assert.match(thread.sent[0].content, new RegExp(`https://panel\\.example/admin\\?tab=adventures&table=${adventure.id}`));

  // The same thread again (e.g. after a restart) does not open a second adventure.
  assert.equal((await threads.logAdventureThread(thread)).id, adventure.id);
  assert.equal(thread.sent.length, 1);

  // Renaming the thread renames the adventure.
  assert.equal(await threads.renameAdventureThread({ name: thread.name }, { ...thread, name: 'Wilki z Doliny (cz. 1)' }), true);
  assert.equal(db.getAdventureById(adventure.id).title, 'Wilki z Doliny (cz. 1)');

  // Threads from before the feature was switched on are left alone.
  assert.equal(await threads.logAdventureThread(fakeThread({ ownerId: discordIdOf(dm), createdTimestamp: 1000 })), null);

  // A thread started by someone without a panel account: no DM yet.
  const stranger = await threads.logAdventureThread(fakeThread({ ownerId: 'unknown-discord-user' }));
  assert.equal(stranger.dm_player_id, null);
  assert.ok(db.getActiveAdventures().some(row => row.id === adventure.id && row.thread_url === `https://discord.com/channels/guild-1/${thread.id}`));
  assert.ok(!db.getAllAdventures().some(row => row.id === adventure.id), 'running adventures are not in the history');
});

test('the DM builds the party; party players can look; others cannot', async () => {
  const dm = createPlayer();
  const alice = createPlayer();
  const outsider = createPlayer();
  const adventure = await threads.logAdventureThread(fakeThread({ ownerId: discordIdOf(dm) }));
  const hero = addCharacter(alice, 'Hero');
  const ghost = addCharacter(alice, 'Ghost', { status: 'dead' });

  const asDm = { adventureId: adventure.id, user: userOf(dm) };
  let table = db.getAdventureTable(asDm);
  assert.equal(table.canManage, true);
  assert.ok(table.candidates.some(row => row.id === hero));
  assert.ok(!table.candidates.some(row => row.id === ghost), 'only the living can join');

  table = db.setPartyMember({ ...asDm, characterId: hero, inParty: true });
  assert.deepEqual(table.party.map(member => member.name), ['Hero']);
  assert.ok(table.party[0].hp && table.party[0].saves && Array.isArray(table.party[0].spellSlots), 'detailed party cards');
  assert.throws(() => db.setPartyMember({ ...asDm, characterId: ghost, inParty: true }), /not among the living/);

  const asAlice = db.getAdventureTable({ adventureId: adventure.id, user: userOf(alice) });
  assert.equal(asAlice.canManage, false);
  assert.deepEqual(asAlice.candidates, []);
  assert.throws(() => db.setPartyMember({ adventureId: adventure.id, user: userOf(alice), characterId: hero, inParty: false }), /Forbidden/);
  assert.throws(() => db.getAdventureTable({ adventureId: adventure.id, user: userOf(outsider) }), /Forbidden/);
  assert.equal(db.getAdventureTable({ adventureId: adventure.id, user: userOf(outsider, 'admin') }).canManage, true);
  assert.deepEqual(db.getAdventuresForUser(userOf(alice)).map(row => row.id), [adventure.id]);
  assert.deepEqual(db.getAdventuresForUser(userOf(outsider)).map(row => row.id).includes(adventure.id), false);
});

test('finishing awards XP to the party and the DM reward; nothing before that', async () => {
  const dm = createPlayer();
  const bob = createPlayer();
  const dmHero = addCharacter(dm, 'DM Hero', { xp: 2 });
  const a = addCharacter(bob, 'A', { xp: 2 });
  const b = addCharacter(bob, 'B', { xp: 0 });
  const adventure = await threads.logAdventureThread(fakeThread({ ownerId: discordIdOf(dm) }));
  const asDm = { adventureId: adventure.id, user: userOf(dm) };
  const xpOf = id => db.getCharacterById(id).xp;

  assert.throws(() => db.finishAdventure({ ...asDm, xp: 1 }), /Add the characters/);
  db.setPartyMember({ ...asDm, characterId: a, inParty: true });
  db.setPartyMember({ ...asDm, characterId: b, inParty: true });
  assert.equal(xpOf(a), 2, 'no XP while the adventure runs');
  assert.throws(() => db.updateAdventure({ adventure_id: adventure.id, title: 'x', xp_awarded: 1, character_ids: [a] }), /still running/);
  assert.throws(() => db.finishAdventure({ ...asDm, xp: 1, dmCharacterId: a }), /DM's own characters/);
  assert.throws(() => db.finishAdventure({ ...asDm, xp: 0 }), /from 1 to 20/);

  const result = db.finishAdventure({ ...asDm, xp: 1, dmCharacterId: dmHero, notes: 'The wolves fled.', title: 'Wilki' });
  assert.deepEqual(result, { adventureId: adventure.id, party: 2, xp: 1, dmReward: 'character' });
  assert.equal(xpOf(a), 3);
  assert.equal(db.getCharacterById(a).level, 4, 'reaching 3 XP is level 4');
  assert.equal(xpOf(b), 1);
  assert.equal(xpOf(dmHero), 3);
  const finished = db.getAdventureById(adventure.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.title, 'Wilki');
  assert.ok(db.getAllAdventures().some(row => row.id === adventure.id));
  assert.deepEqual(db.getAdventureParticipantIds(adventure.id).sort(), [a, b].sort());
  assert.throws(() => db.setPartyMember({ ...asDm, characterId: a, inParty: false }), /no longer running/);
  assert.deepEqual(db.getAdventureTable(asDm).party.map(member => member.id).sort(), [a, b].sort(), 'the finished table shows who took part');

  // Without a DM character the point is banked with the DM.
  const next = await threads.logAdventureThread(fakeThread({ ownerId: discordIdOf(dm) }));
  db.setPartyMember({ adventureId: next.id, user: userOf(dm), characterId: b, inParty: true });
  const points = db.prepare('SELECT dm_points FROM players WHERE id = ?').get(dm).dm_points;
  db.finishAdventure({ adventureId: next.id, user: userOf(dm), xp: 2 });
  assert.equal(db.prepare('SELECT dm_points FROM players WHERE id = ?').get(dm).dm_points, points + 1);
  assert.equal(xpOf(b), 3);
});

test('a cancelled adventure awards nothing', async () => {
  const dm = createPlayer();
  const hero = addCharacter(createPlayer(), 'Lone', { xp: 1 });
  const adventure = await threads.logAdventureThread(fakeThread({ ownerId: discordIdOf(dm) }));
  db.setPartyMember({ adventureId: adventure.id, user: userOf(dm), characterId: hero, inParty: true });
  db.cancelAdventure({ adventureId: adventure.id, user: userOf(dm) });
  assert.equal(db.getAdventureById(adventure.id).status, 'cancelled');
  assert.equal(db.getCharacterById(hero).xp, 1);
  assert.ok(!db.getActiveAdventures().some(row => row.id === adventure.id));
  assert.ok(!db.getAllAdventures().some(row => row.id === adventure.id));
});

test('Grimbrandt speaks through a webhook and tags finished threads', async () => {
  const dm = createPlayer();
  const hero = addCharacter(createPlayer(), 'Brunhilda');
  const posts = [];
  const hook = { name: 'Grimbrandt', owner: { id: 'bot' }, send: async message => { posts.push(message); } };
  const parent = {
    id: 'chan-zlecenia',
    availableTags: [{ id: 'tag-open', name: 'Otwarte' }, { id: 'tag-closed', name: 'Zamknięte' }],
    fetchWebhooks: async () => [],
    createWebhook: async ({ name }) => { assert.equal(name, 'Grimbrandt'); return hook; }
  };
  const thread = fakeThread({ name: 'Klątwa Czarnej Wieży (5–6)', ownerId: discordIdOf(dm) });
  thread.parent = parent;
  thread.appliedTags = ['tag-open'];
  thread.setName = async name => { thread.name = name; };
  thread.setAppliedTags = async tags => { thread.appliedTags = tags; };
  threads.setClientForTests({ user: { id: 'bot' }, channels: { fetch: async id => (id === thread.id ? thread : null) } });

  const adventure = await threads.logAdventureThread(thread);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].username, 'Grimbrandt');
  assert.equal(posts[0].threadId, thread.id);
  assert.equal(thread.sent.length, 0, 'not posted as the bot');

  // A DM tagging the thread by hand gets a reminder; the title stays clean.
  await threads.renameAdventureThread({ name: thread.name }, { ...thread, name: '[ZAMKNIĘTE] Klątwa Czarnej Wieży (5–6)' });
  assert.equal(db.getAdventureById(adventure.id).title, 'Klątwa Czarnej Wieży (5–6)');
  assert.match(posts[1].content, /Not in my book/);

  db.setPartyMember({ adventureId: adventure.id, user: userOf(dm), characterId: hero, inParty: true });
  db.finishAdventure({ adventureId: adventure.id, user: userOf(dm), xp: 2 });
  assert.equal(await threads.announceAdventureEnd(adventure.id), true);
  assert.equal(thread.name, '[ZAMKNIĘTE] Klątwa Czarnej Wieży (5–6)');
  assert.deepEqual(thread.appliedTags, ['tag-open', 'tag-closed']);
  assert.match(posts[2].content, /Brunhilda/);
  assert.match(posts[2].content, /2 XP/);

  // Tagged threads never open adventures; cancelled ones get [ANULOWANE].
  assert.equal(await threads.logAdventureThread(fakeThread({ name: '[ZAMKNIĘTE] Stare zlecenie', ownerId: discordIdOf(dm) })), null);
  const other = fakeThread({ name: 'Zlecenie bez chętnych', ownerId: discordIdOf(dm) });
  other.parent = parent;
  other.setName = async name => { other.name = name; };
  threads.setClientForTests({ user: { id: 'bot' }, channels: { fetch: async () => other } });
  const cancelled = await threads.logAdventureThread(other);
  db.cancelAdventure({ adventureId: cancelled.id, user: userOf(dm) });
  await threads.announceAdventureEnd(cancelled.id);
  assert.equal(other.name, '[ANULOWANE] Zlecenie bez chętnych');
  threads.setClientForTests(null);
});
