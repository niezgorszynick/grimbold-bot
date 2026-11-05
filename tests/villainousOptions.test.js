// The Unearthed Arcana 2026 "Villainous Options" subclasses: Pestilence
// Domain, Circle of the Titan, Hell Knight and Demonic Sorcery. The feature
// text comes from a fixture here (the real file is kept off Git).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'grimbold-ua-'));
fs.writeFileSync(path.join(fixtures, 'subclasses.md'), [
  '## Hell Knight', '- Class: Fighter', '', 'Champions of the Nine Hells.', '',
  '### Level 3: Diabolical Gift', '**Devil\'s Sight.** See in darkness.', '',
  '### Level 3: Infernal Wound', 'A d6 of hellfire.', '',
  '| 1d6 | Pursuit |', '| --- | --- |', '| 1 | Treasure |', '',
  '### Level 7: Advanced Wounds', 'On a 6.', ''
].join('\n'));
process.env.RULES_CONTENT_DIR = fixtures;
const rules = require('../rules');

const row = (className, subclassName, level) => ({ className, subclassName, level });
const scores = values => ability => values[ability] ?? 10;

test('the four subclasses can be chosen, and give their always-prepared spells', () => {
  assert.ok(rules.DND_CLASSES_AND_SUBCLASSES.Cleric.includes('Pestilence Domain'));
  assert.ok(rules.DND_CLASSES_AND_SUBCLASSES.Druid.includes('Circle of the Titan'));
  assert.ok(rules.DND_CLASSES_AND_SUBCLASSES.Fighter.includes('Hell Knight'));
  assert.ok(rules.DND_CLASSES_AND_SUBCLASSES.Sorcerer.includes('Demonic Sorcery'));
  assert.deepEqual(rules.subclassSpellsFor(row('Cleric', 'Pestilence Domain', 5)),
    ['Detect Poison and Disease', 'Protection from Poison', 'Ray of Enfeeblement', 'Ray of Sickness', 'Stinking Cloud', 'Vampiric Touch']);
  assert.deepEqual(rules.subclassSpellsFor(row('Druid', 'Circle of the Titan', 9)),
    ['Cure Wounds', 'Longstrider', 'Thaumaturgy', 'Fear', 'Stoneskin', 'Destructive Wave']);
  assert.deepEqual(rules.subclassSpellsFor(row('Sorcerer', 'Demonic Sorcery', 3)), ['Detect Magic', 'Entangle', 'Misty Step', 'Spider Climb']);
  assert.deepEqual(rules.subclassSpellsFor(row('Fighter', 'Hell Knight', 20)), []);
});

test('their limited uses: Virulent Burst, Vermin Form, Infernal Wound, Abyssal Aura, Fiendish Servant', () => {
  const of = (classRow, values) => Object.fromEntries(rules.classResources([classRow], scores(values)).map(resource => [resource.key, resource]));
  const cleric = of(row('Cleric', 'Pestilence Domain', 17), { wis: 18 });
  assert.equal(cleric.virulentBurst.max, 4);
  assert.equal(cleric.virulentBurst.recovery, 'long');
  assert.equal(cleric.verminForm.max, 1);
  assert.match(cleric.channelDivinityCleric.text, /Plague Blessing/);
  assert.equal(of(row('Cleric', 'Pestilence Domain', 5), { wis: 18 }).virulentBurst, undefined, 'from level 6');

  const knight = of(row('Fighter', 'Hell Knight', 7), { con: 14 });
  assert.deepEqual([knight.infernalWound.max, knight.infernalWound.recovery], [2, 'short']);
  assert.match(knight.infernalWound.text, /Purulence of Minauros/);
  assert.doesNotMatch(knight.infernalWound.text, /Blister of Avernus/, 'level 15');
  assert.equal(of(row('Fighter', 'Hell Knight', 3), { con: 8 }).infernalWound.max, 1, 'at least once');

  const sorcerer = of(row('Sorcerer', 'Demonic Sorcery', 18), { cha: 18 });
  assert.match(sorcerer.abyssalAura.text, /20-ft\. Emanation.*roll twice/);
  assert.equal(sorcerer.fiendishServant.max, 1);
});

test('Hell Knights learn Infernal', () => {
  const [gift] = rules.featuresAtLevel('Fighter', 'Hell Knight', 3);
  assert.deepEqual([gift.name, gift.kind, gift.grants.languages], ["Devil's Tongue", 'grant', ['Infernal']]);
  const knight = rules.buildStartingCharacter({
    name: 'Varr', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Hell Knight', fightingStyle: 'Defense',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  });
  assert.ok(knight.sheetData.languages.includes('Infernal'));
});

test('Circle of the Titan: three Titan Forms built from the druid, taken with Wild Shape', () => {
  assert.equal(rules.titanFormRules([row('Druid', 'Circle of the Moon', 10)]), null);
  const low = rules.titanFormRules([row('Druid', 'Circle of the Titan', 3)]);
  assert.deepEqual([low.tempHp, low.sizes, low.multiattack], [6, ['Large'], false]);
  const high = rules.titanFormRules([row('Druid', 'Circle of the Titan', 14)]);
  assert.deepEqual(high.sizes, ['Large', 'Huge', 'Gargantuan']);

  const own = { wis: 18, con: 14 };
  const behemoth = rules.titanFormBeast('Behemoth', high, { own, spellAttack: 9 });
  const leviathan = rules.titanFormBeast('Leviathan', high, { own, spellAttack: 9 });
  const insectoid = rules.titanFormBeast('Insectoid', low, { own, spellAttack: 5 });
  assert.deepEqual([behemoth.armorClass, leviathan.armorClass, insectoid.armorClass], [15, 14, 12]);
  assert.deepEqual(behemoth.abilities, { str: 18, dex: 18, con: 14 });
  assert.equal(rules.titanFormBeast('Wolf', high, { own, spellAttack: 9 }), null);
  const names = list => list.map(entry => entry.name);
  assert.deepEqual(names(behemoth.actions), ['Multiattack', 'Rend', 'Incandescent Breath']);
  assert.ok(names(behemoth.traits).includes('Rampager') && names(behemoth.traits).includes('Swallow'));
  assert.deepEqual(names(insectoid.actions), ['Rend', 'Energizing Pollen'], 'no Multiattack before level 5');
  assert.ok(!names(insectoid.traits).includes('Hive Mind'), 'level 10');
  assert.deepEqual(names(leviathan.reactions), ['Ink Cloud']);

  const classes = [row('Druid', 'Circle of the Titan', 14)];
  const block = rules.wildShapeBlock(behemoth, { classes, sheetData: { abilities: { wis: { score: 18 }, con: { score: 14 } } }, status: rules.wildShapeRules(classes) });
  assert.deepEqual(block.attacks.map(attack => [attack.name, attack.attackBonus, attack.damage.formula, attack.damage.type]), [['Rend', 9, '1d8+4', 'Slashing']]);

  // Wild Shape: a Titan Form needs no learning and gives 2 × druid level temporary HP.
  const sheetData = { abilities: { wis: { score: 18 }, con: { score: 14 } } };
  const context = rules.deriveVitalsContext({ species: 'Human', sheetData, classRows: classes });
  const vitals = rules.normalizeVitals(sheetData, context.hpMax);
  const shaped = rules.applyVitalsAction(vitals, 'wildShape', { form: 'Leviathan' }, context).vitals;
  assert.deepEqual([shaped.wildShapeForm, shaped.hpTemp, shaped.resourcesUsed.wildShape], ['Leviathan', 28, 1]);
  const moon = [row('Druid', 'Circle of the Moon', 14)];
  const moonContext = rules.deriveVitalsContext({ species: 'Human', sheetData, classRows: moon });
  assert.throws(() => rules.applyVitalsAction(rules.normalizeVitals(sheetData, moonContext.hpMax), 'wildShape', { form: 'Behemoth' }, moonContext), /Learn that form first/);
});

test('subclass feature text: the features reached, the ones to come, and a playtest note', () => {
  const [knight] = rules.subclassFeatureTexts([row('Fighter', 'Hell Knight', 5), row('Wizard', null, 1)]);
  assert.deepEqual(knight.features.map(feature => [feature.level, feature.name]), [[3, 'Diabolical Gift'], [3, 'Infernal Wound']]);
  assert.deepEqual(knight.upcoming, [{ level: 7, name: 'Advanced Wounds' }]);
  assert.match(knight.features[1].text, /\| 1 \| Treasure \|/);
  assert.match(knight.source, /Unearthed Arcana 2026/);
  assert.equal(knight.intro, 'Champions of the Nine Hells.');
  assert.deepEqual(rules.subclassFeatureTexts([row('Fighter', 'Champion', 10)]), [], 'no text for it yet');
});
