// Feats and backgrounds from Arcana Unleashed, Eberron: Forge of the Artificer
// and Ravenloft: The Horrors Within.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

const abilities = scores => Object.fromEntries(Object.entries({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...scores }).map(([key, score]) => [key, { score }]));

test('the book feats sit in their categories', () => {
  assert.equal(rules.ORIGIN_FEATS['Mark of Healing'].category, 'Dragonmark');
  assert.equal(rules.ORIGIN_FEATS['Mist Walker'].category, 'Dark Gift');
  assert.ok(rules.ORIGIN_FEATS['Arcane Artist']);
  assert.ok(rules.GENERAL_FEATS['Evocation Adept']);
  assert.ok(rules.FIGHTING_STYLE_NAMES.includes('Arcane Warrior'));
  assert.ok(rules.EPIC_BOONS['Boon of Siberys']);
  assert.equal(rules.DRAGONMARK_FEATS.length, 13);
});

test('prerequisites: one Dragonmark, Greater marks need theirs, Familiar feats need Familiar Friend', () => {
  const context = feats => ({ classes: [{ className: 'Wizard', level: 8 }], sheetData: { originFeats: feats.map(name => ({ name })) }, scores: { int: 16 }, totalLevel: 8 });
  assert.equal(rules.featIneligibility('Mark of Storm', context(['Mark of Healing'])), 'You already have a Dragonmark feat.');
  assert.equal(rules.featIneligibility('Mark of Storm', context(['Alert'])), null);
  assert.match(rules.featIneligibility('Greater Mark of Healing', context(['Mark of Storm'])), /Mark of Healing/);
  assert.equal(rules.featIneligibility('Greater Mark of Healing', context(['Mark of Healing'])), null);
  assert.match(rules.featIneligibility('Warlike Familiar', context([])), /Familiar Friend/);
  assert.equal(rules.featIneligibility('Potent Dragonmark', context([])), 'Requires a Dragonmark feat.');
  assert.equal(rules.featIneligibility('Potent Dragonmark', context(['Mark of Shadow'])), null);
});

const sourcesFor = (classes, feats, scores = {}) => rules.getSpellSources({ classes, sheetData: { originFeats: feats, abilities: abilities(scores) } });

test('Dragonmark spells: cast once, more at level 3, and the Spells of the Mark join the class list', () => {
  const feat = { name: 'Mark of Healing', spellAbility: 'wis' };
  const at = level => sourcesFor([{ className: 'Cleric', level }], [feat], { wis: 16 });
  assert.deepEqual(at(1).find(source => source.key === 'Mark of Healing').alwaysPrepared, ['Cure Wounds']);
  const three = at(3);
  const mark = three.find(source => source.key === 'Mark of Healing');
  assert.deepEqual(mark.alwaysPrepared, ['Cure Wounds', 'Lesser Restoration']);
  assert.equal(mark.freeEach, 1);
  assert.equal(mark.ability, 'wis');
  const cleric = three.find(source => source.kind === 'class');
  assert.ok(cleric.extraSpells.includes('Arcane Vigor'), 'a Wizard spell on the Cleric list');
});

test('Potent Dragonmark prepares the Spells of the Mark the slots allow', () => {
  const sources = sourcesFor([{ className: 'Wizard', level: 5 }], [{ name: 'Mark of Storm', spellAbility: 'int' }, { name: 'Potent Dragonmark' }], { int: 16 });
  const mark = sources.find(source => source.key === 'Mark of Storm');
  assert.ok(mark.alwaysPrepared.includes('Sleet Storm'), 'level 3 spell with level 3 slots');
  assert.ok(!mark.alwaysPrepared.includes('Control Water'), 'no level 4 slots yet');
  assert.ok(mark.alwaysPrepared.includes('Thunderclap') && mark.alwaysPrepared.includes('Gust of Wind'));
});

test('Adept feats prepare their spells by spell slot level', () => {
  const at = level => sourcesFor([{ className: 'Sorcerer', level }], [{ name: 'Evocation Adept' }], { cha: 16 })
    .find(source => source.key === 'Evocation Adept').alwaysPrepared;
  assert.deepEqual(at(4), ['Chromatic Orb', 'Shatter']);
  assert.deepEqual(at(9), ['Chromatic Orb', 'Shatter', 'Fireball', 'Vitriolic Sphere', 'Wall of Force']);
});

test('Aberrant Dragonmark: a Sorcerer cantrip and level 1 spell, cast with Constitution', () => {
  const source = sourcesFor([{ className: 'Fighter', level: 3 }], [{ name: 'Aberrant Dragonmark' }], { con: 14 }).find(item => item.key === 'Aberrant Dragonmark');
  assert.equal(source.list, 'Sorcerer');
  assert.equal(source.ability, 'con');
  assert.equal(source.cantripLimit, 1);
  assert.equal(source.preparedLimit, 1);
});

test('defenses from book feats', () => {
  const list = rules.characterDefenses({ classes: [], species: 'Human', sheetData: {}, feats: [{ name: 'Mark of Storm' }, { name: 'Aberrant Anatomy' }] })
    .map(item => `${item.kind}:${item.text}`);
  assert.ok(list.includes('resistance:Lightning'));
  assert.ok(list.includes('sense:Blindsight 15 ft.'));
});

const build = (background, extra = {}) => rules.buildStartingCharacter({
  name: 'Test', species: 'Kalashtar', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Defense',
  background, generationMethod: 'Standard Array',
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, backgroundBonuses: rules.BACKGROUNDS[background].abilityBoosts.slice(0, 2).reduce((all, ability, index) => ({ ...all, [ability]: index ? 1 : 2 }), {}),
  classSkills: ['Acrobatics', 'Animal Handling'], languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A', ...extra
});

test('a dragonmarked heir starts with the mark, its spells cast with the chosen ability', () => {
  assert.throws(() => build('House Jorasco Heir'), /spellcasting ability for Mark of Healing/);
  const built = build('House Jorasco Heir', { originFeatChoices: { spellAbility: 'wis' } });
  assert.deepEqual(built.sheetData.originFeats.map(feat => [feat.name, feat.spellAbility]), [['Mark of Healing', 'wis']]);
  assert.ok(built.sheetData.skillProficiencies.includes('Medicine'));
  assert.ok(built.sheetData.toolProficiencies.includes('Herbalism Kit'));
});

test('a Ravenloft background can trade its feat for a Dark Gift', () => {
  const built = build('Haunted One', { backgroundTool: 'Dice', backgroundFeat: 'Aberrant Anatomy' });
  assert.equal(built.sheetData.originFeats[0].name, 'Aberrant Anatomy');
  assert.ok(built.sheetData.skillProficiencies.includes('Perception'));
});
