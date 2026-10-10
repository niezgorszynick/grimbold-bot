const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

test('the campaign roster shows each character with player, HP, AC, Passive Perception and spell DC', () => {
  const player = createPlayer();
  const tag = db.prepare('SELECT discord_tag FROM players WHERE id = ?').get(player).discord_tag;
  const wizard = rules.buildStartingCharacter({
    name: 'Mira', species: 'Human', size: 'Medium', className: 'Wizard', subclass: 'Evoker',
    background: 'Sage', generationMethod: 'Standard Array',
    baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, backgroundBonuses: { int: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Perception'], classSkills: ['Investigation', 'Medicine'],
    originFeatChoices: { spellAbility: 'int' }, languages: ['Elvish', 'Draconic'], classEquipment: 'A', backgroundEquipment: 'A'
  });
  const id = db.insertStartingCharacter(player, wizard);
  db.prepare("UPDATE characters SET level = 4 WHERE id = ?").run(id);
  const legacy = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Old Bran', 'Dwarf', 'Fighter', '', 3, 5, 'dead', 12345, '{"armorClass":18}')`).run(player).lastInsertRowid);

  const roster = db.getCampaignRoster();
  const mira = roster.find(row => row.id === id);
  assert.equal(mira.player, tag);
  assert.equal(mira.level, 3);
  assert.equal(mira.pendingLevels, 1, 'level 4 earned, level 3 applied');
  assert.deepEqual(mira.classes.map(row => row.className), ['Wizard']);
  assert.equal(mira.hp.current, mira.hp.max);
  assert.equal(mira.armorClass, 12, 'unarmored: 10 + DEX +2');
  assert.equal(mira.passivePerception, 10 + 1 + 2, 'WIS +1, proficient in Perception');
  assert.equal(mira.spellDc, 8 + 2 + 3);

  const bran = roster.find(row => row.id === legacy);
  assert.equal(bran.status, 'dead');
  assert.equal(bran.armorClass, 18, 'a typed-in AC is kept');
  assert.equal(bran.spellDc, null);
  assert.equal(bran.pendingLevels, 0);
});
