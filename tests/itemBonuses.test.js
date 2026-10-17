const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

function addCharacter(owner, sheet) {
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Scholar', 'Human', 'Wizard', 'Evoker', 3, 0, 'alive', 0, ?)
  `).run(owner, JSON.stringify(sheet)).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary) VALUES (?, ?, ?, ?, 1)').run(id, 'Wizard', 'Evoker', 3);
  return id;
}
const abilities = { str: { score: 10 }, dex: { score: 10 }, con: { score: 10 }, int: { score: 14 }, wis: { score: 12 }, cha: { score: 10 } };

test('item bonuses are checked and described', () => {
  assert.deepEqual(rules.validateItemBonuses([{ target: 'skill:History', kind: 'bonus', value: '2' }, { target: 'skill:Religion', kind: 'advantage', value: 5 }]),
    [{ target: 'skill:History', kind: 'bonus', value: 2 }, { target: 'skill:Religion', kind: 'advantage' }]);
  assert.throws(() => rules.validateItemBonuses([{ target: 'skill:Cooking', kind: 'bonus', value: 1 }]), /applies to/);
  assert.throws(() => rules.validateItemBonuses([{ target: 'saves', kind: 'bonus', value: 0 }]), /not 0/);
  assert.equal(rules.describeItemBonus({ target: 'skill:History', kind: 'bonus', value: 2 }), '+2 to History checks');
  assert.equal(rules.describeItemBonus({ target: 'save:wis', kind: 'advantage' }), 'Advantage on Wisdom saves');
});

test('a ring adds +2 to History; a held book gives Advantage on Religion, but not when put away', () => {
  const owner = createPlayer();
  const id = addCharacter(owner, { abilities, skillProficiencies: ['History'], inventory: [] });
  const who = { id, player_id: owner, is_admin: false };
  let result = db.changeCharacterInventory({ ...who, action: 'add', params: { name: 'Ring of Fish Stories', bonuses: [{ target: 'skill:History', kind: 'bonus', value: 2 }] } });
  assert.deepEqual(result.inventory.items[0].bonuses.map(bonus => bonus.text), ['+2 to History checks']);
  result = db.changeCharacterInventory({ ...who, action: 'add', params: { name: 'Book of Saints' } });
  db.changeCharacterInventory({ ...who, action: 'setBonuses', params: { index: 1, name: 'Book of Saints', bonuses: [{ target: 'skill:Religion', kind: 'advantage' }] } });

  let options = db.rollOptions(db.getCharacterById(id));
  assert.equal(options.get('skill:History').formula, '1d20+6', 'INT +2, proficiency +2, ring +2');
  assert.deepEqual(options.get('skill:Religion').advantage, ['Book of Saints']);
  assert.equal(options.get('skill:Arcana').formula, '1d20+2', 'other skills unchanged');

  // A roll on Religion goes in with Advantage and says why; Disadvantage cancels it.
  const roller = { id: owner, role: 'player' };
  let roll = db.rollForCharacter({ characterId: id, user: roller, request: { roll: 'skill:Religion' } });
  assert.equal(roll.mode, 'advantage');
  assert.match(roll.label, /Advantage: Book of Saints/);
  roll = db.rollForCharacter({ characterId: id, user: roller, request: { roll: 'skill:Religion', mode: 'disadvantage' } });
  assert.equal(roll.mode, 'normal');

  // Put away: no Advantage.
  result = db.changeCharacterInventory({ ...who, action: 'useBonuses', params: { index: 1, name: 'Book of Saints', active: false } });
  assert.equal(result.inventory.items[1].bonusesActive, false);
  options = db.rollOptions(db.getCharacterById(id));
  assert.deepEqual(options.get('skill:Religion').advantage, []);
  assert.deepEqual(result.inventory.itemBonuses.skills, { History: 2 }, 'the sheet gets the totals to show');

  // Clearing the bonuses.
  db.changeCharacterInventory({ ...who, action: 'setBonuses', params: { index: 0, name: 'Ring of Fish Stories', bonuses: [] } });
  assert.equal(db.rollOptions(db.getCharacterById(id)).get('skill:History').formula, '1d20+4');
});

test('save, all-check and initiative bonuses', () => {
  const owner = createPlayer();
  const id = addCharacter(owner, {
    abilities,
    inventory: [{ name: 'Lucky Charm', quantity: 1, bonuses: [{ target: 'saves', kind: 'bonus', value: 1 }, { target: 'checks', kind: 'bonus', value: 1 }, { target: 'initiative', kind: 'bonus', value: 2 }] }]
  });
  const options = db.rollOptions(db.getCharacterById(id));
  assert.equal(options.get('save:wis').formula, '1d20+2');
  assert.equal(options.get('check:str').formula, '1d20+1');
  assert.equal(options.get('skill:Stealth').formula, '1d20+1');
  assert.equal(options.get('initiative').formula, '1d20+2');
});
