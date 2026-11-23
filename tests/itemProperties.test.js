// Custom properties on items: a Sylvan Talon set in a Rapier.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const player = createPlayer();
const id = Number(db.prepare(`
  INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
  VALUES (?, 'Lirael', 'Elf', 'Rogue', 'Thief', 3, 0, 'alive', 0, ?)
`).run(player, JSON.stringify({ inventory: [{ name: 'Torch', quantity: 2 }, { name: 'Rapier', quantity: 1, nickname: 'Cierń' }] })).lastInsertRowid);
const who = { id, player_id: player, is_admin: false };
const sheet = () => JSON.parse(db.getCharacterById(id).sheet_data);
const TALON = [
  { name: 'Sylvan Talon', text: 'While this weapon is on your person, you understand the nonwritten communication of all Fey, and they understand yours.' },
  { name: 'Secret Message', text: "As a Magic action, you can use the weapon to cast Message. Once this property is used, it can't be used again until the next dawn.", uses: { max: 1, recovery: 'dawn' } }
];

test('properties are checked: a name or text, uses from 1 to 20, a known recovery', () => {
  const [plain, limited] = rules.validateItemProperties(TALON);
  assert.equal(plain.uses, null);
  assert.deepEqual(limited.uses, { max: 1, recovery: 'dawn' });
  assert.match(limited.id, /^[a-f0-9]{10}$/);
  assert.equal(rules.validateItemProperties([{ ...limited }])[0].id, limited.id, 'an id is kept');
  assert.throws(() => rules.validateItemProperties([{ name: ' ', text: '' }]), /name or a description/);
  assert.throws(() => rules.validateItemProperties([{ name: 'x', uses: { max: 50 } }]), /1 to 20/);
  assert.equal(rules.validateItemProperties([{ name: 'x', uses: { max: 2, recovery: 'weird' } }])[0].uses.recovery, 'dawn');
  assert.equal(rules.describeItemPropertyUses({ max: 3, recovery: 'short' }), '3 uses, back on a Short or Long Rest');
});

test("the Rapier gets the Talon's properties; Secret Message is on the Resources card, back with the Long Rest (the dawn)", () => {
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'setProperties', params: { index: 1, name: 'Torch', properties: TALON } }), /item list changed/);
  const result = db.changeCharacterInventory({ ...who, action: 'setProperties', params: { index: 1, name: 'Rapier', properties: TALON } });
  const rapier = result.inventory.items[1];
  assert.deepEqual(rapier.properties.map(property => property.name), ['Sylvan Talon', 'Secret Message']);
  assert.equal(rapier.properties[1].usesText, '1 use, back at dawn');
  assert.equal(rapier.properties[1].used, 0);

  const data = sheet();
  const context = rules.deriveVitalsContext({ species: 'Elf', sheetData: data, classRows: [{ className: 'Rogue', subclassName: 'Thief', level: 3 }] });
  const resource = context.resources.find(entry => entry.item);
  assert.equal(resource.name, 'Secret Message (Cierń)', 'named after the nickname');
  assert.equal(resource.max, 1);
  assert.match(resource.text, /cast Message.*1 use, back at dawn/);
  assert.equal(context.resources.filter(entry => entry.item).length, 1, 'the always-on property is not a resource');

  let vitals = rules.normalizeVitals(data, context.hpMax);
  vitals = rules.applyVitalsAction(vitals, 'useResource', { key: resource.key }, context).vitals;
  assert.throws(() => rules.applyVitalsAction(vitals, 'useResource', { key: resource.key }, context));
  db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify({ ...data, ...vitals }), id);
  assert.equal(db.getCharacterInventory(who).items[1].properties[1].used, 1, 'the item shows it used');
  assert.equal(rules.applyVitalsAction(vitals, 'shortRest', {}, context).vitals.resourcesUsed[resource.key], 1, 'not back after a Short Rest');
  assert.equal(rules.applyVitalsAction(vitals, 'longRest', {}, context).vitals.resourcesUsed[resource.key], undefined, 'back with the Long Rest');

  // Editing keeps its id (and its use); removing it forgets the use.
  const kept = db.getCharacterInventory(who).items[1].properties.map(({ id: key, name, text, uses }) => ({ id: key, name, text, uses }));
  db.changeCharacterInventory({ ...who, action: 'setProperties', params: { index: 1, name: 'Rapier', properties: [kept[0], { ...kept[1], text: 'Cast Message once per dawn.' }] } });
  assert.equal(sheet().resourcesUsed[resource.key], 1);
  db.changeCharacterInventory({ ...who, action: 'setProperties', params: { index: 1, name: 'Rapier', properties: [kept[0]] } });
  assert.equal((sheet().resourcesUsed || {})[resource.key], undefined);
  db.changeCharacterInventory({ ...who, action: 'setProperties', params: { index: 1, name: 'Rapier', properties: [] } });
  assert.equal(sheet().inventory[1].properties, undefined);
});

test("another Rapier doesn't stack onto the one with the Talon, and a gift keeps its properties", () => {
  db.changeCharacterInventory({ ...who, action: 'setProperties', params: { index: 1, name: 'Rapier', properties: TALON } });
  db.changeCharacterInventory({ ...who, action: 'add', params: { name: 'Rapier' } });
  const rapiers = sheet().inventory.filter(row => row.name === 'Rapier');
  assert.equal(rapiers.length, 2);
  assert.equal(rapiers[0].quantity, 1);
  const { receiveInventoryRow } = require('../db/gifts');
  const given = receiveInventoryRow({ inventory: [{ name: 'Rapier', quantity: 1 }] }, rapiers[0], 1);
  assert.equal(given.inventory.length, 2, 'not stacked onto a plain Rapier');
  assert.equal(given.inventory[1].properties.length, 2);
});
