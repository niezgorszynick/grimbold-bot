// Species from Eberron: Forge of the Artificer and Ravenloft: The Horrors Within.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

const build = (species, extra = {}) => rules.buildStartingCharacter({
  name: 'Test', species, size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Defense', versatileFeat: { name: 'Alert' },
  background: 'Soldier', generationMethod: 'Standard Array',
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
  classSkills: ['Acrobatics', 'Perception'], backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'],
  classEquipment: 'A', backgroundEquipment: 'A', ...extra
});

test('every new species is offered, with its own sizes and speed', () => {
  for (const name of ['Changeling', 'Kalashtar', 'Khoravar', 'Shifter', 'Warforged', 'Dhampir', 'Hexblood', 'Lupin', 'Reborn']) {
    assert.ok(rules.DND_SPECIES.includes(name), name);
  }
  assert.deepEqual(rules.sizeOptions('Kalashtar'), ['Medium']);
  assert.deepEqual(rules.sizeOptions('Warforged'), ['Medium', 'Small']);
  assert.equal(rules.speciesSpeed('Dhampir'), 35);
});

test('Warforged: +1 AC from Integrated Protection, and a skill of choice', () => {
  const human = build('Kalashtar');
  const warforged = build('Warforged', { speciesSkills: ['Stealth'] });
  assert.equal(warforged.sheetData.armorClass, human.sheetData.armorClass + 1);
  assert.match(warforged.sheetData.armorClassSource, /Warforged/);
});

test('a single species option is chosen by itself; Shifters pick their type', () => {
  const khoravar = build('Khoravar', { speciesSkills: ['Insight'], speciesSpellAbility: 'wis' });
  assert.equal(khoravar.sheetData.speciesOption, 'Friends');
  assert.throws(() => build('Shifter', { speciesSkills: ['Athletics'] }), /Shifter Type/);
  assert.throws(() => build('Shifter', { speciesSkills: ['Stealth'], speciesOption: 'Beasthide' }), /Shifter skill/);
});

test('species defenses and spells', () => {
  const defenses = (species, speciesOption) => rules.characterDefenses({ classes: [], species, sheetData: { speciesOption }, feats: [] }).map(item => `${item.kind}:${item.text}`);
  assert.ok(defenses('Reborn', 'Necrotic').includes('resistance:Necrotic'));
  assert.ok(defenses('Kalashtar').includes('resistance:Psychic'));
  assert.ok(defenses('Warforged').includes('type:Construct'));
  const sources = rules.getSpellSources({ classes: [{ className: 'Fighter', level: 1 }], species: 'Hexblood', sheetData: { speciesOption: 'Disguise Self and Hex', speciesSpellAbility: 'cha' } });
  assert.deepEqual(sources.find(source => source.kind === 'species').alwaysPrepared, ['Disguise Self', 'Hex']);
});
