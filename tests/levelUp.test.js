const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

// A level 3 Human Fighter (Champion) straight from character creation.
function fighter(earnedLevel, overrides = {}) {
  const created = rules.buildStartingCharacter({
    name: 'Brakka', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 },
    backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Tough' }, speciesSkills: ['Perception'],
    classSkills: ['Acrobatics', 'Survival'], backgroundTool: 'Dice',
    languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A',
    ...overrides
  });
  return { classes: created.classes, earnedLevel, species: created.species, sheetData: created.sheetData };
}

test('no options when no level is pending', () => {
  assert.equal(rules.getLevelUpOptions(fighter(3)).pendingLevels, 0);
  assert.throws(() => rules.applyLevelUp(fighter(3), { className: 'Fighter' }), /No level-up available/);
});

test('options list classes, with multiclass prerequisites enforced', () => {
  const options = rules.getLevelUpOptions(fighter(4));
  assert.equal(options.pendingLevels, 1);
  const own = options.options.find(option => option.className === 'Fighter');
  assert.equal(own.classLevel, 4);
  assert.ok(own.choices.includes('abilityScoreImprovementOrFeat'));
  assert.ok(own.feats.find(feat => feat.name === 'Great Weapon Master').unavailable === null);
  assert.equal(own.feats.find(feat => feat.name === 'Tough').unavailable, 'Already taken.');
  assert.ok(own.feats.find(feat => feat.name === 'War Caster').unavailable.includes('Spellcasting'));
  assert.ok(!own.feats.some(feat => feat.kind === 'epicBoon'));
  // INT 12 blocks Wizard; CHA 8 blocks Paladin.
  assert.ok(options.unavailable.some(item => item.className === 'Wizard'));
  assert.ok(options.unavailable.some(item => item.className === 'Paladin'));
  assert.ok(options.options.some(option => option.className === 'Barbarian' && option.isNewClass));
});

test('ASI raises scores, HP follows CON, history is recorded', () => {
  const state = fighter(4);
  const before = state.sheetData.hpMax;
  const { classes, sheetData, entry } = rules.applyLevelUp(state, {
    className: 'Fighter',
    improvement: { type: 'asi', increases: { str: 1, con: 1 } }
  });
  assert.deepEqual(classes, [{ className: 'Fighter', subclassName: 'Champion', level: 4 }]);
  assert.equal(sheetData.abilities.str.score, 18);
  assert.equal(sheetData.abilities.con.score, 16);
  // +6 avg +3 CON +2 Tough for the new level, +1 retroactively for levels 1-3 (CON 15 → 16).
  assert.equal(entry.hpGain, 6 + 3 + 2 + 3);
  assert.equal(sheetData.hpCurrent, before + entry.hpGain);
  assert.equal(sheetData.hitDice, '4d10');
  assert.equal(sheetData.levelHistory.length, 1);
});

test('ASI validation', () => {
  const state = fighter(4);
  const apply = increases => rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'asi', increases } });
  assert.throws(() => apply({ str: 1 }), /\+2 to one ability or \+1 to two/);
  assert.throws(() => apply({ str: 2, con: 1 }), /\+2 to one ability or \+1 to two/);
  assert.throws(() => apply({ str: 3 }), /\+2 to one ability or \+1 to two/);
  // Rolled STR 18 + background +1 = 19, so +2 would exceed 20.
  assert.throws(() => rules.applyLevelUp(fighter(4, { generationMethod: 'Manual/Rolled', baseScores: { str: 18, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }, backgroundBonuses: { str: 1, dex: 1, con: 1 } }),
    { className: 'Fighter', improvement: { type: 'asi', increases: { str: 2 } } }), /cannot go above 20/);
  assert.throws(() => rules.applyLevelUp(state, { className: 'Fighter' }), /Ability Score Improvement or a feat/);
});

test('feats: ability increase, Resilient save, ineligible feats', () => {
  const state = fighter(4);
  const gwm = rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Great Weapon Master', ability: 'str' } });
  assert.equal(gwm.sheetData.abilities.str.score, 18);
  assert.equal(gwm.entry.feat.name, 'Great Weapon Master');

  const resilient = rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Resilient', ability: 'wis' } });
  assert.ok(resilient.sheetData.savingProficiencies.includes('wis'));
  assert.throws(
    () => rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Resilient', ability: 'con' } }),
    /already have CON saving throw/
  );
  assert.throws(
    () => rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Keen Mind', ability: 'int' } }),
    /INT 13\+/
  );
  assert.throws(
    () => rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Boon of Fate' } }),
    /Epic Boon feature/
  );
});

test('multiclassing adds proficiencies and a level 1 class row', () => {
  const state = fighter(4, { baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, dex: 1 } });
  assert.throws(() => rules.applyLevelUp(state, { className: 'Rogue' }), /Rogue skill/);
  const { classes, sheetData, entry } = rules.applyLevelUp(state, { className: 'Rogue', multiclassSkills: ['Stealth'] });
  assert.deepEqual(classes.map(row => [row.className, row.level]), [['Fighter', 3], ['Rogue', 1]]);
  assert.ok(sheetData.skillProficiencies.includes('Stealth'));
  assert.ok(sheetData.toolProficiencies.includes("Thieves' Tools"));
  assert.equal(entry.hpGain, 5 + 1 + 2); // d8 average + CON +1 (14) + Tough
  assert.equal(sheetData.hitDice, '3d10 + 1d8');
});

test('subclass is chosen at class level 3 of a new class', () => {
  let state = fighter(6, { baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, dex: 1 } });
  state = { ...state, ...rules.applyLevelUp(state, { className: 'Rogue', multiclassSkills: ['Stealth'] }) };
  state = { ...state, ...rules.applyLevelUp(state, { className: 'Rogue' }) };
  assert.throws(() => rules.applyLevelUp(state, { className: 'Rogue' }), /Rogue subclass/);
  const result = rules.applyLevelUp(state, { className: 'Rogue', subclass: 'Arcane Trickster' });
  assert.equal(result.classes[1].subclassName, 'Arcane Trickster');
  assert.equal(result.sheetData.pendingChoices.cantrips, 3);
  assert.deepEqual(result.sheetData.spellSlots.slots, [2]); // only spellcaster: Arcane Trickster table at level 3
});

test('spellcasters accumulate spells to choose', () => {
  const wizard = rules.buildStartingCharacter({
    name: 'Ilse', species: 'Elf', speciesOption: 'High Elf', speciesSpellAbility: 'int', speciesSkills: ['Perception'],
    className: 'Wizard', subclass: 'Evoker', background: 'Sage', generationMethod: 'Standard Array',
    baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, backgroundBonuses: { int: 2, con: 1 },
    originFeatChoices: { spellAbility: 'int' }, classSkills: ['Investigation', 'Medicine'],
    languages: ['Elvish', 'Draconic'], classEquipment: 'B', backgroundEquipment: 'B'
  });
  const state = { classes: wizard.classes, earnedLevel: 4, species: 'Elf', sheetData: wizard.sheetData };
  const result = rules.applyLevelUp(state, { className: 'Wizard', improvement: { type: 'feat', name: 'War Caster', ability: 'int' } });
  assert.deepEqual(result.sheetData.pendingChoices, { cantrips: 4, preparedSpells: 7 });
  assert.deepEqual(result.sheetData.spellSlots.slots, [4, 3]);
});

test('reverting the last level restores the previous state exactly', () => {
  const state = fighter(5, { baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, dex: 1 } });
  const four = rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Resilient', ability: 'wis' } });
  const five = rules.applyLevelUp({ ...state, ...four }, { className: 'Rogue', multiclassSkills: ['Stealth'] });

  const backToFour = rules.revertLastLevel({ ...state, ...five });
  assert.deepEqual(backToFour.classes, four.classes);
  assert.deepEqual(backToFour.sheetData.skillProficiencies, four.sheetData.skillProficiencies);
  assert.deepEqual(backToFour.sheetData.toolProficiencies, four.sheetData.toolProficiencies);

  const backToThree = rules.revertLastLevel({ ...state, ...backToFour });
  assert.deepEqual(backToThree.sheetData.abilities, state.sheetData.abilities);
  assert.deepEqual(backToThree.sheetData.savingProficiencies, state.sheetData.savingProficiencies);
  assert.deepEqual(backToThree.sheetData.levelHistory, []);
  assert.equal(rules.revertLastLevel({ ...state, ...backToThree }), null);
});

test('Epic Boon at level 19 allows boons and scores up to 30', () => {
  const state = {
    classes: [{ className: 'Fighter', subclassName: 'Champion', level: 18 }],
    earnedLevel: 19,
    species: 'Human',
    sheetData: { abilities: { str: 20, dex: 14, con: 16, int: 8, wis: 12, cha: 10 } }
  };
  const result = rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Boon of Fortitude', ability: 'str' } });
  assert.equal(result.sheetData.abilities.str.score, 21);
  assert.equal(result.entry.hpGain, 6 + 3 + 40);
});
