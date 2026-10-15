const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

function addCharacter(owner, { race = 'Human', className = 'Fighter', subclass = 'Champion', level = 3, sheet = {} } = {}) {
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Test', ?, ?, ?, ?, 0, 'alive', 0, ?)
  `).run(owner, race, className, subclass, level, JSON.stringify(sheet)).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary) VALUES (?, ?, ?, ?, 1)')
    .run(id, className, subclass, level);
  return id;
}

test('armor, weapons, tools and languages: everyone sees them, DMs can correct them', () => {
  const owner = createPlayer();
  const id = addCharacter(owner, { sheet: { toolProficiencies: ['Dice'], languages: ['Common', 'Dwarvish'] } });
  const asOwner = { id, player_id: owner, is_admin: false };
  const seen = db.getCharacterProficiencies(asOwner);
  assert.deepEqual(seen.armor, ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'], "an older sheet falls back to the class's training");
  assert.deepEqual(seen.tools, ['Dice']);
  assert.deepEqual(seen.languages, ['Common', 'Dwarvish']);
  assert.equal(seen.canEdit, false);

  assert.throws(() => db.setCharacterProficiencies({ ...asOwner, lists: { languages: ['Draconic'] } }), /Only a DM/);
  const edited = db.setCharacterProficiencies({ id, player_id: 0, is_admin: true, lists: { languages: ['Common', 'Dwarvish', 'Draconic', 'Draconic'], tools: ["Thieves' Tools"] } });
  assert.deepEqual(edited.languages, ['Common', 'Dwarvish', 'Draconic']);
  assert.deepEqual(db.getCharacterProficiencies(asOwner).tools, ["Thieves' Tools"]);
});

test('an older character without a lineage gets asked for one, and its spells follow', () => {
  const owner = createPlayer();
  const id = addCharacter(owner, { race: 'Elf', sheet: { abilities: { int: { score: 14 } } } });
  const asOwner = { id, player_id: owner, is_admin: false };
  assert.deepEqual(db.getMissingSpeciesChoice(asOwner), {
    species: 'Elf', label: 'Elven Lineage', options: ['Drow', 'High Elf', 'Wood Elf'], current: null, spellAbilityChoice: true
  });
  assert.throws(() => db.chooseSpeciesOption({ ...asOwner, choice: { option: 'Moon Elf', spellAbility: 'int' } }), /Elven Lineage/);
  assert.throws(() => db.chooseSpeciesOption({ ...asOwner, choice: { option: 'High Elf' } }), /Intelligence, Wisdom or Charisma/);
  db.chooseSpeciesOption({ ...asOwner, choice: { option: 'High Elf', spellAbility: 'int' } });
  assert.equal(db.getMissingSpeciesChoice(asOwner), null);
  const sheetData = JSON.parse(db.getCharacterById(id).sheet_data);
  const sources = rules.getSpellSources({ classes: [{ className: 'Fighter', subclassName: 'Champion', level: 3 }], species: 'Elf', sheetData });
  assert.ok(sources.some(source => source.key === 'Elf:High Elf'), 'High Elf spells now load');
  assert.equal(db.getMissingSpeciesChoice({ id: addCharacter(owner), player_id: owner, is_admin: false }), null, 'Humans have nothing to choose');
});

test('Circle of the Land: a new land after a Long Rest', () => {
  const owner = createPlayer();
  const id = addCharacter(owner, { race: 'Human', className: 'Druid', subclass: 'Circle of the Land', level: 3, sheet: { abilities: { wis: { score: 16 } } } });
  const asOwner = { id, player_id: owner, is_admin: false };
  const druidSource = result => result.spells.sources.find(source => source.key === 'Druid');

  let result = db.setCharacterLand({ ...asOwner, land: 'Polar' });
  assert.equal(druidSource(result).land.current, 'Polar', 'the first choice is free');
  assert.ok(druidSource(result).prepared.includes('Hold Person'));
  assert.throws(() => db.setCharacterLand({ ...asOwner, land: 'Arid' }), /after a Long Rest/);

  // After a Long Rest the spell change window is open: the land can change too.
  const sheet = JSON.parse(db.getCharacterById(id).sheet_data);
  sheet.spellcasting = { ...rules.readSpellcasting(sheet), changes: { Druid: { rework: true } } };
  db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(sheet), id);
  result = db.setCharacterLand({ ...asOwner, land: 'Arid' });
  assert.ok(druidSource(result).prepared.includes('Blur'));
  assert.ok(!druidSource(result).prepared.includes('Hold Person'));
  assert.throws(() => db.setCharacterLand({ ...asOwner, land: 'Underdark' }), /Choose a land/);
});

test("a background's Origin feat can be swapped for another at creation", () => {
  const request = {
    name: 'Kael', species: 'Dwarf', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Defense',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
    classSkills: ['Perception', 'Survival'], backgroundTool: 'Dice', languages: ['Elvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  };
  assert.equal(rules.buildStartingCharacter(request).sheetData.originFeats[0].name, 'Savage Attacker', "the background's own feat");
  const alert = rules.buildStartingCharacter({ ...request, backgroundFeat: 'Alert' });
  assert.deepEqual(alert.sheetData.originFeats.map(feat => [feat.name, feat.source]), [['Alert', 'Soldier background']]);
  assert.throws(() => rules.buildStartingCharacter({ ...request, backgroundFeat: 'Great Weapon Master' }), /not an Origin feat/);
});
