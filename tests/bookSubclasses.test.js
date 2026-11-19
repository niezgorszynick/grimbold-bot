// Subclasses from Arcana Unleashed and Ravenloft: The Horrors Within: the class
// lists, their spells, choices and limited uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

const abilities = scores => Object.fromEntries(Object.entries({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...scores }).map(([key, score]) => [key, { score }]));

test('the new subclasses are offered for their classes', () => {
  const tree = rules.DND_CLASSES_AND_SUBCLASSES;
  const expected = {
    Bard: ['College of Spirits'], Cleric: ['Arcana Domain', 'Grave Domain'], Fighter: ['Arcane Archer'], Monk: ['Warrior of the Mystic Arts'],
    Ranger: ['Hollow Warden'], Rogue: ['Phantom'], Sorcerer: ['Shadow Sorcery'], Warlock: ['Undead Patron', 'Vestige Patron'],
    Wizard: ['Conjurer', 'Enchanter', 'Necromancer', 'Transmuter']
  };
  for (const [className, names] of Object.entries(expected)) {
    for (const name of names) assert.ok(tree[className].includes(name), `${name} (${className})`);
  }
});

test('always-prepared spells, the Vestige Patron following its chosen domain', () => {
  assert.deepEqual(rules.subclassSpellsFor({ subclassName: 'Grave Domain', level: 5 }),
    ['Detect Evil and Good', 'False Life', 'Gentle Repose', 'Ray of Enfeeblement', 'Spare the Dying', 'Revivify', 'Vampiric Touch']);
  assert.deepEqual(rules.subclassSpellsFor({ subclassName: 'Necromancer', level: 5 }), []);
  assert.deepEqual(rules.subclassSpellsFor({ subclassName: 'Necromancer', level: 6 }), ['Animate Dead']);
  assert.deepEqual(rules.subclassSpellsFor({ subclassName: 'Vestige Patron', level: 5 }, {}), [], 'no domain chosen yet');
  const [feature] = rules.featuresAtLevel('Warlock', 'Vestige Patron', 3);
  assert.equal(feature.id, 'Vestige Patron:3:Vestige Spells');
  const { sheetData } = rules.applyFeatureChoices({}, [feature], { [feature.id]: 'War' });
  assert.deepEqual(rules.subclassSpellsFor({ subclassName: 'Vestige Patron', level: 5 }, sheetData),
    ['Guiding Bolt', 'Magic Weapon', 'Shield of Faith', 'Spiritual Weapon', "Crusader's Mantle", 'Spirit Guardians']);
});

test('Warrior of the Mystic Arts casts Sorcerer spells with Wisdom as a one-third caster', () => {
  const character = { classes: [{ className: 'Monk', subclassName: 'Warrior of the Mystic Arts', level: 7 }], sheetData: { abilities: abilities({ wis: 16 }) } };
  const source = rules.getSpellSources(character).find(item => item.kind === 'class');
  assert.equal(source.list, 'Sorcerer');
  assert.equal(source.ability, 'wis');
  assert.equal(source.cantripLimit, 2);
  assert.equal(source.preparedLimit, 5);
  assert.equal(source.maxSpellLevel, 2);
  assert.equal(source.changeRule, 'levelUpOne');
});

test('Arcana Domain learns two Wizard cantrips, and Wizard spells of levels 6–9 at 17', () => {
  const at = level => rules.getSpellSources({ classes: [{ className: 'Cleric', subclassName: 'Arcana Domain', level }], sheetData: { abilities: abilities({ wis: 16 }) } });
  const student = at(3).find(source => source.key === 'Student of Arcana');
  assert.equal(student.list, 'Wizard');
  assert.equal(student.cantripLimit, 2);
  assert.equal(student.swapClass, 'Cleric');
  assert.ok(!at(16).some(source => source.key === 'Magical Mastery'));
  const mastery = at(17).find(source => source.key === 'Magical Mastery');
  assert.deepEqual([mastery.minSpellLevel, mastery.maxSpellLevel, mastery.preparedLimit], [6, 9, 4]);
});

test('Arcane Archer: Arcana and Nature, and the chosen cantrip cast with Intelligence', () => {
  const features = rules.featuresAtLevel('Fighter', 'Arcane Archer', 3);
  const cantrip = features.find(feature => feature.kind === 'option');
  const { sheetData } = rules.applyFeatureChoices({ skillProficiencies: ['Nature'] }, features, { [cantrip.id]: 'Prestidigitation' });
  assert.deepEqual(sheetData.skillProficiencies.sort(), ['Arcana', 'Nature']);
  const source = rules.getSpellSources({ classes: [{ className: 'Fighter', subclassName: 'Arcane Archer', level: 3 }], sheetData: { ...sheetData, abilities: abilities({ int: 14 }) } })
    .find(item => item.key === 'Arcane Archer Lore');
  assert.deepEqual(source.alwaysPrepared, ['Prestidigitation']);
  assert.equal(source.ability, 'int');
});

test('Enchanting Conversationalist adds INT only to the chosen skill', () => {
  const [feature] = rules.featuresAtLevel('Wizard', 'Enchanter', 3);
  const { sheetData } = rules.applyFeatureChoices({}, [feature], { [feature.id]: ['Persuasion'] });
  assert.deepEqual(sheetData.skillProficiencies, ['Persuasion']);
  const bonuses = rules.featureCheckBonuses(sheetData, ability => (ability === 'int' ? 18 : 10));
  assert.deepEqual(bonuses.skills, { Persuasion: 4 });
});

const SCORES = ability => ({ int: 18, wis: 16, cha: 16, dex: 16 }[ability] || 10);
const usesOf = (className, subclassName, level) =>
  Object.fromEntries(rules.classResources([{ className, subclassName, level }], SCORES).map(resource => [resource.key, resource]));

test('limited uses follow the level and ability', () => {
  const archer = usesOf('Fighter', 'Arcane Archer', 15);
  assert.equal(archer.arcaneShot.max, 4);
  assert.equal(archer.arcaneShot.recovery, 'short');
  assert.equal(archer.arcaneShot.rolls[0].formula, '1d10');
  assert.equal(usesOf('Rogue', 'Phantom', 13).wailsFromTheGrave.rolls[0].formula, '4d6', 'half of 7 Sneak Attack dice, round up');
  assert.equal(usesOf('Warlock', 'Vestige Patron', 3).divinePower.recovery, 'long');
  assert.equal(usesOf('Warlock', 'Vestige Patron', 6).divinePower.recovery, 'short');
  assert.equal(usesOf('Warlock', 'Undead Patron', 3).formOfDread.rolls[0].formula, '1d10+3');
  assert.equal(usesOf('Cleric', 'Grave Domain', 6).sentinelAtDeathsDoor.max, 3);
  const arcana = usesOf('Cleric', 'Arcana Domain', 6).channelDivinityCleric;
  assert.ok(arcana.rolls.some(roll => roll.key === 'fortifying' && roll.formula === '2d8+6'));
});
