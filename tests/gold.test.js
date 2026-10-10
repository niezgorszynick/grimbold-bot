const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const { coinsToCp, splitCp } = require('../currency');
const threads = require('../characterThreads');

function addCharacter(playerId, name = 'Thorin Ironfist', goldCp = 1247) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Dwarf', 'Fighter', 'Champion', 3, 0, 'alive', ?, '{}')
  `).run(playerId, name, goldCp).lastInsertRowid);
}
const player = id => ({ id, role: 'player' });

test('purses are gold, silver and copper', () => {
  assert.deepEqual(splitCp(1247), { gp: 12, sp: 4, cp: 7 });
  assert.equal(coinsToCp({ gp: 12, sp: 4, cp: 7 }), 1247);
  assert.equal(coinsToCp({ gp: '3', sp: '', cp: undefined }), 300);
  assert.throws(() => coinsToCp({ sp: -1 }), /SP must be a whole number/);
  assert.throws(() => coinsToCp({ gp: 1.5 }), /GP must be a whole number/);
});

test('players edit their own purse; every change is logged with who and why', () => {
  const owner = createPlayer();
  const other = createPlayer();
  const id = addCharacter(owner);

  const change = db.setCharacterPurse({ characterId: id, user: player(owner), coins: { gp: 20, sp: 0, cp: 5 }, reason: 'Sold wolf pelts' });
  assert.equal(change.old_cp, 1247);
  assert.equal(change.new_cp, 2005);
  assert.equal(change.reason, 'Sold wolf pelts');
  assert.equal(change.changed_by, owner);
  assert.equal(change.changed_by_admin, 0);
  assert.equal(db.getCharacterById(id).gold_cp, 2005);

  assert.throws(() => db.setCharacterPurse({ characterId: id, user: player(other), coins: { gp: 999 } }), /Forbidden/);
  assert.throws(() => db.setCharacterPurse({ characterId: id, user: player(owner), coins: { gp: 20, cp: 5 } }), /already holds/);

  const byDm = db.setCharacterPurse({ characterId: id, user: { id: 0, role: 'admin' }, coins: { gp: 15 }, reason: 'Paid the ferryman' });
  assert.equal(byDm.changed_by, null);
  assert.equal(byDm.changed_by_admin, 1);

  const purse = db.getCharacterPurse({ characterId: id, user: player(owner) });
  assert.deepEqual(purse.coins, { gp: 15, sp: 0, cp: 0 });
  assert.deepEqual(purse.changes.map(entry => entry.reason), ['Paid the ferryman', 'Sold wolf pelts']);
});

test('a character thread can be set from a Discord link or ID', () => {
  assert.equal(db.parseThreadId('https://discord.com/channels/111111111111111111/1505600851039752999'), '1505600851039752999');
  assert.equal(db.parseThreadId('1505600851039752999'), '1505600851039752999');
  assert.equal(db.parseThreadId(''), null);
  assert.throws(() => db.parseThreadId('not a thread'), /thread link/);
  const id = addCharacter(createPlayer(), 'Linked');
  db.setCharacterThread(id, 'https://discord.com/channels/1/1505600851039752111');
  assert.equal(db.getCharacterById(id).discord_thread_id, '1505600851039752111');
});

test('Grimbold finds the character thread by name or by its owner', () => {
  const list = [
    { id: '1', name: 'Thorin Ironfist — karta postaci', ownerId: 'A' },
    { id: '2', name: 'Elara', ownerId: 'A' },
    { id: '3', name: 'Vex the Fiend', ownerId: 'B' },
    { id: '4', name: "Qual'danis Éversong", ownerId: 'C' }
  ];
  const pick = (name, playerDiscordId) => (threads.chooseThread(list, { name, playerDiscordId }) || {}).id || null;
  assert.equal(pick('Thorin Ironfist', 'A'), '1', 'by full name');
  assert.equal(pick("Qual'danis Eversong", 'X'), '4', 'ignoring accents and apostrophes');
  assert.equal(pick('Vex', 'B'), '3');
  assert.equal(pick('Elara Moonwhisper', 'A'), '2', "the player's thread named after the first name");
  assert.equal(pick('Nobody', 'Z'), null);
});

test("Grimbold's notes go to the character's thread and are remembered", async () => {
  const owner = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('owner-discord', owner);
  const id = addCharacter(owner, 'Brunhilda Stonefist', 5000);
  const sent = [];
  const thread = { id: '1505600851039755555', name: 'Brunhilda Stonefist', ownerId: 'owner-discord', send: async message => { sent.push(message); } };
  const channel = {
    threads: {
      fetchActive: async () => ({ threads: new Map([[thread.id, thread]]) }),
      fetchArchived: async () => ({ threads: new Map() })
    }
  };
  threads.setCharacterThreadsClient({ channels: { fetch: async channelId => (channelId === thread.id ? thread : channelId === '1505600851039752414' ? channel : null) } });

  const change = db.setCharacterPurse({ characterId: id, user: player(owner), coins: { gp: 42 }, reason: 'Found a hoard' });
  assert.equal(await threads.postToCharacterThread(id, threads.goldChangeMessage(change)), true);
  assert.equal(db.getCharacterById(id).discord_thread_id, thread.id, 'the thread is remembered');
  const fields = Object.fromEntries(sent[0].embeds[0].fields.map(field => [field.name, field.value]));
  assert.equal(fields.Before, '50 gp');
  assert.equal(fields.Now, '**42 gp**');
  assert.equal(fields.Change, '−8 gp');
  assert.equal(fields.Reason, 'Found a hoard');

  const receipt = threads.purchaseMessage({
    item: { name: 'Potion of Healing' }, quantity: 2, finalUnitPriceCp: 4500, totalCostCp: 9000, discountPercent: -10,
    character: { id, name: 'Brunhilda Stonefist', gold_cp: 1200 }
  }, 'brunhilda#1');
  assert.equal(await threads.postToCharacterThread(id, receipt), true);
  const receiptFields = Object.fromEntries(sent[1].embeds[0].fields.map(field => [field.name, field.value]));
  assert.equal(receiptFields.Item, '**Potion of Healing** ×2');
  assert.match(receiptFields.Cost, /90 gp\*\* \(45 gp each\) — 10% off/);
  assert.equal(receiptFields['Purse left'], '**12 gp**');

  // No thread and no client: nothing is posted, nothing breaks.
  const lonely = addCharacter(createPlayer(), 'Nobody Knows');
  assert.equal(await threads.postToCharacterThread(lonely, receipt), false);
  threads.setCharacterThreadsClient(null);
  assert.equal(await threads.postToCharacterThread(id, receipt), false);
});
