const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const paladin = fightingStyle => rules.buildStartingCharacter({
  name: 'Sir Aldo', species: 'Human', size: 'Medium', className: 'Paladin', subclass: 'Oath of Devotion', fightingStyle,
  background: 'Soldier', generationMethod: 'Standard Array',
  baseScores: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 }, backgroundBonuses: { str: 2, con: 1 },
  versatileFeat: { name: 'Alert' }, speciesSkills: ['Perception'], classSkills: ['Insight', 'Religion'],
  backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
});

test('Blessed Warrior: a Paladin learns two Cleric cantrips cast with Charisma', () => {
  assert.throws(() => paladin('Druidic Warrior'), /Choose a Fighting Style/, "the Ranger's option isn't a Paladin's");
  const built = paladin('Blessed Warrior');
  const character = { classes: built.classes, species: 'Human', sheetData: built.sheetData };
  const source = rules.getSpellSources(character).find(item => item.key === 'Blessed Warrior');
  assert.equal(source.list, 'Cleric');
  assert.equal(source.cantripLimit, 2);
  assert.equal(source.ability, 'cha');
  const state = rules.chooseSpells(rules.readSpellcasting(built.sheetData), source, { cantrips: ['Guidance', 'Sacred Flame'] }).state;
  assert.deepEqual(state.feats['Blessed Warrior'].cantrips, ['Guidance', 'Sacred Flame']);
  assert.throws(() => rules.chooseSpells(state, source, { cantrips: ['Guidance', 'Fire Bolt'] }), /not on the Cleric spell list/);

  // One cantrip can be swapped on each Paladin level, not on other classes' levels.
  const onPaladin = rules.onLevelUp(state, [source], 'Paladin');
  assert.equal(onPaladin.changes['Blessed Warrior'].cantripSwaps, 1);
  assert.ok(!(rules.onLevelUp(state, [source], 'Fighter').changes['Blessed Warrior'] || {}).cantripSwaps);

  // Rangers are offered Druidic Warrior at the Fighting Style level.
  const rangerOptions = rules.getLevelUpOptions({
    classes: [{ className: 'Ranger', subclassName: null, level: 1 }], earnedLevel: 2, species: 'Human',
    sheetData: { abilities: { str: { score: 12 }, dex: { score: 15 }, wis: { score: 14 } } }
  }).options.find(option => option.className === 'Ranger');
  assert.ok(rangerOptions.fightingStyles.some(style => style.name === 'Druidic Warrior'));
  assert.ok(!rangerOptions.fightingStyles.some(style => style.name === 'Blessed Warrior'));
});

test('Warrior of Shadow knows Minor Illusion and casts Darkness for a Focus Point', () => {
  const classes = [{ className: 'Monk', subclassName: 'Warrior of Shadow', level: 3 }];
  const sheetData = { abilities: { wis: { score: 16 } } };
  const source = rules.getSpellSources({ classes, species: 'Human', sheetData }).find(item => item.key === 'Shadow Arts');
  assert.deepEqual(source.alwaysPrepared, ['Minor Illusion', 'Darkness']);
  const state = rules.readSpellcasting(sheetData);
  assert.throws(() => rules.castSpell(state, [source], { source: 'Shadow Arts', spell: 'Darkness', slotLevel: 2 }), /without a spell slot/);
  const cast = rules.castSpell(state, [source], { source: 'Shadow Arts', spell: 'Darkness', free: true });
  assert.deepEqual(cast.resourceCost, { key: 'focusPoints', amount: 1, label: '1 Focus Point' });

  const elements = rules.getSpellSources({ classes: [{ className: 'Monk', subclassName: 'Warrior of the Elements', level: 3 }], species: 'Human', sheetData })
    .find(item => item.key === 'Manipulate Elements');
  assert.deepEqual(elements.alwaysPrepared, ['Elementalism']);
});

test("Expertise is changed only by an admin's sheet save", () => {
  const owner = createPlayer();
  const id = db.insertStartingCharacter(owner, paladin('Defense'));
  const save = (isAdmin, extra) => {
    const sheet = { ...JSON.parse(db.getCharacterById(id).sheet_data), ...extra };
    db.updateCharacterSheet({ id, player_id: isAdmin ? 0 : owner, is_admin: isAdmin, sheet_data: JSON.stringify(sheet) });
    return JSON.parse(db.getCharacterById(id).sheet_data);
  };
  assert.deepEqual(save(false, { expertise: ['Athletics'] }).expertise || [], [], 'a player cannot give themselves Expertise');
  assert.deepEqual(save(true, { expertise: ['Athletics'], skillProficiencies: ['Athletics', 'Intimidation', 'Perception', 'Insight', 'Religion', 'Stealth'] }).expertise, ['Athletics']);
  assert.ok(save(false, {}).skillProficiencies.includes('Stealth'), "the DM's extra skill stays");
  const formula = db.rollOptions(db.getCharacterById(id)).get('skill:Athletics').formula;
  assert.equal(formula, '1d20+7', 'STR +3, proficiency +2, Expertise +2');
});

test('casting Darkness through Shadow Arts spends a Focus Point; none left, no cast', () => {
  const owner = createPlayer();
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Kage', 'Human', 'Monk', 'Warrior of Shadow', 3, 3, 'alive', 0, '{"abilities":{"wis":{"score":16},"dex":{"score":16},"con":{"score":12}}}')
  `).run(owner).lastInsertRowid);
  db.prepare("INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary) VALUES (?, 'Monk', 'Warrior of Shadow', 3, 1)").run(id);
  const cast = () => db.castCharacterSpell({ id, player_id: owner, is_admin: false, request: { source: 'Shadow Arts', spell: 'Darkness', free: true } });
  for (let i = 0; i < 3; i += 1) cast();
  assert.equal(JSON.parse(db.getCharacterById(id).sheet_data).resourcesUsed.focusPoints, 3, 'monk level 3: 3 Focus Points');
  assert.throws(cast, /Focus Points: only 0 left/);
});
