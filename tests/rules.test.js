const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');
const { validatePointBuy } = require('../dndData');

const scores = overrides => ({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides });

test('all 16 PHB 2024 backgrounds are complete', () => {
  const names = Object.keys(rules.BACKGROUNDS);
  assert.equal(names.length, 16);
  for (const [name, background] of Object.entries(rules.BACKGROUNDS)) {
    assert.equal(background.abilityBoosts.length, 3, name);
    assert.ok(background.abilityBoosts.every(ability => rules.ABILITIES.includes(ability)), name);
    assert.equal(background.skillProficiencies.length, 2, name);
    assert.ok(rules.ORIGIN_FEATS[background.originFeat.name], `${name} origin feat`);
    assert.ok(background.toolProficiency, name);
    assert.ok(background.equipmentOptions.A.items.length > 0, name);
    assert.deepEqual(background.equipmentOptions.B, { items: [], gp: 50 }, name);
  }
});

test('point buy accepts the new backgrounds', () => {
  const result = validatePointBuy({
    baseScores: { str: 15, dex: 10, con: 14, int: 8, wis: 13, cha: 12 },
    background: 'farmer',
    bonusMode: '2+1',
    bonusAbilities: ['str', 'con']
  });
  assert.equal(result.background, 'Farmer');
  assert.equal(result.abilities.str, 17);
  assert.equal(result.abilities.con, 15);
});

test('every class has 20-level tables and shared milestones', () => {
  for (const [name, classData] of Object.entries(rules.ALL_CLASSES)) {
    assert.ok(classData.featuresByLevel[3].includes(`${name} Subclass`), name);
    for (const level of [4, 8, 12, 16]) {
      assert.ok(classData.featuresByLevel[level].includes('Ability Score Improvement'), `${name} ${level}`);
    }
    assert.ok(classData.featuresByLevel[19].includes('Epic Boon'), name);
    if (classData.spellcasting) {
      assert.equal(classData.spellcasting.cantrips.length, 20, name);
      assert.equal(classData.spellcasting.prepared.length, 20, name);
    }
    for (const table of Object.values(classData.resources)) assert.equal(table.length, 20, name);
    assert.ok(classData.startingEquipment.A, name);
  }
  assert.deepEqual(rules.CLASSES.Fighter.asiLevels, [4, 6, 8, 12, 14, 16]);
  assert.deepEqual(rules.CLASSES.Rogue.asiLevels, [4, 8, 10, 12, 16]);
});

test('max HP uses Hit Die max at level 1 and the fixed average after', () => {
  const fighter = rules.calculateMaxHp({
    classes: [{ className: 'Fighter', level: 3 }],
    constitution: 14
  });
  assert.equal(fighter.max, 28); // 10+2 + 2×(6+2)

  const wizard = rules.calculateMaxHp({ classes: [{ className: 'Wizard', level: 3 }], constitution: 8 });
  assert.equal(wizard.max, 11); // 6-1 + 2×(4-1)
});

test('max HP includes Dwarven Toughness, Tough and Draconic Resilience', () => {
  const base = { classes: [{ className: 'Fighter', level: 3 }], constitution: 14 };
  assert.equal(rules.calculateMaxHp({ ...base, species: 'Dwarf' }).max, 31);
  assert.equal(rules.calculateMaxHp({ ...base, feats: [{ name: 'Tough' }] }).max, 34);
  const sorcerer = rules.calculateMaxHp({
    classes: [{ className: 'Sorcerer', subclassName: 'Draconic Sorcery', level: 3 }],
    constitution: 10
  });
  assert.equal(sorcerer.max, 17); // 6 + 4 + 4 + 3
});

test('multiclass HP only grants the maximum die for the very first level', () => {
  const result = rules.calculateMaxHp({
    classes: [{ className: 'Fighter', level: 3 }, { className: 'Wizard', level: 2 }],
    constitution: 10
  });
  assert.equal(result.max, 30); // 10 + 6 + 6 + 4 + 4
});

test('each level grants at least 1 HP', () => {
  const result = rules.calculateMaxHp({ classes: [{ className: 'Wizard', level: 2 }], constitution: 1 });
  assert.equal(result.max, 2);
});

test('hit dice pool groups by die size', () => {
  const pool = rules.getHitDicePool([
    { className: 'Fighter', level: 3 },
    { className: 'Wizard', level: 2 },
    { className: 'Paladin', level: 1 }
  ]);
  assert.deepEqual(pool, { d10: 4, d6: 2 });
  assert.equal(rules.formatHitDicePool(pool), '4d10 + 2d6');
});

test('spell slots for single-class casters', () => {
  const slots = classes => rules.getSpellSlots(classes).slots;
  assert.deepEqual(slots([{ className: 'Wizard', level: 5 }]), [4, 3, 2]);
  assert.deepEqual(slots([{ className: 'Paladin', level: 1 }]), [2]);
  assert.deepEqual(slots([{ className: 'Paladin', level: 5 }]), [4, 2]);
  assert.deepEqual(slots([{ className: 'Fighter', subclassName: 'Eldritch Knight', level: 2 }]), []);
  assert.deepEqual(slots([{ className: 'Fighter', subclassName: 'Eldritch Knight', level: 3 }]), [2]);
  assert.deepEqual(slots([{ className: 'Fighter', subclassName: 'Eldritch Knight', level: 7 }]), [4, 2]);
  assert.deepEqual(slots([{ className: 'Fighter', level: 7 }]), []);
});

test('multiclass spell slots combine caster levels', () => {
  const result = rules.getSpellSlots([
    { className: 'Wizard', level: 3 },
    { className: 'Paladin', level: 2 }
  ]);
  assert.equal(result.casterLevel, 4);
  assert.deepEqual(result.slots, [4, 3]);

  const knight = rules.getSpellSlots([
    { className: 'Fighter', subclassName: 'Eldritch Knight', level: 4 },
    { className: 'Wizard', level: 1 }
  ]);
  assert.equal(knight.casterLevel, 2);
});

test('pact magic is tracked separately from spell slots', () => {
  assert.deepEqual(rules.getSpellSlots([{ className: 'Warlock', level: 5 }]).pact, { count: 2, slotLevel: 3 });
  const mixed = rules.getSpellSlots([
    { className: 'Warlock', level: 3 },
    { className: 'Sorcerer', level: 2 }
  ]);
  assert.deepEqual(mixed.slots, [3]);
  assert.deepEqual(mixed.pact, { count: 2, slotLevel: 2 });
});

test('level-up plan reports choices for milestones', () => {
  const fighter3 = [{ className: 'Fighter', subclassName: 'Champion', level: 3 }];
  const toFour = rules.planLevelUp({ classes: fighter3, scores: scores({ con: 14 }), newClass: 'Fighter' });
  assert.equal(toFour.classLevel, 4);
  assert.equal(toFour.hpGain, 8);
  assert.ok(toFour.choices.includes('abilityScoreImprovementOrFeat'));

  const wizard2 = [{ className: 'Wizard', subclassName: null, level: 2 }];
  const toThree = rules.planLevelUp({ classes: wizard2, scores: scores(), newClass: 'Wizard' });
  assert.ok(toThree.choices.includes('subclass'));
  assert.ok(toThree.choices.includes('preparedSpells'));
  assert.deepEqual(toThree.spellSlots.slots, [4, 2]);

  const rogue18 = [{ className: 'Rogue', subclassName: 'Thief', level: 18 }];
  const toNineteen = rules.planLevelUp({ classes: rogue18, scores: scores(), newClass: 'Rogue' });
  assert.ok(toNineteen.choices.includes('epicBoon'));
  assert.equal(toNineteen.proficiencyBonus, 6);
});

test('multiclassing enforces 13+ in every primary ability', () => {
  const wizard = [{ className: 'Wizard', subclassName: null, level: 3 }];
  assert.throws(
    () => rules.planLevelUp({ classes: wizard, scores: scores({ int: 15 }), newClass: 'Paladin' }),
    /Paladin/
  );
  const plan = rules.planLevelUp({
    classes: wizard,
    scores: scores({ int: 13, str: 13 }),
    newClass: 'Fighter'
  });
  assert.equal(plan.isNewClass, true);
  assert.ok(plan.choices.includes('multiclassProficiencies'));
  assert.equal(plan.hpGain, 6);
});

test('cannot level past 20', () => {
  assert.throws(
    () => rules.planLevelUp({ classes: [{ className: 'Bard', level: 20 }], scores: scores(), newClass: 'Bard' }),
    /level 20/
  );
});

test('starting at level 3 accumulates spells and the subclass', () => {
  const { classes, steps } = rules.planStartingLevels({
    className: 'Wizard',
    subclassName: 'Evoker',
    targetLevel: 3,
    scores: scores({ int: 16 })
  });
  assert.deepEqual(classes, [{ className: 'Wizard', subclassName: 'Evoker', level: 3 }]);
  const cantrips = steps.reduce((sum, step) => sum + step.spells.cantripsGained, 0);
  const prepared = steps.reduce((sum, step) => sum + step.spells.preparedGained, 0);
  assert.equal(cantrips, 3);
  assert.equal(prepared, 6);
});

test('content markdown parser reads fields, description and sections', () => {
  const entries = rules.parseContentMarkdown([
    '# Spells',
    '',
    '## Fireball',
    '- Level: 3',
    '- Casting Time: Action',
    '',
    'A bright streak flashes.',
    '',
    '### Using a Higher-Level Spell Slot',
    'The damage increases by 1d6.',
    '',
    '## Light',
    '- Level: 0',
    'You touch one object.'
  ].join('\r\n'));
  assert.deepEqual(entries.Fireball.fields, { level: '3', castingTime: 'Action' });
  assert.equal(entries.Fireball.description, 'A bright streak flashes.');
  assert.equal(entries.Fireball.sections['Using a Higher-Level Spell Slot'], 'The damage increases by 1d6.');
  assert.equal(entries.Light.description, 'You touch one object.');
  assert.deepEqual(rules.loadContent('spells'), {});
});
