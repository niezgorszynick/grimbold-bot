const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

function createFighter(playerId, name) {
  const character = rules.buildStartingCharacter({
    name, species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, dex: 1 },
    versatileFeat: { name: 'Tough' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  });
  return db.insertStartingCharacter(playerId, character);
}

const row = id => db.prepare('SELECT level, xp FROM characters WHERE id = ?').get(id);
const classLevels = id => db.getCharacterClasses(id).map(c => `${c.class_name} ${c.class_level}`).join(', ');
const adventure = (characterIds, xp, extra = {}) => db.recordAdventure({
  title: 'Crypt', description: 'test', xp_awarded: xp, dm_player_id: null, dm_character_id: null, character_ids: characterIds, ...extra
});

test('adventure XP earns levels that stay pending until applied', () => {
  const player = createPlayer();
  const id = createFighter(player, 'Pending Pete');
  adventure([id], 3);
  assert.deepEqual(row(id), { level: 4, xp: 3 });
  assert.equal(classLevels(id), 'Fighter 3');

  const options = db.getCharacterLevelUpOptions({ id, player_id: player, is_admin: false });
  assert.equal(options.pendingLevels, 1);
  db.levelUpCharacter({ id, player_id: player, is_admin: false, request: { className: 'Fighter', improvement: { type: 'asi', increases: { str: 2 } } } });
  assert.equal(classLevels(id), 'Fighter 4');
  assert.equal(db.getCharacterLevelUpOptions({ id, player_id: player, is_admin: false }).pendingLevels, 0);
});

test('level-ups check ownership and life', () => {
  const owner = createPlayer();
  const stranger = createPlayer();
  const id = createFighter(owner, 'Guarded Gwen');
  adventure([id], 3);
  const request = { className: 'Fighter', improvement: { type: 'asi', increases: { str: 2 } } };
  assert.throws(() => db.levelUpCharacter({ id, player_id: stranger, is_admin: false, request }), /Forbidden/);
  db.prepare("UPDATE characters SET status = 'dead' WHERE id = ?").run(id);
  assert.throws(() => db.levelUpCharacter({ id, player_id: owner, is_admin: false, request }), /living characters/);
});

test('lowering adventure XP undoes the newest level-ups', () => {
  const player = createPlayer();
  const id = createFighter(player, 'Reverted Rhea');
  const adventureId = adventure([id], 7); // level 5
  db.levelUpCharacter({ id, player_id: player, is_admin: false, request: { className: 'Fighter', improvement: { type: 'asi', increases: { str: 1, con: 1 } } } });
  db.levelUpCharacter({ id, player_id: player, is_admin: false, request: { className: 'Rogue', multiclassSkills: ['Stealth'] } });
  assert.equal(classLevels(id), 'Fighter 4, Rogue 1');

  const update = xp => db.updateAdventure({
    adventure_id: adventureId, title: 'Crypt', description: 'test', xp_awarded: xp,
    dm_player_id: null, dm_character_id: null, character_ids: [id]
  });
  update(3); // back to level 4
  assert.equal(classLevels(id), 'Fighter 4');
  update(0); // back to level 3
  assert.equal(classLevels(id), 'Fighter 3');
  const sheet = JSON.parse(db.getCharacterById(id).sheet_data);
  assert.equal(sheet.abilities.str.score, 17);
  assert.equal(sheet.abilities.con.score, 13);
  assert.ok(!sheet.skillProficiencies.includes('Stealth'));
  assert.deepEqual(sheet.levelHistory, []);
});

test('removing a participant takes back their XP', () => {
  const player = createPlayer();
  const kept = createFighter(player, 'Kept Kara');
  const removed = createFighter(player, 'Removed Rob');
  const adventureId = adventure([kept, removed], 3);
  db.updateAdventure({
    adventure_id: adventureId, title: 'Crypt', description: 'test', xp_awarded: 3,
    dm_player_id: null, dm_character_id: null, character_ids: [kept]
  });
  assert.equal(row(kept).xp, 3);
  assert.deepEqual(row(removed), { level: 3, xp: 0 });
});

test('the DM earns a point, which can be spent as XP on their own character', () => {
  const dm = createPlayer('admin');
  const dmCharacter = createFighter(dm, 'Dungeon Dana');
  const playerCharacter = createFighter(createPlayer(), 'Hero Hal');

  adventure([playerCharacter], 1, { dm_player_id: dm });
  assert.equal(db.prepare('SELECT dm_points FROM players WHERE id = ?').get(dm).dm_points, 1);

  db.assignDmPointToCharacter(dm, dmCharacter);
  assert.equal(row(dmCharacter).xp, 1);
  assert.equal(db.prepare('SELECT dm_points FROM players WHERE id = ?').get(dm).dm_points, 0);
  assert.throws(() => db.assignDmPointToCharacter(dm, dmCharacter), /no DM points/);
  adventure([playerCharacter], 1, { dm_player_id: dm });
  assert.throws(() => db.assignDmPointToCharacter(dm, playerCharacter), /does not belong/);
});
