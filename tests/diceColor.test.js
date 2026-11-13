const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

function fighter(playerId) {
  const character = rules.buildStartingCharacter({
    name: 'Kael', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Great Weapon Fighting',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  });
  return db.insertStartingCharacter(playerId, character);
}

test('dice colours: each roll keeps the colour its player had then, Owlbear sees it', () => {
  const owner = createPlayer();
  const id = fighter(owner);
  const user = { id: owner, role: 'player' };
  const plain = db.rollForCharacter({ characterId: id, user, request: { roll: 'initiative' } });
  assert.equal(plain.color, null, 'no colour picked yet');

  assert.equal(db.setDiceColor({ playerId: owner, color: 'purple' }).hex, db.DICE_COLORS.purple.hex);
  const purple = db.rollForCharacter({ characterId: id, user, request: { roll: 'initiative' } });
  assert.equal(purple.color.key, 'purple');
  assert.equal(purple.color.emoji, '🟪');

  db.setDiceColor({ playerId: owner, color: 'green' });
  const history = db.getCharacterRolls({ characterId: id, user });
  const colors = (history.rolls || history).map(roll => roll.color && roll.color.key);
  assert.ok(colors.includes('purple'), 'the purple roll stays purple after the change');

  const key = db.getVttKey({ playerId: owner });
  assert.equal(db.getVttRolls({ key }).diceColor.key, 'green');
  assert.equal(db.setDiceColor({ playerId: owner, color: '' }), null, 'back to none');
  assert.throws(() => db.setDiceColor({ playerId: owner, color: 'plaid' }), /Unknown dice colour/);
  assert.throws(() => db.setDiceColor({ playerId: 0, color: 'red' }), /Only player accounts/);
});

test('Hit Point Dice left can be set by hand, without healing', () => {
  const vitals = rules.normalizeVitals({ hpCurrent: 10, hitDiceSpent: { d10: 1 } }, 40);
  const context = { hitDicePool: { d10: 5 }, hpMax: 40, baseHpMax: 40 };
  const spent = rules.applyVitalsAction(vitals, 'setHitDice', { die: 'd10', remaining: 2 }, context).vitals;
  assert.deepEqual(spent.hitDiceSpent, { d10: 3 });
  assert.equal(spent.hpCurrent, 10, 'no healing');
  assert.deepEqual(rules.applyVitalsAction(vitals, 'setHitDice', { die: 'd10', remaining: 5 }, context).vitals.hitDiceSpent, { d10: 0 });
  assert.throws(() => rules.applyVitalsAction(vitals, 'setHitDice', { die: 'd10', remaining: 6 }, context), /from 0 to 5/);
  assert.throws(() => rules.applyVitalsAction(vitals, 'setHitDice', { die: 'd8', remaining: 1 }, context), /no d8/);
});
