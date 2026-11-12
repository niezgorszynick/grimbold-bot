// The DM's reward is the adventure's XP (it used to be a flat 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

const addCharacter = (playerId, name, xp = 0) => Number(db.prepare(`
  INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
  VALUES (?, ?, 'Human', 'Fighter', '', ?, ?, 'alive', 0, '{}')
`).run(playerId, name, db.calculateLevelFromXp(xp), xp).lastInsertRowid);
const xpOf = id => db.getCharacterById(id).xp;
const pointsOf = id => db.prepare('SELECT dm_points FROM players WHERE id = ?').get(id).dm_points;
const root = { id: 0, role: 'admin' };

test('recording and editing a finished adventure: the DM gets and gives back the adventure XP', () => {
  const dm = createPlayer('admin');
  const ola = createPlayer();
  const kael = addCharacter(ola, 'Kael');
  const hero = addCharacter(dm, 'DM Hero');
  const other = addCharacter(dm, 'DM Rogue');

  const id = db.recordAdventure({ title: 'Wolves', description: '', xp_awarded: 2, dm_player_id: dm, dm_character_id: hero, character_ids: [kael] });
  assert.deepEqual([xpOf(kael), xpOf(hero)], [2, 2]);
  assert.equal(db.getAdventureById(id).dm_reward_xp, 2);

  const edit = changes => db.updateAdventure({
    adventure_id: id, title: 'Wolves', description: '', xp_awarded: 2, dm_player_id: dm, dm_character_id: hero, character_ids: [kael], user: root, ...changes
  });
  edit({ xp_awarded: 3 });
  assert.deepEqual([xpOf(kael), xpOf(hero)], [3, 3], 'more XP: the DM gets it too');
  edit({ xp_awarded: 3, dm_character_id: other });
  assert.deepEqual([xpOf(hero), xpOf(other)], [0, 3], 'the reward moves to the other character');
  const points = pointsOf(dm);
  edit({ xp_awarded: 3, dm_character_id: null });
  assert.deepEqual([xpOf(other), pointsOf(dm)], [0, points + 3], 'or is banked as DM points');

  // The DM's reward shows in the character's level breakdown with its XP.
  edit({ xp_awarded: 2, dm_character_id: hero });
  const breakdown = db.getCharacterLevelBreakdown(hero);
  assert.deepEqual(breakdown.entries.filter(entry => entry.kind === 'dm').map(entry => entry.xp), [2]);

  // A 0 XP adventure: the party gets nothing, the DM still 1.
  edit({ xp_awarded: 0, dm_character_id: hero });
  assert.deepEqual([xpOf(kael), xpOf(hero), db.getAdventureById(id).dm_reward_xp], [0, 1, 1]);

  db.deleteAdventure({ adventureId: id, user: root });
  assert.deepEqual([xpOf(kael), xpOf(hero), pointsOf(dm)], [0, 0, points], 'deleting takes back exactly what was given');
});

test('adventures finished before the change get the rest of their DM reward, once', () => {
  const dm = createPlayer('admin');
  const ola = createPlayer();
  const kael = addCharacter(ola, 'Kael', 3);
  const hero = addCharacter(dm, 'DM Hero', 1);
  // As they were: 1 XP to the DM whatever the adventure gave (what migration 35 records).
  const old = (xp, dmCharacterId) => Number(db.prepare(`
    INSERT INTO adventures (title, description, xp_awarded, dm_player_id, dm_character_id, status, dm_reward_xp)
    VALUES ('Old', '', ?, ?, ?, 'completed', 1)
  `).run(xp, dm, dmCharacterId).lastInsertRowid);
  const twoXp = old(2, hero);
  const banked = old(3, null);
  const zero = old(0, hero);
  const one = old(1, hero);
  const points = pointsOf(dm);

  db.settleDmRewards();
  assert.equal(xpOf(hero), 2, 'the 2 XP adventure gives its DM character 1 more');
  assert.equal(pointsOf(dm), points + 2, 'a banked 3 XP adventure: 2 more DM points');
  assert.deepEqual([twoXp, banked, zero, one].map(id => db.getAdventureById(id).dm_reward_xp), [2, 3, 1, 1], '0 XP adventures keep their 1');
  assert.equal(xpOf(kael), 3, 'the party is not touched');

  db.settleDmRewards();
  assert.deepEqual([xpOf(hero), pointsOf(dm)], [2, points + 2], 'running it again changes nothing');
});

test('DM settings from the sheet keep the name, species and class they do not send', () => {
  const owner = createPlayer();
  const id = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Ilphas', 'Elf', 'Wizard', 'Evoker', 3, 0, 'alive', 500, '{}')`).run(owner).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary) VALUES (?, ?, ?, 3, 1)').run(id, 'Wizard', 'Evoker');
  db.updateCharacterWithAdventures({ id, player_id: owner, xp: 4, status: 'alive', adventure_ids: [] });
  const after = db.getCharacterById(id);
  assert.deepEqual([after.name, after.race, after.class, after.subclass, after.xp, after.gold_cp], ['Ilphas', 'Elf', 'Wizard', 'Evoker', 4, 500]);
});
