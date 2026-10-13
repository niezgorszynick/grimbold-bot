const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

const warCleric = level => {
  const built = rules.buildStartingCharacter({
    name: 'Brother Tor', species: 'Human', size: 'Medium', className: 'Cleric', subclass: 'War Domain',
    background: 'Acolyte', generationMethod: 'Standard Array',
    baseScores: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 }, backgroundBonuses: { wis: 2, cha: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Perception'], classSkills: ['Medicine', 'Persuasion'],
    originFeatChoices: { spellList: 'Cleric', spellAbility: 'wis' },
    languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A',
    featureChoices: { 'Cleric:1:Divine Order': 'Protector' }
  });
  return { classes: [{ ...built.classes[0], level }], species: 'Human', sheetData: built.sheetData };
};
const clericSource = character => rules.getSpellSources(character).find(source => source.key === 'Cleric');

test('every subclass spell is in the spell list', () => {
  const catalog = rules.getSpellCatalog();
  const names = [...Object.values(rules.SUBCLASS_SPELLS), ...Object.values(rules.LAND_SPELLS)]
    .flatMap(table => table.flatMap(([, spells]) => spells));
  const missing = names.filter(name => !rules.findSpell(name, catalog));
  assert.deepEqual(missing, []);
});

test('a War Domain cleric always has the domain spells for their level prepared', () => {
  assert.deepEqual(clericSource(warCleric(3)).alwaysPrepared, ['Guiding Bolt', 'Magic Weapon', 'Shield of Faith', 'Spiritual Weapon']);
  assert.deepEqual(clericSource(warCleric(5)).alwaysPrepared.slice(4), ["Crusader's Mantle", 'Spirit Guardians']);

  // On the sheet, without using up the cleric's own prepared spells.
  const character = warCleric(3);
  const view = rules.buildSpellsView(character, rules.readSpellcasting(character.sheetData)).sources.find(source => source.key === 'Cleric');
  assert.ok(view.prepared.includes('Spiritual Weapon'));
  assert.equal(view.chosenPrepared.length, 0);
});

test("domain spells can't be picked again, and an earlier pick of one is dropped for free", () => {
  const character = warCleric(3);
  const source = clericSource(character);
  const state = rules.readSpellcasting(character.sheetData);
  assert.throws(() => rules.chooseSpells(state, source, { prepared: ['Guiding Bolt'] }), /always prepared for you \(War Domain\)/);

  // Prepared before the domain spells existed; no change window open.
  const before = { ...state, classes: { Cleric: { cantrips: [], prepared: ['Guiding Bolt', 'Bless'] } }, changes: {} };
  const listed = rules.buildSpellsView(character, before).sources.find(item => item.key === 'Cleric');
  assert.deepEqual(listed.chosenPrepared, ['Bless'], 'listed once, as a domain spell');
  const after = rules.chooseSpells(before, source, { prepared: ['Bless'] }).state;
  assert.deepEqual(after.classes.Cleric.prepared, ['Bless']);
  assert.throws(() => rules.chooseSpells(before, source, { prepared: ['Guiding Bolt'] }), /can change prepared spells after a Long Rest/,
    'dropping Bless still needs a change window');
});

test('Circle of the Land spells follow the chosen land', () => {
  const druid = land => ({
    classes: [{ className: 'Druid', subclassName: 'Circle of the Land', level: 5 }],
    species: 'Elf',
    sheetData: { abilities: { wis: { score: 16 } }, featureChoices: land ? { 'Circle of the Land:3:Circle Spells (Land)': { value: land } } : {} }
  });
  const always = character => rules.getSpellSources(character).find(source => source.key === 'Druid').alwaysPrepared;
  assert.deepEqual(always(druid('Polar')), ['Fog Cloud', 'Hold Person', 'Ray of Frost', 'Sleet Storm']);
  assert.deepEqual(always(druid(null)), [], 'no land chosen yet');
  const choice = rules.featuresAtLevel('Druid', 'Circle of the Land', 3).find(feature => feature.name === 'Circle Spells (Land)');
  assert.deepEqual(choice.options.map(option => option.name), ['Arid', 'Polar', 'Temperate', 'Tropical']);
});
