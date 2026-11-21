const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

const userOf = (playerId, role = 'player') => ({ id: playerId, role });
function addCharacter(playerId, name) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, '{}')
  `).run(playerId, name).lastInsertRowid);
}

test("tracked resources on the table: for party members and NPCs, the DM's and the Root DM's only", () => {
  const dm = createPlayer('admin');
  const otherAdmin = createPlayer('admin');
  const player = createPlayer();
  const adventureId = db.startAdventure({ title: 'Tower of Bells', dmPlayerId: dm });
  const hero = addCharacter(player, 'Bellringer');
  const outsider = addCharacter(player, 'Stay-at-home');
  const asDm = { adventureId, user: userOf(dm, 'admin') };
  const asRoot = { adventureId, user: { id: 0, role: 'admin' } };
  const asOther = { adventureId, user: userOf(otherAdmin, 'admin') };
  const asPlayer = { adventureId, user: userOf(player) };
  db.setPartyMember({ ...asDm, characterId: hero, inParty: true });
  const lich = db.saveNpc({ name: 'Bell Lich', hp_max: 40 });
  db.setAdventureNpc({ ...asDm, npcId: lich, inAdventure: true });

  // A count of 3 that starts full, and a note without a count.
  let table = db.addTracker({ ...asDm, npcId: lich, name: '  Legendary   Resistance ', max: 3, comment: 'used one on Hold Monster' });
  assert.deepEqual(table.trackers.map(({ name, current, max, comment, npcId }) => ({ name, current, max, comment, npcId })),
    [{ name: 'Legendary Resistance', current: 3, max: 3, comment: 'used one on Hold Monster', npcId: lich }]);
  table = db.addTracker({ ...asRoot, characterId: hero, name: 'Owes the guild', comment: '50 gp by the full moon' });
  const debt = table.trackers.find(tracker => tracker.characterId === hero);
  assert.equal(debt.current, null);
  assert.equal(debt.max, null);

  // Only for those at the table.
  assert.throws(() => db.addTracker({ ...asDm, characterId: outsider, name: 'X' }), /not in the party/);
  assert.throws(() => db.addTracker({ ...asDm, npcId: db.saveNpc({ name: 'Elsewhere' }), name: 'X' }), /not in this adventure/);
  assert.throws(() => db.addTracker({ ...asDm, characterId: hero, name: '   ' }), /name/);
  assert.throws(() => db.addTracker({ ...asDm, characterId: hero, name: 'X', max: 1000 }), /0 to 999/);

  // Stepping stays between 0 and the maximum.
  const resistance = table.trackers.find(tracker => tracker.npcId === lich).id;
  db.updateTracker({ ...asDm, trackerId: resistance, changes: { step: 1 } });
  for (let i = 0; i < 5; i += 1) table = db.updateTracker({ ...asDm, trackerId: resistance, changes: { step: -1 } });
  assert.equal(table.trackers.find(tracker => tracker.id === resistance).current, 0);

  // Editing: a new maximum caps the count; emptying both drops the count.
  table = db.updateTracker({ ...asDm, trackerId: resistance, changes: { current: 5, max: 2, comment: 'after the long rest' } });
  assert.deepEqual((({ current, max, comment }) => ({ current, max, comment }))(table.trackers.find(tracker => tracker.id === resistance)),
    { current: 2, max: 2, comment: 'after the long rest' });
  table = db.updateTracker({ ...asDm, trackerId: debt.id, changes: { current: '', max: '' } });
  assert.equal(table.trackers.find(tracker => tracker.id === debt.id).current, null);

  // Nobody else sees or changes them: not the party, not other admins.
  assert.deepEqual(db.getAdventureTable(asPlayer).trackers, []);
  assert.deepEqual(db.getAdventureTable(asOther).trackers, []);
  assert.equal(db.getAdventureTable(asRoot).trackers.length, 2);
  assert.throws(() => db.addTracker({ ...asPlayer, characterId: hero, name: 'X' }), /Forbidden/);
  assert.throws(() => db.updateTracker({ ...asOther, trackerId: resistance, changes: { step: -1 } }), /Only this adventure's DM/);
  assert.throws(() => db.deleteTracker({ ...asOther, trackerId: resistance }), /Only this adventure's DM/);

  // A tracker of another adventure can't be reached through this one.
  const elsewhere = db.startAdventure({ title: 'Elsewhere', dmPlayerId: dm });
  assert.throws(() => db.deleteTracker({ adventureId: elsewhere, user: userOf(dm, 'admin'), trackerId: resistance }), /not on this table/);

  table = db.deleteTracker({ ...asDm, trackerId: resistance });
  assert.deepEqual(table.trackers.map(tracker => tracker.name), ['Owes the guild']);

  // Changes reach the live table.
  const before = db.db.prepare('SELECT MAX(id) AS id FROM change_log').get().id;
  db.updateTracker({ ...asDm, trackerId: debt.id, changes: { comment: 'paid half' } });
  assert.ok(db.db.prepare("SELECT 1 FROM change_log WHERE id > ? AND kind = 'adventure' AND ref_id = ?").get(before, adventureId));
});

test('tracked resources for monsters in an encounter (each its own) and NPCs in a fight', () => {
  const dm = createPlayer('admin');
  const adventureId = db.startAdventure({ title: 'Footpad Alley', dmPlayerId: dm });
  const asDm = { adventureId, user: userOf(dm, 'admin') };
  let table = db.createEncounter({ ...asDm, name: 'Ambush' });
  const encounterId = table.encounters.list[0].id;
  table = db.addEncounterMonster({ ...asDm, encounterId, monster: 'Practice Footpad', count: 2 });
  const boss = db.saveNpc({ name: 'Alley Boss' });
  table = db.addEncounterNpc({ ...asDm, encounterId, npcId: boss });
  const combatants = table.encounters.list[0].combatants;
  const [first, second] = combatants.filter(combatant => combatant.kind === 'monster');

  table = db.addTracker({ ...asDm, combatantId: first.id, name: 'Smoke bombs', max: 2 });
  assert.deepEqual(table.trackers.map(tracker => [tracker.combatantId, tracker.current]), [[first.id, 2]]);
  // The NPC isn't on the table yet but is in the encounter: its own trackers.
  table = db.addTracker({ ...asDm, npcId: boss, name: 'Bribe', comment: 'wants 20 gp' });
  assert.equal(table.trackers.find(tracker => tracker.name === 'Bribe').npcId, boss);
  // The NPC's combatant row is not a monster: track it on the NPC.
  const bossRow = combatants.find(combatant => combatant.kind === 'npc');
  assert.throws(() => db.addTracker({ ...asDm, combatantId: bossRow.id, name: 'X' }), /not in this adventure/);

  // Another adventure's monster can't be tracked here.
  const other = db.startAdventure({ title: 'Elsewhere', dmPlayerId: dm });
  assert.throws(() => db.addTracker({ adventureId: other, user: asDm.user, combatantId: second.id, name: 'X' }), /not in this adventure/);

  // Out of the fight: its trackers go with it.
  db.removeCombatant({ ...asDm, combatantId: first.id });
  assert.deepEqual(db.getAdventureTable(asDm).trackers.map(tracker => tracker.name), ['Bribe']);
});
