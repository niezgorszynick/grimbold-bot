const fs = require('fs');
const os = require('os');
const path = require('path');
// Uploaded files go to a folder of their own for this test run.
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'grimbold-uploads-'));
process.on('exit', () => fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true }));

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

test('NPCs: players see name, role, portrait and adventures; the rest is for DMs', () => {
  assert.throws(() => db.saveNpc({ name: '  ' }), /needs a name/);
  assert.throws(() => db.saveNpc({ name: 'Kevah', str: 40 }), /STR must be a whole number from 1 to 30/);
  const id = db.saveNpc({
    name: 'Kevah', affiliation: 'Harpers', description: 'A wiry half-elf with a debt to pay.',
    dm_notes: 'Secretly reports to the Zhentarim.', armor_class: '15', hp_max: '27', speed: '30 ft.', dex: '16', wis: '13'
  });
  const forPlayers = db.listNpcs().find(npc => npc.id === id);
  assert.deepEqual(Object.keys(forPlayers).sort(), ['adventures', 'affiliation', 'id', 'name', 'portraitUrl']);
  assert.equal(forPlayers.affiliation, 'Harpers');
  assert.equal(forPlayers.stats, undefined, 'players see no stats');
  assert.equal(forPlayers.description, undefined, 'or the lore');
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

test('NPC owners and plans: a new NPC belongs to its DM; reserved NPCs warn other DMs', () => {
  const owner = createPlayer('admin');
  const otherDm = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('plans-dm', otherDm);
  const id = db.saveNpc({ name: 'Vex', personality: 'Charming liar', plans: 'reserved', plans_note: 'Ashfall villain', created_by: owner });
  let npc = db.getNpc(id, { showStats: true });
  assert.deepEqual(npc.owner, { id: owner, tag: db.prepare('SELECT discord_tag FROM players WHERE id = ?').get(owner).discord_tag });
  assert.deepEqual([npc.plans, npc.plansNote, npc.personality], ['reserved', 'Ashfall villain', 'Charming liar']);
  assert.throws(() => db.saveNpc({ id, name: 'Vex', owner_player_id: otherDm }), /must be a DM account/);
  assert.ok(db.listNpcOwners().some(entry => entry.id === 0 && entry.tag === 'Root DM'));

  // Another DM's table: Vex is offered, with a warning.
  const { adventure } = db.createAdventureFromThread({ threadId: 'plans-thread', title: 'Ashfall', ownerDiscordId: 'plans-dm' });
  const table = db.setAdventureNpc({ adventureId: adventure.id, user: { id: otherDm, role: 'player' }, npcId: db.saveNpc({ name: 'Filler' }), inAdventure: true });
  const vex = table.npcCandidates.find(candidate => candidate.id === id);
  assert.equal(vex.reservedBy, npc.owner.tag);

  // Clearing the owner (an older NPC nobody claimed yet).
  db.saveNpc({ id, name: 'Vex', owner_player_id: '' });
  npc = db.getNpc(id, { showStats: true });
  assert.equal(npc.owner, null);
});

test('NPC portraits: real images only, replaced and removed with the NPC', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const id = db.saveNpc({ name: 'Mira' });
  assert.throws(() => db.saveNpcFile({ npcId: id, kind: 'portrait', buffer: Buffer.from('<svg onload="x">') }), /PNG, JPG, WebP or GIF/);
  assert.throws(() => db.saveNpcFile({ npcId: id, kind: 'portrait', buffer: Buffer.from('%PDF-1.7 made up') }), /PNG, JPG, WebP or GIF/);
  assert.throws(() => db.saveNpcFile({ npcId: id, kind: 'statblock', buffer: png }), /Only portraits/);

  const portrait = db.saveNpcFile({ npcId: id, kind: 'portrait', buffer: png });
  assert.equal(db.getNpc(id).portraitUrl, portrait.url, 'players get the portrait');
  assert.equal(db.getNpcFile({ npcId: id, kind: 'portrait' }).contentType, 'image/png');
  assert.equal(db.getNpcFile({ npcId: id, kind: 'statblock' }), null);

  // A new portrait replaces the old file; deleting the NPC removes it.
  const first = path.join(process.env.UPLOADS_DIR, 'npcs', portrait.name);
  db.saveNpcFile({ npcId: id, kind: 'portrait', buffer: png });
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.readdirSync(path.join(process.env.UPLOADS_DIR, 'npcs')).length, 1);
  db.deleteNpc(id);
  assert.equal(fs.readdirSync(path.join(process.env.UPLOADS_DIR, 'npcs')).length, 0);
});
