const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const abilities = scores => Object.fromEntries(Object.entries({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...scores })
  .map(([key, score]) => [key, { score }]));
const attack = (result, name) => result.attacks.find(entry => entry.name === name);
const paladin = [{ className: 'Paladin', subclassName: 'Oath of Devotion', level: 3 }];
const barbarian = [{ className: 'Barbarian', subclassName: null, level: 9 }];
const sheet = extra => ({
  abilities: abilities({ str: 16, dex: 12, cha: 14 }),
  weaponProficiencies: ['Simple weapons', 'Martial weapons'],
  inventory: [{ name: 'Longsword', quantity: 1 }, { name: 'Longbow', quantity: 1 }],
  ...extra
});

test('Sacred Weapon adds CHA (min. +1) to melee attack rolls while it is on', () => {
  const off = rules.calculateCombat({ classes: paladin, species: 'Human', sheetData: sheet() });
  assert.equal(attack(off, 'Longsword').attackBonus, '+5');
  const on = rules.calculateCombat({ classes: paladin, species: 'Human', sheetData: sheet({ activeEffects: ['sacredWeapon'] }) });
  assert.equal(attack(on, 'Longsword').attackBonus, '+7', 'STR +3, proficiency +2, CHA +2');
  assert.ok(attack(on, 'Longsword').hitParts.some(part => part.label === 'Sacred Weapon' && part.value === 2));
  assert.equal(attack(on, 'Longbow').attackBonus, '+3', 'ranged weapons are not affected');
  const lowCha = rules.calculateCombat({ classes: paladin, species: 'Human', sheetData: sheet({ abilities: abilities({ str: 16, cha: 8 }), activeEffects: ['sacredWeapon'] }) });
  assert.equal(attack(lowCha, 'Longsword').attackBonus, '+6', 'minimum +1');
  // Only an Oath of Devotion paladin has it.
  const other = rules.calculateCombat({ classes: [{ className: 'Paladin', subclassName: 'Oath of Glory', level: 3 }], species: 'Human', sheetData: sheet({ activeEffects: ['sacredWeapon'] }) });
  assert.equal(attack(other, 'Longsword').attackBonus, '+5');
});

test('Rage adds its damage to Strength attacks, both hands, and Unarmed Strikes', () => {
  const on = rules.calculateCombat({ classes: barbarian, species: 'Human', sheetData: sheet({ activeEffects: ['rage'] }) });
  assert.equal(attack(on, 'Longsword').damage, '1d8+6 Slashing (1d10+6 two-handed)', 'STR +3 and Rage +3 at level 9');
  assert.equal(attack(on, 'Longbow').damage, '1d8+1 Piercing', 'DEX attacks are not affected');
  assert.equal(attack(on, 'Unarmed Strike').damage, '7 Bludgeoning');
});

test('starting an effect spends a use; End, rests and 0 HP end it; the rolls follow', () => {
  const owner = createPlayer();
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Aria', 'Human', 'Paladin', 'Oath of Devotion', 3, 900, 'alive', 0, ?)
  `).run(owner, JSON.stringify(sheet({ savingProficiencies: ['wis', 'cha'] }))).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level) VALUES (?, ?, ?, ?)').run(id, 'Paladin', 'Oath of Devotion', 3);
  const character = () => db.getCharacterById(id);
  const sheetData = () => JSON.parse(character().sheet_data);
  const context = () => rules.deriveVitalsContext({ species: 'Human', sheetData: sheetData(), classRows: paladin });
  const act = (action, params = {}) => {
    const ctx = context();
    const outcome = rules.applyVitalsAction(rules.normalizeVitals(sheetData(), ctx.hpMax), action, params, ctx);
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify({ ...sheetData(), ...outcome.vitals }), id);
    return { ...outcome, view: rules.buildVitalsView(outcome.vitals, ctx, outcome.hpMax) };
  };
  const longsword = () => [...db.rollOptions(character()).values()].find(option => option.label === 'Longsword attack').formula;

  assert.equal(longsword(), '1d20+5');
  assert.throws(() => act('startEffect', { effect: 'rage' }), /no such feature/);
  let result = act('startEffect', { effect: 'sacredWeapon' });
  assert.deepEqual(result.events, ['effectStarted:sacredWeapon']);
  assert.equal(result.view.resources.find(resource => resource.key === 'channelDivinityPaladin').used, 1);
  assert.equal(result.view.effects.find(effect => effect.key === 'sacredWeapon').active, true);
  assert.equal(longsword(), '1d20+7');
  assert.throws(() => act('startEffect', { effect: 'sacredWeapon' }), /already on/);

  act('endEffect', { effect: 'sacredWeapon' });
  assert.equal(longsword(), '1d20+5');

  act('startEffect', { effect: 'sacredWeapon' });
  result = act('shortRest', { hitDice: {} });
  assert.ok(result.events.includes('effectEnded:sacredWeapon'));
  assert.deepEqual(sheetData().activeEffects, []);

  act('startEffect', { effect: 'sacredWeapon' });
  result = act('damage', { amount: 1000 });
  assert.ok(result.events.includes('effectEnded:sacredWeapon'), '0 HP ends it');
  assert.equal(longsword(), '1d20+5');
});
