const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const cleric = overrides => ({
  name: 'Sister Ama', species: 'Human', size: 'Medium', className: 'Cleric', subclass: 'Life Domain',
  background: 'Acolyte', generationMethod: 'Standard Array',
  baseScores: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 }, backgroundBonuses: { wis: 2, cha: 1 },
  versatileFeat: { name: 'Alert' }, speciesSkills: ['Perception'], classSkills: ['Medicine', 'Persuasion'],
  originFeatChoices: { spellList: 'Cleric', spellAbility: 'wis' },
  languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A',
  ...overrides
});
const DIVINE_ORDER = 'Cleric:1:Divine Order';

test('a Cleric chooses a Divine Order: Protector trains Heavy armor and Martial weapons', () => {
  assert.throws(() => rules.buildStartingCharacter(cleric()), /Divine Order \(Cleric 1\): choose Protector or Thaumaturge/);
  const protector = rules.buildStartingCharacter(cleric({ featureChoices: { [DIVINE_ORDER]: 'Protector' } }));
  assert.ok(protector.sheetData.armorTraining.includes('Heavy armor'));
  assert.ok(protector.sheetData.weaponProficiencies.includes('Martial weapons'));

  // Wearing Plate: no "not trained" warning for the Protector, but one without.
  const wearing = sheetData => ({ ...sheetData, inventory: [{ name: 'Plate Armor', quantity: 1, equipped: true }] });
  const armorNotes = sheetData => rules.calculateCombat({ classes: protector.classes, species: 'Human', sheetData: wearing(sheetData) }).armorClass.notes.join(' ');
  assert.doesNotMatch(armorNotes(protector.sheetData), /Not trained/);
  const untrained = { ...protector.sheetData, armorTraining: ['Light armor', 'Medium armor', 'Shields'] };
  assert.match(armorNotes(untrained), /Not trained with heavy armor/);
});

test('Thaumaturge: one more cantrip and Wisdom on Arcana and Religion checks', () => {
  const thaumaturge = rules.buildStartingCharacter(cleric({ featureChoices: { [DIVINE_ORDER]: 'Thaumaturge' } }));
  const protector = rules.buildStartingCharacter(cleric({ featureChoices: { [DIVINE_ORDER]: 'Protector' } }));
  const limit = character => rules.getSpellSources({ classes: character.classes, sheetData: character.sheetData })
    .find(source => source.key === 'Cleric').cantripLimit;
  assert.equal(limit(thaumaturge), limit(protector) + 1);
  assert.equal(thaumaturge.sheetData.pendingChoices.cantrips, protector.sheetData.pendingChoices.cantrips + 1);
  const bonuses = rules.featureCheckBonuses(thaumaturge.sheetData, ability => thaumaturge.sheetData.abilities[ability].score);
  assert.deepEqual(bonuses.skills, { Arcana: 3, Religion: 3 }, 'WIS 17 → +3');

  // The roll on the sheet adds it.
  const id = db.insertStartingCharacter(createPlayer(), thaumaturge);
  const formula = db.rollOptions(db.getCharacterById(id)).get('skill:Arcana').formula;
  assert.equal(formula, '1d20+2', 'INT 8 (−1) + WIS bonus (+3)');
});

test("Rogues pick Expertise in skills they have, and know Thieves' Cant plus a language", () => {
  const rogue = choices => rules.buildStartingCharacter({
    name: 'Nim', species: 'Halfling', className: 'Rogue', subclass: 'Thief', background: 'Criminal', generationMethod: 'Standard Array',
    baseScores: { str: 8, dex: 15, con: 13, int: 12, wis: 14, cha: 10 }, backgroundBonuses: { dex: 2, con: 1 },
    classSkills: ['Acrobatics', 'Perception', 'Deception', 'Insight'], languages: ['Elvish', 'Giant'],
    classEquipment: 'A', backgroundEquipment: 'A', featureChoices: choices
  });
  assert.throws(() => rogue({ 'Rogue:1:Expertise': ['Arcana', 'Perception'], "Rogue:1:Thieves' Cant (Language)": ['Orc'] }),
    /aren't proficient in Arcana/);
  assert.throws(() => rogue({ 'Rogue:1:Expertise': ['Stealth', 'Perception'], "Rogue:1:Thieves' Cant (Language)": ['Elvish'] }),
    /"Elvish" is not a valid choice/, 'a language already known');
  const nim = rogue({ 'Rogue:1:Expertise': ['Stealth', 'Perception'], "Rogue:1:Thieves' Cant (Language)": ['Orc'] });
  assert.deepEqual(nim.sheetData.expertise, ['Stealth', 'Perception']);
  assert.ok(nim.sheetData.languages.includes("Thieves' Cant"));
  assert.ok(nim.sheetData.languages.includes('Orc'));
});

test('level-ups ask for the new choices and undo them on revert', () => {
  const bard = rules.buildStartingCharacter({
    name: 'Lyra', species: 'Human', size: 'Medium', className: 'Bard', subclass: 'College of Valor', background: 'Entertainer',
    generationMethod: 'Standard Array', baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }, backgroundBonuses: { cha: 2, dex: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Persuasion', 'History', 'Arcana'],
    classTools: ['Lute', 'Flute', 'Drum'], equipmentChoices: { instrument: 'Lute' },
    languages: ['Elvish', 'Giant'], classEquipment: 'A', backgroundEquipment: 'A', backgroundTool: 'Horn', originFeatChoices: { picks: ['Bagpipes', 'Lyre', 'Viol'] },
    featureChoices: { 'Bard:2:Expertise': ['Persuasion', 'Performance'] }
  });
  // College of Valor at level 3: Medium armor, Shields and Martial weapons.
  assert.ok(bard.sheetData.armorTraining.includes('Medium armor'));
  assert.ok(bard.sheetData.weaponProficiencies.includes('Martial weapons'));

  // A Valor Bard multiclassing into Rogue gets Rogue's Expertise and Thieves' Cant.
  const state = { classes: bard.classes, earnedLevel: 4, species: 'Human', sheetData: bard.sheetData };
  const option = rules.getLevelUpOptions(state).options.find(item => item.className === 'Rogue');
  assert.deepEqual(option.featureChoices.map(feature => feature.name), ['Expertise', "Thieves' Cant", "Thieves' Cant (Language)"]);
  assert.throws(() => rules.applyLevelUp(state, { className: 'Rogue', multiclassSkills: ['Stealth'] }), /\(Rogue 1\): choose/);
  const leveled = rules.applyLevelUp(state, {
    className: 'Rogue', multiclassSkills: ['Stealth'],
    featureChoices: { 'Rogue:1:Expertise': ['Stealth', 'Insight'], "Rogue:1:Thieves' Cant (Language)": ['Orc'] }
  });
  assert.deepEqual(leveled.sheetData.expertise.sort(), ['Insight', 'Performance', 'Persuasion', 'Stealth']);
  assert.ok(leveled.sheetData.languages.includes("Thieves' Cant"));

  const reverted = rules.revertLastLevel({ ...state, classes: leveled.classes, sheetData: leveled.sheetData });
  assert.deepEqual(reverted.sheetData.expertise.sort(), ['Performance', 'Persuasion']);
  assert.ok(!reverted.sheetData.languages.includes("Thieves' Cant"));
  assert.ok(!reverted.sheetData.languages.includes('Orc'));
  assert.equal(reverted.sheetData.featureChoices["Rogue:1:Thieves' Cant"], undefined);
  assert.ok(reverted.sheetData.featureChoices['Bard:2:Expertise'], "the Bard's own choices stay");
});

test('characters made before these choices can make them on the sheet', () => {
  const owner = createPlayer();
  const built = rules.buildStartingCharacter(cleric({ featureChoices: { [DIVINE_ORDER]: 'Protector' } }));
  // An older character: no feature choices and no Heavy armor training.
  const sheetData = { ...built.sheetData, armorTraining: ['Light armor', 'Medium armor', 'Shields'], weaponProficiencies: ['Simple weapons'] };
  delete sheetData.featureChoices;
  const id = db.insertStartingCharacter(owner, { ...built, sheetData });
  const asOwner = { id, player_id: owner, is_admin: false };

  assert.deepEqual(db.getMissingFeatureChoices(asOwner).map(feature => feature.id), [DIVINE_ORDER]);
  assert.throws(() => db.chooseMissingFeatures({ ...asOwner, player_id: createPlayer() }), /Forbidden/);
  assert.throws(() => db.chooseMissingFeatures({ ...asOwner, picks: { [DIVINE_ORDER]: 'Sorcerer' } }), /choose Protector or Thaumaturge/);
  assert.deepEqual(db.chooseMissingFeatures({ ...asOwner, picks: { [DIVINE_ORDER]: 'Protector' } }), []);
  const saved = JSON.parse(db.getCharacterById(id).sheet_data);
  assert.ok(saved.armorTraining.includes('Heavy armor'));
  assert.ok(saved.weaponProficiencies.includes('Martial weapons'));
  assert.deepEqual(db.getMissingFeatureChoices(asOwner), []);
});

test('the DM sets max HP outright; it is kept as an adjustment to the rules value', () => {
  const context = { baseHpMax: 24 };
  const vitals = rules.normalizeVitals({ hpCurrent: 20, hpMaxBonus: 0 }, 24);
  const raised = rules.applyVitalsAction(vitals, 'setMaxHp', { total: 30 }, context);
  assert.equal(raised.hpMax, 30);
  assert.equal(raised.vitals.hpMaxBonus, 6);
  assert.equal(raised.vitals.hpCurrent, 26, 'current HP rises with the maximum');
  const lowered = rules.applyVitalsAction(raised.vitals, 'setMaxHp', { total: 18 }, context);
  assert.equal(lowered.hpMax, 18);
  assert.equal(lowered.vitals.hpCurrent, 18, 'and is capped when it falls');
  assert.throws(() => rules.applyVitalsAction(vitals, 'setMaxHp', { total: 0 }, context), /1 to 5000/);
});
