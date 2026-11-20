const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

const brief = list => list.map(item => [item.kind, item.text]);
const scores = values => ability => ({ str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 16, ...values })[ability];
const at = level => [{ className: 'Fighter', subclassName: null, level }];
const uses = (species, option, level, values) => Object.fromEntries(rules.speciesResources(species, option, at(level), scores(values))
  .map(resource => [resource.name, { max: resource.max, recovery: resource.recovery, rolls: resource.rolls.map(roll => roll.formula), text: resource.text }]));

test('species uses and dice follow the character level and Proficiency Bonus', () => {
  const dragon = uses('Dragonborn', 'Silver (Cold)', 5);
  assert.deepEqual([dragon['Breath Weapon'].max, dragon['Breath Weapon'].rolls], [3, ['2d10']]);
  assert.match(dragon['Breath Weapon'].text, /DC 13\b.*2d10 Cold/);
  assert.ok(dragon['Draconic Flight']);
  assert.equal(uses('Dragonborn', 'Red (Fire)', 17)['Breath Weapon'].rolls[0], '4d10');
  assert.equal(uses('Dragonborn', 'Red (Fire)', 4)['Draconic Flight'], undefined);

  const aasimar = uses('Aasimar', null, 3);
  assert.deepEqual(aasimar['Healing Hands'].rolls, ['2d4']);
  assert.match(aasimar['Celestial Revelation'].text, /DC 13/);
  assert.equal(uses('Aasimar', null, 2)['Celestial Revelation'], undefined);

  const goliath = uses('Goliath', "Stone's Endurance", 5);
  assert.deepEqual([goliath["Stone's Endurance"].max, goliath["Stone's Endurance"].rolls], [3, ['1d12+2']]);
  assert.equal(goliath['Large Form'].max, 1, 'once per Long Rest');
  assert.deepEqual(uses('Goliath', "Fire's Burn", 1)["Fire's Burn"].rolls, ['1d10']);

  const orc = uses('Orc', null, 9);
  assert.deepEqual([orc['Adrenaline Rush'].max, orc['Adrenaline Rush'].recovery], [4, 'short']);
  assert.match(orc['Adrenaline Rush'].text, /4 Temporary Hit Points/);
  assert.equal(orc['Relentless Endurance'].max, 1);
  assert.equal(uses('Dwarf', null, 1).Stonecunning.max, 2);
  assert.deepEqual(rules.speciesResources('Human', null, at(5), scores()), []);
});

test('Lorwyn and Shadowmoor elves, kithkin, Gnomish Cunning and Otherworldly Presence', () => {
  const of = (species, speciesOption) => brief(rules.characterDefenses({ classes: [], species, sheetData: { speciesOption } }));
  assert.deepEqual(of('Elf', 'Shadowmoor Elf')[0], ['sense', 'Darkvision 120 ft.']);
  assert.deepEqual(of('Elf', 'Lorwyn Elf')[0], ['sense', 'Darkvision 60 ft.']);
  assert.ok(of('Halfling', 'Shadowmoor Kithkin').some(([kind, text]) => kind === 'sense' && text === 'Darkvision 120 ft.'));
  assert.ok(!of('Halfling', 'Lorwyn Kithkin').some(([kind]) => kind === 'sense'));
  assert.ok(of('Gnome', 'Rock Gnome').some(([, text]) => text === 'INT, WIS and CHA saves'));

  const sources = (species, option, level, ability = 'wis') => rules.getSpellSources({
    classes: at(level), species, sheetData: { speciesOption: option, speciesSpellAbility: ability, abilities: { wis: { score: 14 } } }
  }).filter(source => source.kind === 'species');
  assert.deepEqual(sources('Elf', 'Lorwyn Elf', 5)[0].alwaysPrepared, ['Thorn Whip', 'Command', 'Silence']);
  assert.deepEqual(sources('Elf', 'Shadowmoor Elf', 3)[0].alwaysPrepared, ['Starry Wisp', 'Heroism']);
  // Thaumaturgy uses the Fiendish Legacy's ability, not always Charisma.
  assert.equal(sources('Tiefling', 'Infernal', 1).find(source => source.key === 'Tiefling').ability, 'wis');
});

test('a Drow may take Undercommon as a starting language; a Halfling needs no heritage', () => {
  const base = {
    name: 'Vyx', className: 'Fighter', fightingStyle: 'Archery', subclass: 'Champion', background: 'Soldier',
    generationMethod: 'Standard Array', baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    backgroundBonuses: { str: 2, con: 1 }, classSkills: ['Perception', 'Survival'], backgroundTool: 'Dice',
    classEquipment: 'A', backgroundEquipment: 'A'
  };
  const elf = extra => rules.buildStartingCharacter({ ...base, species: 'Elf', speciesSpellAbility: 'wis', speciesSkills: ['Insight'], ...extra });
  assert.deepEqual(elf({ speciesOption: 'Drow', languages: ['Elvish', 'Undercommon'] }).sheetData.languages.sort(), ['Common', 'Elvish', 'Undercommon']);
  assert.throws(() => elf({ speciesOption: 'High Elf', languages: ['Elvish', 'Undercommon'] }), /Undercommon/);

  const halfling = rules.buildStartingCharacter({ ...base, species: 'Halfling', languages: ['Halfling', 'Dwarvish'] });
  assert.equal(halfling.sheetData.speciesOption, 'Halfling');
  const kithkin = rules.buildStartingCharacter({ ...base, species: 'Halfling', speciesOption: 'Shadowmoor Kithkin', languages: ['Halfling', 'Dwarvish'] });
  assert.equal(kithkin.sheetData.speciesOption, 'Shadowmoor Kithkin');
});
