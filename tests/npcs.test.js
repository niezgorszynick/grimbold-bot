const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

test('NPCs: everyone reads the lore; stats and DM notes are for DMs', () => {
  assert.throws(() => db.saveNpc({ name: '  ' }), /needs a name/);
  assert.throws(() => db.saveNpc({ name: 'Kevah', sheet_url: 'javascript:alert(1)' }), /http/);
  assert.throws(() => db.saveNpc({ name: 'Kevah', str: 40 }), /STR must be a whole number from 1 to 30/);
  const id = db.saveNpc({
    name: 'Kevah', affiliation: 'Harpers', description: 'A wiry half-elf with a debt to pay.', sheet_url: 'https://example.com/kevah',
    dm_notes: 'Secretly reports to the Zhentarim.', armor_class: '15', hp_max: '27', speed: '30 ft.', dex: '16', wis: '13'
  });
  const forPlayers = db.listNpcs().find(npc => npc.id === id);
  assert.equal(forPlayers.affiliation, 'Harpers');
  assert.equal(forPlayers.stats, undefined, 'players see no stats');
  assert.equal(forPlayers.dmNotes, undefined, 'or DM notes');
  const forDm = db.getNpc(id, { showStats: true });
  assert.equal(forDm.stats.armorClass, 15);
  assert.equal(forDm.stats.hpCurrent, 27, 'current HP starts at the maximum');
  assert.deepEqual(forDm.stats.abilities.dex, { score: 16, modifier: 3 });
  assert.equal(forDm.dmNotes, 'Secretly reports to the Zhentarim.');
});

test('NPCs join adventures (the DM), take damage there, and keep their history', () => {
  const dm = createPlayer();
  const stranger = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('npc-dm', dm);
  const { adventure } = db.createAdventureFromThread({ threadId: 'npc-thread', title: 'The Sunken Shrine', ownerDiscordId: 'npc-dm' });
  const arleta = db.saveNpc({ name: 'Arleta', hp_max: 20 });
  const quiet = db.saveNpc({ name: 'Quiet Tom' });
  const asDm = { id: dm, role: 'player' };

  assert.throws(() => db.setAdventureNpc({ adventureId: adventure.id, user: { id: stranger, role: 'player' }, npcId: arleta, inAdventure: true }), /Forbidden/);
  const table = db.setAdventureNpc({ adventureId: adventure.id, user: asDm, npcId: arleta, inAdventure: true });
  assert.deepEqual(table.npcs.map(npc => npc.name), ['Arleta']);
  assert.equal(table.npcs[0].stats.hpMax, 20, 'the DM sees stats on the table');
  assert.ok(!table.npcCandidates.some(npc => npc.id === arleta));

  db.changeNpcHp({ adventureId: adventure.id, user: asDm, npcId: arleta, action: 'tempHp', amount: 5 });
  let result = db.changeNpcHp({ adventureId: adventure.id, user: asDm, npcId: arleta, action: 'damage', amount: 8 });
  assert.deepEqual([result.npc.hpCurrent, result.npc.hpTemp], [17, 0], 'temporary HP first');
  result = db.changeNpcHp({ adventureId: adventure.id, user: asDm, npcId: arleta, action: 'heal', amount: 50 });
  assert.equal(result.npc.hpCurrent, 20, 'never above the maximum');
  assert.throws(() => db.changeNpcHp({ adventureId: adventure.id, user: asDm, npcId: quiet, action: 'damage', amount: 1 }), /not in this adventure/);
  db.setAdventureNpc({ adventureId: adventure.id, user: asDm, npcId: quiet, inAdventure: true });
  assert.throws(() => db.changeNpcHp({ adventureId: adventure.id, user: asDm, npcId: quiet, action: 'damage', amount: 1 }), /no Hit Points set/);

  // The adventure stays in their history after it ends.
  db.cancelAdventure({ adventureId: adventure.id, user: { id: 0, role: 'admin' } });
  assert.deepEqual(db.getNpc(arleta).adventures.map(item => item.title), ['The Sunken Shrine']);
  // DMs can record older appearances on the NPC form too.
  db.saveNpc({ id: arleta, name: 'Arleta', hp_max: 20, adventure_ids: [] });
  assert.deepEqual(db.getNpc(arleta).adventures, []);
});
