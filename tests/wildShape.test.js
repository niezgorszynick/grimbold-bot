const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const abilities = scores => Object.fromEntries(Object.entries({ str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 10, ...scores })
  .map(([key, score]) => [key, { score }]));

function addDruid(owner, { level = 2, subclass = 'Circle of the Land', sheet = {} } = {}) {
  const sheetData = { abilities: abilities(), skillProficiencies: ['Perception', 'Athletics'], savingProficiencies: ['int', 'wis'], ...sheet };
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Fern', 'Human', 'Druid', ?, ?, 0, 'alive', 0, ?)
  `).run(owner, subclass, level, JSON.stringify(sheetData)).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary) VALUES (?, ?, ?, ?, 1)')
    .run(id, 'Druid', subclass, level);
  return id;
}

// What the vitals route does: apply one action and save the sheet.
function vitals(id, action, params = {}) {
  const character = db.getCharacterById(id);
  const sheetData = JSON.parse(character.sheet_data);
  const classRows = db.getCharacterClasses(id).map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }));
  const context = rules.deriveVitalsContext({ species: character.race, sheetData, classRows });
  const outcome = rules.applyVitalsAction(rules.normalizeVitals(sheetData, context.hpMax), action, params, context);
  db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify({ ...sheetData, ...outcome.vitals }), id);
  return outcome;
}

test('beasts.md stat blocks: abilities, skills and rollable attacks', () => {
  const hound = rules.getBeast('Practice Hound');
  assert.equal(hound.cr, 0.25);
  assert.equal(hound.armorClass, 12);
  assert.deepEqual(hound.abilities, { str: 14, dex: 15, con: 12, int: 3, wis: 12, cha: 6 });
  assert.equal(hound.saves.int, -4, 'en dashes read as minus signs');
  assert.deepEqual(hound.skills, { Perception: 5, Stealth: 4 });
  assert.deepEqual(hound.actions[0].attack, { kind: 'melee', bonus: 4, reach: 'reach 5 ft.', damage: { formula: '1d6+2', type: 'Piercing', text: '5 (1d6+2) Piercing', others: [] } });

  const gore = rules.getBeast('Practice Charger').actions.find(action => action.name === 'Gore').attack.damage;
  assert.equal(gore.formula, '2d4+4+1d6', '"plus" damage is part of the roll');
  assert.equal(gore.type, 'Piercing + Poison');
  assert.deepEqual(gore.others, [{ formula: '2d4', type: 'Piercing', kind: 'extra' }]);
  assert.equal(rules.getBeast('Practice Charger').actions.find(action => action.name === 'Stomp').attack, undefined, 'saving throws stay text');
  assert.equal(rules.getBeast('Practice Charger').bonusActions[0].name, 'Snort');

  const talons = rules.getBeast('Practice Owl').actions[0].attack.damage;
  assert.equal(talons.formula, '1');
  assert.deepEqual(talons.others, [{ formula: '1d4', type: 'Slashing', kind: 'or' }]);
  assert.equal(rules.getBeast('Practice Owl').fly, true);
});

test('Wild Shape limits follow druid level, and Circle of the Moon goes further', () => {
  const at = (level, subclassName = null) => rules.wildShapeRules([{ className: 'Druid', subclassName, level }]);
  assert.equal(rules.wildShapeRules([{ className: 'Druid', level: 1 }]), null);
  assert.equal(rules.wildShapeRules([{ className: 'Cleric', level: 5 }]), null);
  assert.deepEqual([at(2).knownLimit, at(2).maxCr, at(2).canFly, at(2).tempHp], [4, 0.25, false, 2]);
  assert.deepEqual([at(4).knownLimit, at(4).maxCr], [6, 0.5]);
  assert.deepEqual([at(8).knownLimit, at(8).maxCr, at(8).canFly], [8, 1, true]);
  assert.deepEqual([at(3, 'Circle of the Moon').maxCr, at(3, 'Circle of the Moon').tempHp], [1, 9]);
  assert.equal(at(9, 'Circle of the Moon').maxCr, 3);
});

test('learning forms: CR, flying and the number of forms are checked', () => {
  const owner = createPlayer();
  const id = addDruid(owner);
  const who = { id, player_id: owner, is_admin: false };
  let view = db.getCharacterWildShape(who);
  assert.deepEqual(view.learnable.map(beast => beast.name), ['Practice Hound'], 'CR 1 and flying beasts are out of reach at level 2');

  view = db.changeCharacterWildShapeForms({ ...who, change: { learn: 'Practice Hound' } });
  assert.deepEqual(view.known.map(form => form.name), ['Practice Hound']);
  assert.throws(() => db.changeCharacterWildShapeForms({ ...who, change: { learn: 'Practice Charger' } }), /CR 1; your limit is CR 1\/4/);
  assert.throws(() => db.changeCharacterWildShapeForms({ ...who, change: { learn: 'Practice Owl' } }), /Fly Speed/);
  assert.throws(() => db.changeCharacterWildShapeForms({ ...who, change: { learn: 'Practice Hound' } }), /already know/);
  assert.throws(() => db.getCharacterWildShape({ id, player_id: createPlayer(), is_admin: false }), /Forbidden/);

  const moon = addDruid(owner, { level: 3, subclass: 'Circle of the Moon' });
  view = db.changeCharacterWildShapeForms({ id: moon, player_id: owner, is_admin: false, change: { learn: 'Practice Charger' } });
  assert.equal(view.known[0].block.armorClass, 16, 'Circle Forms: 13 + WIS beats the beast\'s AC 11');

  view = db.changeCharacterWildShapeForms({ ...who, change: { forget: 'Practice Hound' } });
  assert.deepEqual(view.known, []);
});

test('Transform: a use, temporary HP and the beast\'s stats; it ends at 0 HP, on revert or a Long Rest', () => {
  const owner = createPlayer();
  const id = addDruid(owner, { sheet: { wildShape: { known: ['Practice Hound'] } } });
  assert.throws(() => vitals(id, 'wildShape', { form: 'Practice Owl' }), /Learn that form first/);

  const outcome = vitals(id, 'wildShape', { form: 'Practice Hound' });
  assert.equal(outcome.vitals.wildShapeForm, 'Practice Hound');
  assert.equal(outcome.vitals.hpTemp, 2, 'temporary HP equal to the druid level');
  assert.equal(outcome.vitals.resourcesUsed.wildShape, 1);

  // Rolls use the beast's STR/DEX/CON and attacks; WIS stays the druid's.
  const options = db.rollOptions(db.getCharacterById(id));
  assert.equal(options.get('check:str').formula, '1d20+2');
  assert.equal(options.get('save:wis').formula, '1d20+5', 'WIS 16 with proficiency');
  assert.equal(options.get('skill:Athletics').formula, '1d20+4', 'the druid\'s proficiency on the beast\'s STR');
  assert.equal(options.get('skill:Perception').formula, '1d20+5', 'the better of the two');
  assert.equal(options.get('beast:0:hit').formula, '1d20+4');
  assert.equal(options.get('beast:0:damage').formula, '1d6+2');

  const [snapshot] = db.getCharacterSnapshots([id]);
  assert.deepEqual(snapshot.wildShape, { name: 'Practice Hound' });
  assert.equal(snapshot.armorClass, 12);
  assert.deepEqual(snapshot.attacks.map(attack => [attack.roll, attack.name, attack.attackBonus]), [['beast:0', 'Bite', '+4']]);

  vitals(id, 'revertWildShape');
  assert.equal(db.rollOptions(db.getCharacterById(id)).has('beast:0:hit'), false);
  assert.throws(() => vitals(id, 'revertWildShape'), /not in a Wild Shape form/);

  vitals(id, 'wildShape', { form: 'Practice Hound' });
  assert.throws(() => vitals(id, 'wildShape', { form: 'Practice Hound' }), /only 0 left/, 'two uses at level 2');
  const down = vitals(id, 'damage', { amount: 500 });
  assert.equal(down.vitals.wildShapeForm, null);
  assert.ok(down.events.includes('wildShapeEnded'));

  vitals(id, 'heal', { amount: 5 });
  const rested = vitals(id, 'longRest');
  assert.equal(rested.vitals.resourcesUsed.wildShape, undefined, 'all uses back');
});
