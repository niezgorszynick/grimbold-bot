const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

const context = (classRows, abilities) => rules.deriveVitalsContext({
  species: 'Human',
  sheetData: { abilities: Object.fromEntries(Object.entries(abilities).map(([ability, score]) => [ability, { score }])) },
  classRows
});
const act = (vitals, action, params, ctx) => rules.applyVitalsAction(vitals, action, params, ctx).vitals;

test('a War Domain cleric has Channel Divinity and War Priest, recovered by rests', () => {
  const ctx = context([{ className: 'Cleric', subclassName: 'War Domain', level: 3 }], { wis: 17 });
  assert.deepEqual(ctx.resources.map(resource => [resource.name, resource.max, resource.recovery]),
    [['Channel Divinity', 2, 'shortOne'], ['War Priest', 3, 'short']]);
  assert.match(ctx.resources[0].text, /Divine Spark .*Turn Undead, Guided Strike/);

  let vitals = rules.normalizeVitals({}, ctx.hpMax);
  vitals = act(vitals, 'useResource', { key: 'channelDivinityCleric' }, ctx);
  vitals = act(vitals, 'useResource', { key: 'channelDivinityCleric' }, ctx);
  vitals = act(vitals, 'useResource', { key: 'warPriest' }, ctx);
  assert.throws(() => act(vitals, 'useResource', { key: 'channelDivinityCleric' }, ctx), /only 0 left/);
  assert.throws(() => act(vitals, 'useResource', { key: 'rage' }, ctx), /no such feature/);

  vitals = act(vitals, 'shortRest', {}, ctx);
  assert.deepEqual(vitals.resourcesUsed, { channelDivinityCleric: 1 }, 'one Channel Divinity back, all War Priest uses');
  vitals = act(vitals, 'restoreResource', { key: 'channelDivinityCleric' }, ctx);
  assert.deepEqual(vitals.resourcesUsed, {}, 'a use given back by hand');
  vitals = act(act(vitals, 'useResource', { key: 'warPriest' }, ctx), 'longRest', {}, ctx);
  assert.deepEqual(vitals.resourcesUsed, {});
  assert.deepEqual(rules.buildVitalsView(vitals, ctx).resources.map(resource => resource.used), [0, 0]);
});

test('uses follow levels and abilities; pools spend several at once', () => {
  const bard = level => context([{ className: 'Bard', subclassName: 'College of Lore', level }], { cha: 18 })
    .resources.find(resource => resource.key === 'bardicInspiration');
  assert.deepEqual([bard(4).max, bard(4).recovery], [4, 'long']);
  assert.equal(bard(5).recovery, 'short', 'Font of Inspiration');
  assert.equal(context([{ className: 'Cleric', subclassName: 'War Domain', level: 3 }], { wis: 8 })
    .resources.find(resource => resource.key === 'warPriest').max, 1, 'minimum of once');

  const paladin = context([{ className: 'Paladin', subclassName: 'Oath of Glory', level: 5 }], { cha: 16 });
  const layOnHands = paladin.resources.find(resource => resource.key === 'layOnHands');
  assert.deepEqual([layOnHands.max, layOnHands.pool], [25, true]);
  let vitals = act(rules.normalizeVitals({}, paladin.hpMax), 'useResource', { key: 'layOnHands', amount: 12 }, paladin);
  assert.equal(vitals.resourcesUsed.layOnHands, 12);
  assert.throws(() => act(vitals, 'useResource', { key: 'layOnHands', amount: 14 }, paladin), /only 13 left/);
  vitals = act(vitals, 'shortRest', {}, paladin);
  assert.equal(vitals.resourcesUsed.layOnHands, 12, 'Lay On Hands only comes back on a Long Rest');

  // Multiclass: each class's own features.
  const multi = context([{ className: 'Fighter', subclassName: 'Battle Master', level: 3 }, { className: 'Cleric', subclassName: null, level: 2 }], { wis: 14 });
  assert.deepEqual(multi.resources.map(resource => resource.name), ['Second Wind', 'Action Surge', 'Superiority Dice', 'Channel Divinity']);
});

test('Channel Divinity has its dice to roll', () => {
  const rollsOf = (row, abilities, key) => Object.fromEntries(context([row], abilities).resources
    .find(resource => resource.key === key).rolls.map(roll => [roll.key, roll.formula]));
  assert.deepEqual(rollsOf({ className: 'Cleric', subclassName: 'War Domain', level: 2 }, { wis: 16 }, 'channelDivinityCleric'), { spark: '1d8+3' });
  assert.deepEqual(rollsOf({ className: 'Cleric', subclassName: 'Light Domain', level: 7 }, { wis: 18 }, 'channelDivinityCleric'),
    { spark: '2d8+4', sear: '4d8', dawn: '2d10+7' });
  assert.deepEqual(rollsOf({ className: 'Cleric', subclassName: null, level: 5 }, { wis: 10 }, 'channelDivinityCleric'), { spark: '1d8', sear: '1d8' });
  assert.deepEqual(rollsOf({ className: 'Paladin', subclassName: 'Oath of Glory', level: 3 }, { cha: 16 }, 'channelDivinityPaladin'), { smite: '2d8+3' });
  assert.deepEqual(rollsOf({ className: 'Paladin', subclassName: 'Oath of Devotion', level: 3 }, { cha: 16 }, 'channelDivinityPaladin'), {});
});

test('feature dice: Second Wind, Bardic Inspiration, Superiority, Psionic, Healing Light, Dark One\'s Own Luck', () => {
  const rollsOf = (row, abilities, key) => Object.fromEntries(context([row], abilities).resources
    .find(resource => resource.key === key).rolls.map(roll => [roll.key, roll.formula]));
  assert.deepEqual(rollsOf({ className: 'Fighter', subclassName: 'Battle Master', level: 10 }, {}, 'secondWind'), { heal: '1d10+10' });
  assert.deepEqual(rollsOf({ className: 'Fighter', subclassName: 'Battle Master', level: 10 }, {}, 'superiorityDice'), { die: '1d10' });
  assert.deepEqual(rollsOf({ className: 'Fighter', subclassName: 'Psi Warrior', level: 5 }, {}, 'psionicDiceFighter'), { die: '1d8', strike: '1d8' });
  assert.deepEqual(rollsOf({ className: 'Rogue', subclassName: 'Soulknife', level: 3 }, {}, 'psionicDiceRogue'), { die: '1d6', knack: '1d6', whispers: '1d6' });
  assert.deepEqual(rollsOf({ className: 'Bard', subclassName: 'College of Lore', level: 5 }, { cha: 16 }, 'bardicInspiration'), { die: '1d8' });
  assert.deepEqual(rollsOf({ className: 'Warlock', subclassName: 'Celestial Patron', level: 3 }, { cha: 16 }, 'healingLight'),
    { heal1: '1d6', heal2: '2d6', heal3: '3d6' });
  assert.deepEqual(rollsOf({ className: 'Warlock', subclassName: 'Fiend Patron', level: 6 }, { cha: 16 }, 'darkOnesOwnLuck'), { die: '1d10' });
});
