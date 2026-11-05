const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

const brief = list => list.map(item => [item.kind, item.text, item.when || null]);

test('defenses from species, lineage and ancestry', () => {
  const of = (species, speciesOption) => brief(rules.characterDefenses({ classes: [], species, sheetData: { speciesOption } }));
  assert.deepEqual(of('Dwarf'), [['resistance', 'Poison', null], ['advantage', 'Saves against Poisoned', null], ['sense', 'Darkvision 120 ft.', null]]);
  assert.deepEqual(of('Dragonborn', 'Gold (Fire)'), [['resistance', 'Fire', null], ['sense', 'Darkvision 60 ft.', null]]);
  assert.deepEqual(of('Elf', 'Drow')[0], ['sense', 'Darkvision 120 ft.', null]);
  assert.deepEqual(of('Elf', 'Wood Elf')[0], ['sense', 'Darkvision 60 ft.', null]);
  assert.deepEqual(of('Tiefling', 'Chthonic')[0], ['resistance', 'Necrotic', null]);
  assert.deepEqual(of('Human'), []);
});

test('defenses from subclasses and feats; conditional ones switch on with their state', () => {
  const knight = rules.characterDefenses({ classes: [{ className: 'Fighter', subclassName: 'Hell Knight', level: 7 }], species: 'Human', sheetData: {} });
  assert.deepEqual(brief(knight), [
    ['sense', "Devil's Sight 120 ft. (magical Darkness too)", null],
    ['resistance', 'Fire', 'wearing armor or wielding a Shield']
  ]);
  const cleric = brief(rules.characterDefenses({ classes: [{ className: 'Cleric', subclassName: 'Pestilence Domain', level: 17 }], species: 'Human', sheetData: {} }));
  assert.ok(cleric.some(([kind, text, when]) => kind === 'resistance' && text === 'Necrotic' && !when));
  assert.ok(cleric.some(([kind, , when]) => kind === 'condition' && when === 'in Vermin Form'));

  const lich = rules.characterDefenses({ classes: [{ className: 'Wizard', level: 12 }], species: 'Dwarf', sheetData: {}, feats: [{ name: 'Lich Initiate' }, { name: 'Lich Ascension' }] });
  assert.deepEqual(lich.find(item => item.kind === 'type').text, 'Undead');
  assert.equal(lich.find(item => item.kind === 'resistance' && item.text === 'Poison').source, 'Dwarven Resilience, Lich Ascension', 'one Poison, both sources');

  // Full of Stars: on only in Starry Form.
  const classRows = [{ className: 'Druid', subclassName: 'Circle of the Stars', level: 14 }];
  const sheetData = { abilities: { wis: { score: 16 } } };
  const context = rules.deriveVitalsContext({ species: 'Human', sheetData, classRows });
  const rest = rules.normalizeVitals(sheetData, context.hpMax);
  const stars = view => rules.buildVitalsView(view, context).defenses.find(item => item.source === 'Full of Stars');
  assert.equal(stars(rest).active, false);
  const formed = rules.applyVitalsAction(rest, 'starryForm', { constellation: 'Dragon' }, context).vitals;
  assert.equal(stars(formed).active, true);
});
