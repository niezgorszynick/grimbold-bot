const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

// Deterministic dice: returns the queued values in order.
const dice = (...values) => () => values.shift();

const fighter = { species: 'Human', sheetData: { abilities: { con: { score: 14 } } }, classRows: [{ className: 'Fighter', subclassName: 'Champion', level: 3 }] };
const context = (overrides = {}) => ({ ...rules.deriveVitalsContext(fighter), ...overrides });
const fresh = (overrides = {}) => ({ ...rules.normalizeVitals({}, 28), ...overrides });
const act = (vitals, action, params, ctx = context()) => rules.applyVitalsAction(vitals, action, params, ctx);

test('derives max HP, hit dice and slots from classes', () => {
  const ctx = context();
  assert.equal(ctx.hpMax, 28);
  assert.deepEqual(ctx.hitDicePool, { d10: 3 });
  assert.equal(ctx.conModifier, 2);
  const tough = rules.deriveVitalsContext({ ...fighter, sheetData: { ...fighter.sheetData, originFeats: [{ name: 'Tough' }], hpMaxBonus: 5 } });
  assert.equal(tough.hpMax, 28 + 6 + 5);
});

test('legacy sheets default to full HP', () => {
  const vitals = rules.normalizeVitals({ hpCurrent: 99 }, 28);
  assert.equal(vitals.hpCurrent, 28);
  assert.deepEqual(rules.normalizeVitals({}, 28).deathSaves, { successes: 0, failures: 0 });
});

test('damage hits temporary HP first', () => {
  const { vitals } = act(fresh({ hpTemp: 5 }), 'damage', { amount: 8 });
  assert.equal(vitals.hpTemp, 0);
  assert.equal(vitals.hpCurrent, 25);
});

test('dropping to 0 HP and massive damage', () => {
  const down = act(fresh({ hpCurrent: 10 }), 'damage', { amount: 15 });
  assert.equal(down.vitals.hpCurrent, 0);
  assert.deepEqual(down.events, ['droppedToZero']);
  const killed = act(fresh({ hpCurrent: 10 }), 'damage', { amount: 38 });
  assert.deepEqual(killed.events, ['instantDeath']);
});

test('damage at 0 HP causes death save failures', () => {
  const dying = fresh({ hpCurrent: 0 });
  assert.equal(act(dying, 'damage', { amount: 3 }).vitals.deathSaves.failures, 1);
  assert.equal(act(dying, 'damage', { amount: 3, critical: true }).vitals.deathSaves.failures, 2);
  const third = act(fresh({ hpCurrent: 0, deathSaves: { successes: 0, failures: 2 } }), 'damage', { amount: 1 });
  assert.deepEqual(third.events, ['dead']);
});

test('healing caps at max and revives a dying character', () => {
  assert.equal(act(fresh({ hpCurrent: 20 }), 'heal', { amount: 50 }).vitals.hpCurrent, 28);
  const revived = act(fresh({ hpCurrent: 0, deathSaves: { successes: 1, failures: 2 } }), 'heal', { amount: 4 });
  assert.equal(revived.vitals.hpCurrent, 4);
  assert.deepEqual(revived.vitals.deathSaves, { successes: 0, failures: 0 });
  assert.deepEqual(revived.events, ['revived']);
});

test('temporary HP keep the higher value', () => {
  assert.equal(act(fresh({ hpTemp: 8 }), 'tempHp', { amount: 5 }).vitals.hpTemp, 8);
  assert.equal(act(fresh({ hpTemp: 3 }), 'tempHp', { amount: 5 }).vitals.hpTemp, 5);
});

test('death saves: 20 revives, 1 counts double, three successes stabilize', () => {
  const dying = fresh({ hpCurrent: 0 });
  const nat20 = act(dying, 'deathSave', { roll: 20 });
  assert.equal(nat20.vitals.hpCurrent, 1);
  assert.equal(act(dying, 'deathSave', { roll: 1 }).vitals.deathSaves.failures, 2);
  const stable = act(fresh({ hpCurrent: 0, deathSaves: { successes: 2, failures: 1 } }), 'deathSave', { roll: 12 });
  assert.equal(stable.vitals.stable, true);
  assert.deepEqual(stable.events, ['stabilized']);
  assert.throws(() => act(fresh(), 'deathSave', { roll: 10 }), /only rolled at 0/);
  const rolled = act(dying, 'deathSave', {}, context({ rng: dice(9) }));
  assert.equal(rolled.roll, 9);
  assert.equal(rolled.vitals.deathSaves.failures, 1);
});

test('short rest spends hit dice and restores pact slots', () => {
  const result = act(
    fresh({ hpCurrent: 10, pactSlotsSpent: 1 }),
    'shortRest',
    { hitDice: { d10: 2 } },
    context({ rng: dice(4, 1) })
  );
  assert.deepEqual(result.rolls.map(r => r.healed), [6, 3]); // roll + CON 2
  assert.equal(result.vitals.hpCurrent, 19);
  assert.deepEqual(result.vitals.hitDiceSpent, { d10: 2 });
  assert.equal(result.vitals.pactSlotsSpent, 0);
  assert.throws(
    () => act(result.vitals, 'shortRest', { hitDice: { d10: 2 } }, context({ rng: dice(1, 1) })),
    /Only 1 d10/
  );
});

test('long rest restores everything and reduces exhaustion', () => {
  const tired = fresh({ hpCurrent: 3, hpTemp: 4, hitDiceSpent: { d10: 3 }, exhaustion: 2, spellSlotsSpent: [2] });
  const { vitals } = act(tired, 'longRest', {});
  assert.equal(vitals.hpCurrent, 28);
  assert.equal(vitals.hpTemp, 0);
  assert.deepEqual(vitals.hitDiceSpent, {});
  assert.equal(vitals.exhaustion, 1);
  assert.deepEqual(vitals.spellSlotsSpent, []);
  assert.throws(() => act(fresh({ hpCurrent: 0 }), 'longRest', {}), /at least 1 Hit Point/);
});

test('spell slots can be spent and restored within limits', () => {
  const wizard = rules.deriveVitalsContext({ species: 'Elf', sheetData: {}, classRows: [{ className: 'Wizard', level: 3 }] });
  let vitals = rules.normalizeVitals({}, wizard.hpMax);
  vitals = act(vitals, 'spendSlot', { level: 2 }, wizard).vitals;
  vitals = act(vitals, 'spendSlot', { level: 2 }, wizard).vitals;
  assert.deepEqual(vitals.spellSlotsSpent, [0, 2]);
  assert.throws(() => act(vitals, 'spendSlot', { level: 2 }, wizard), /No level 2 spell slots remaining/);
  assert.throws(() => act(vitals, 'spendSlot', { level: 3 }, wizard), /No level 3 spell slots/);
  vitals = act(vitals, 'restoreSlot', { level: 2 }, wizard).vitals;
  const view = rules.buildVitalsView(vitals, wizard);
  assert.deepEqual(view.spellSlots, [{ level: 1, total: 4, spent: 0 }, { level: 2, total: 2, spent: 1 }]);
});

test('lowering the max HP bonus clamps current HP', () => {
  const result = act(fresh({ hpMaxBonus: 10, hpCurrent: 38 }), 'maxHpBonus', { bonus: -3 });
  assert.equal(result.hpMax, 25);
  assert.equal(result.vitals.hpCurrent, 25);
});

test('rejects unknown actions and bad amounts', () => {
  assert.throws(() => act(fresh(), 'constructor', {}), /Unknown action/);
  assert.throws(() => act(fresh(), 'damage', { amount: -4 }), /whole number/);
  assert.throws(() => act(fresh(), 'exhaustion', { level: 7 }), /0 to 6/);
});
