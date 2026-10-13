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
