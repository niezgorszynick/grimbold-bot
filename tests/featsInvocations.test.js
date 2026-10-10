const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

const baseFighter = overrides => ({
  name: 'Mara', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion',
  background: 'Soldier', generationMethod: 'Standard Array',
  baseScores: { str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }, backgroundBonuses: { str: 2, con: 1 },
  versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
  backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A',
  fightingStyle: 'Great Weapon Fighting',
  ...overrides
});

test('feat data matches the 2024 rules', () => {
  const options = rules.getLevelUpOptions({
    classes: [{ className: 'Wizard', subclassName: 'Evoker', level: 3 }], earnedLevel: 4, species: 'Human',
    sheetData: { abilities: { str: 8, dex: 8, con: 8, int: 15, wis: 8, cha: 8 } }
  });
  const feats = options.options.find(option => option.className === 'Wizard').feats;
  const byName = name => feats.find(feat => feat.name === name);
  // No ability-score prerequisite for Crusher, Piercer and Slasher.
  ['Crusher', 'Piercer', 'Slasher'].forEach(name => assert.equal(byName(name).unavailable, null, name));
  assert.ok(byName('Fey-Touched'));
  assert.equal(byName('Archery').unavailable, 'Requires the Fighting Style feature.');
  assert.deepEqual(byName('Keen Mind').skillChoice, ['Arcana', 'History', 'Investigation', 'Nature', 'Religion']);
});

test('Epic Boons use their own ability options', () => {
  const state = {
    classes: [{ className: 'Fighter', subclassName: 'Champion', level: 18 }], earnedLevel: 19, species: 'Human',
    sheetData: { abilities: { str: 20, dex: 14, con: 16, int: 8, wis: 12, cha: 10 }, fightingStyles: [{ name: 'Defense' }] }
  };
  assert.throws(() => rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Boon of Irresistible Offense', ability: 'con' } }), /STR, DEX/);
  assert.throws(() => rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Boon of Spell Recall', ability: 'int' } }), /Spellcasting/);
  assert.equal(rules.applyLevelUp(state, { className: 'Fighter', improvement: { type: 'feat', name: 'Boon of Irresistible Offense', ability: 'str' } }).sheetData.abilities.str.score, 21);
});

test('Fighting Style: required at creation, Defense adds AC in armor', () => {
  assert.throws(() => rules.buildStartingCharacter(baseFighter({ fightingStyle: undefined })), /Fighting Style/);
  const defense = rules.buildStartingCharacter(baseFighter({ fightingStyle: 'Defense' }));
  assert.equal(defense.sheetData.armorClass, 17); // Chain Mail 16 + 1
  assert.deepEqual(defense.sheetData.fightingStyles, [{ name: 'Defense', source: 'Fighter' }]);
  const wizard = rules.buildStartingCharacter(baseFighter({
    className: 'Wizard', subclass: 'Evoker', classSkills: ['Investigation', 'Medicine'], fightingStyle: undefined,
    background: 'Sage', backgroundBonuses: { int: 2, con: 1 }, backgroundTool: undefined, originFeatChoices: { spellAbility: 'int' }
  }));
  assert.equal(wizard.sheetData.fightingStyles.length, 0);
});

test('Fighting Style at a Paladin level 2 and as a feat', () => {
  const paladin1 = {
    classes: [{ className: 'Fighter', subclassName: 'Champion', level: 3 }, { className: 'Paladin', level: 1 }], earnedLevel: 5, species: 'Human',
    sheetData: { abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 14 }, fightingStyles: [{ name: 'Defense' }] }
  };
  assert.throws(() => rules.applyLevelUp(paladin1, { className: 'Paladin' }), /Choose a Fighting Style/);
  assert.throws(() => rules.applyLevelUp(paladin1, { className: 'Paladin', fightingStyle: 'Defense' }), /already have the Defense/);
  const result = rules.applyLevelUp(paladin1, { className: 'Paladin', fightingStyle: 'Dueling' });
  assert.deepEqual(result.entry.fightingStyle, { name: 'Dueling' });
  assert.ok(rules.collectCharacterFeats(result.sheetData).some(feat => feat.name === 'Dueling'));
});

test('Keen Mind, Skill Expert and Chef grant skills, Expertise and tools', () => {
  const state = {
    classes: [{ className: 'Wizard', subclassName: 'Evoker', level: 3 }], earnedLevel: 4, species: 'Human',
    sheetData: { abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, skillProficiencies: ['Arcana', 'History'], toolProficiencies: [] }
  };
  const keen = feat => rules.applyLevelUp(state, { className: 'Wizard', improvement: { type: 'feat', name: 'Keen Mind', ability: 'int', ...feat } });
  assert.ok(keen({ skill: 'Nature' }).sheetData.skillProficiencies.includes('Nature'));
  assert.deepEqual(keen({ skill: 'Arcana' }).sheetData.expertise, ['Arcana']);
  assert.throws(() => keen({ skill: 'Stealth' }), /Choose a skill for Keen Mind/);

  const expert = rules.applyLevelUp(state, { className: 'Wizard', improvement: { type: 'feat', name: 'Skill Expert', ability: 'int', skills: ['Stealth'], expertise: ['Stealth'] } });
  assert.ok(expert.sheetData.skillProficiencies.includes('Stealth'));
  assert.deepEqual(expert.sheetData.expertise, ['Stealth']);
  const reverted = rules.revertLastLevel({ ...state, ...expert });
  assert.deepEqual(reverted.sheetData.expertise, []);

  const chef = rules.applyLevelUp(state, { className: 'Wizard', improvement: { type: 'feat', name: 'Chef', ability: 'con' } });
  assert.ok(chef.sheetData.toolProficiencies.includes("Cook's Utensils"));
});

test('spell-granting feats become spell sources', () => {
  const sheetData = {
    abilities: { int: { score: 16 }, wis: { score: 10 }, cha: { score: 10 } },
    levelHistory: [{ feat: { name: 'Fey-Touched', ability: 'int' } }, { feat: { name: 'Ritual Caster', ability: 'int' } }]
  };
  const sources = rules.getSpellSources({ classes: [{ className: 'Fighter', subclassName: 'Champion', level: 8 }], species: 'Human', sheetData });
  const fey = sources.find(source => source.key === 'Fey-Touched');
  assert.deepEqual(rules.listOf(rules.readSpellcasting({}), fey).prepared, ['Misty Step']);
  assert.throws(() => rules.chooseSpells(rules.readSpellcasting({}), fey, { prepared: ['Magic Missile'] }), /Divination or Enchantment/);
  let { state } = rules.chooseSpells(rules.readSpellcasting({}), fey, { prepared: ['Charm Person'] });
  assert.deepEqual(rules.listOf(state, fey).prepared, ['Misty Step', 'Charm Person']);
  state = rules.castSpell(state, sources, { source: 'Fey-Touched', spell: 'Misty Step', free: true }).state;
  assert.throws(() => rules.castSpell(state, sources, { source: 'Fey-Touched', spell: 'Misty Step', free: true }), /Long Rest/);
  assert.doesNotThrow(() => rules.castSpell(state, sources, { source: 'Fey-Touched', spell: 'Charm Person', free: true }));
  assert.throws(() => rules.chooseSpells(state, fey, { prepared: ['Sleep'] }), /never once chosen/);

  const ritual = sources.find(source => source.key === 'Ritual Caster');
  assert.equal(ritual.preparedLimit, 3); // proficiency bonus at level 8
  assert.throws(() => rules.chooseSpells(rules.readSpellcasting({}), ritual, { prepared: ['Magic Missile'] }), /Ritual tag/);
  assert.doesNotThrow(() => rules.chooseSpells(rules.readSpellcasting({}), ritual, { prepared: ['Detect Magic', 'Find Familiar', 'Comprehend Languages'] }));
});

const warlock = (level, extra = {}) => ({
  classes: [{ className: 'Warlock', subclassName: level >= 3 ? 'Fiend Patron' : null, level }],
  species: 'Human',
  sheetData: { abilities: { cha: { score: 16 } }, spellcasting: { classes: { Warlock: { cantrips: ['Eldritch Blast'], prepared: [] } } }, ...extra }
});
const resolveFeat = (request, sheet) => rules.resolveOriginFeatChoice(request, { ...sheet, invocations: [] });

test('invocations: limits, prerequisites and repeatable choices', () => {
  assert.equal(rules.invocationLimit(warlock(1).classes), 1);
  assert.equal(rules.invocationLimit(warlock(5).classes), 5);
  const choose = (character, choices) => rules.chooseInvocations(character, choices, { resolveFeat });
  assert.throws(() => choose(warlock(1), [{ name: "Devil's Sight" }]), /Warlock level 2/);
  assert.throws(() => choose(warlock(5), [{ name: 'Thirsting Blade' }]), /Requires Pact of the Blade/);
  assert.throws(() => choose(warlock(1), [{ name: 'Armor of Shadows' }, { name: 'Eldritch Mind' }]), /at most 1/);
  assert.throws(() => choose(warlock(3), [{ name: 'Agonizing Blast' }]), /Choose which cantrip/);
  const noCantrip = warlock(3, { spellcasting: { classes: { Warlock: { cantrips: ['Prestidigitation'] } } } });
  assert.throws(() => choose(noCantrip, [{ name: 'Agonizing Blast', cantrip: 'Prestidigitation' }]), /cantrip that deals damage/);
  const sheet = choose(warlock(5), [
    { name: 'Pact of the Blade' }, { name: 'Thirsting Blade' }, { name: 'Agonizing Blast', cantrip: 'Eldritch Blast' },
    { name: 'Armor of Shadows' }, { name: 'Lessons of the First Ones', feat: { name: 'Tough' } }
  ]);
  assert.equal(sheet.invocations.length, 5);
  assert.ok(rules.collectCharacterFeats(sheet).some(feat => feat.name === 'Tough'));
  assert.throws(() => choose(warlock(5), [{ name: 'Agonizing Blast', cantrip: 'Eldritch Blast' }, { name: 'Agonizing Blast', cantrip: 'Eldritch Blast' }]), /different cantrip/);
});

test('invocations: strict replacement, at-will spells and the Book of Shadows', () => {
  const choose = (character, choices) => rules.chooseInvocations(character, choices, { resolveFeat });
  let character = warlock(3);
  character.sheetData = choose(character, [{ name: 'Armor of Shadows' }, { name: 'Pact of the Tome' }, { name: 'Eldritch Mind' }]);
  assert.throws(() => choose(character, [{ name: 'Armor of Shadows' }, { name: 'Pact of the Tome' }, { name: "Devil's Sight" }]), /when you gain a Warlock level/);

  const sources = rules.getSpellSources(character);
  const invocationSource = sources.find(source => source.key === 'Invocation Spells');
  let state = rules.readSpellcasting(character.sheetData);
  for (let i = 0; i < 3; i += 1) state = rules.castSpell(state, sources, { source: invocationSource.key, spell: 'Mage Armor', free: true }).state;
  assert.deepEqual(rules.castSpell(state, sources, { source: invocationSource.key, spell: 'Mage Armor', free: true }).events, ['atWill']);
  assert.throws(() => rules.castSpell(state, sources, { source: invocationSource.key, spell: 'Mage Armor', slotLevel: 1 }), /without a spell slot/);

  const tome = sources.find(source => source.key === 'Pact of the Tome');
  assert.throws(() => rules.chooseSpells(state, tome, { prepared: ['Magic Missile'] }), /Ritual tag/);
  state = rules.chooseSpells(state, tome, { cantrips: ['Guidance', 'Sacred Flame', 'Druidcraft'], prepared: ['Detect Magic', 'Find Familiar'] }).state;
  assert.throws(() => rules.chooseSpells(state, tome, { prepared: ['Comprehend Languages', 'Find Familiar'] }), /Short or Long Rest/);
  state = rules.onShortRest(state, sources);
  assert.doesNotThrow(() => rules.chooseSpells(state, tome, { prepared: ['Comprehend Languages', 'Find Familiar'] }));

  // A Warlock level allows one replacement.
  character = { ...character, sheetData: { ...character.sheetData, spellcasting: rules.onLevelUp(rules.readSpellcasting(character.sheetData), sources, 'Warlock') } };
  const levelledView = rules.buildSpellsView(character, rules.readSpellcasting(character.sheetData));
  assert.equal(levelledView.invocations.allowance.swaps, 1);
  assert.equal(levelledView.sources.find(source => source.key === 'Invocation Spells').allowance.swaps, 0);
  const swapped = choose(character, [{ name: 'Armor of Shadows' }, { name: 'Pact of the Tome' }, { name: "Devil's Sight" }]);
  assert.ok(swapped.invocations.some(entry => entry.name === "Devil's Sight"));
});
