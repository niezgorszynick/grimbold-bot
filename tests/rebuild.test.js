const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const fighter = name => rules.buildStartingCharacter({
  name, species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Great Weapon Fighting',
  background: 'Soldier', generationMethod: 'Standard Array',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
  versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
  backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
});
const wizard = name => rules.buildStartingCharacter({
  name, species: 'Elf', size: 'Medium', speciesOption: 'High Elf', className: 'Wizard', subclass: 'Evoker',
  background: 'Sage', generationMethod: 'Standard Array',
  baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, backgroundBonuses: { int: 2, con: 1 },
  speciesSkills: ['Perception'], classSkills: ['Investigation', 'Medicine'], speciesSpellAbility: 'int',
  originFeatChoices: { spellAbility: 'int' }, languages: ['Draconic', 'Dwarvish'], classEquipment: 'A', backgroundEquipment: 'A'
});

test('a reset rebuilds the character from the creator and keeps its progress', () => {
  const owner = createPlayer();
  const stranger = createPlayer();
  const id = db.insertStartingCharacter(owner, fighter('Kael'));
  // Progress since creation: XP and level 5, a purse, a bought item and a magic item.
  const sheet = JSON.parse(db.getCharacterById(id).sheet_data);
  sheet.inventory.push({ name: 'Rope', quantity: 1, source: 'shop' });
  sheet.magicItems = rules.grantMagicItem(sheet, { name: 'Bag of Holding', quantity: 1, source: 'shop' });
  db.prepare('UPDATE characters SET xp = 11, level = 5, gold_cp = 4321, sheet_data = ? WHERE id = ?').run(JSON.stringify(sheet), id);

  const rebuilt = wizard('Kael the Wise');
  assert.throws(() => db.rebuildCharacter({ id, player_id: stranger, is_admin: false, character: rebuilt }), /Forbidden/);
  assert.equal(db.rebuildCharacter({ id, player_id: owner, is_admin: false, character: rebuilt }), id);

  const after = db.getCharacterById(id);
  assert.equal(after.name, 'Kael the Wise');
  assert.equal(after.class, 'Wizard');
  assert.equal(after.race, 'Elf');
  assert.equal(after.xp, 11, 'XP kept');
  assert.equal(after.level, 5, 'earned level kept');
  assert.equal(after.gold_cp, 4321, 'purse kept, no starting gold added');
  const classes = db.prepare('SELECT class_name, class_level FROM character_classes WHERE character_id = ?').all(id);
  assert.deepEqual(classes, [{ class_name: 'Wizard', class_level: 3 }], 'built at level 3: two level-ups waiting');

  const next = JSON.parse(after.sheet_data);
  const names = next.inventory.map(row => row.name);
  assert.ok(names.includes('Rope'), 'bought items kept');
  assert.ok(!names.includes('Greatsword'), "the fighter's starting gear is gone");
  assert.deepEqual(next.magicItems.map(item => item.name), ['Bag of Holding']);
  assert.equal(next.background, 'Sage');

  // An admin may reset anyone's character.
  assert.equal(db.rebuildCharacter({ id, player_id: 0, is_admin: true, character: fighter('Kael') }), id);
  assert.equal(db.getCharacterById(id).class, 'Fighter');
});
