const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

function createRulesCharacter(playerId) {
  const character = rules.buildStartingCharacter({
    name: 'Kael', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Great Weapon Fighting',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  });
  character.sheetData.savingProficiencies.push('wis'); // e.g. from Resilient
  return db.insertStartingCharacter(playerId, character);
}

const stored = id => JSON.parse(db.getCharacterById(id).sheet_data);
const save = (id, playerId, sheetData, extra = {}) => db.updateCharacterSheet({
  id, player_id: playerId, is_admin: false, name: 'Kael', race: 'Human', class_name: 'Fighter', subclass: 'Champion',
  sheet_data: JSON.stringify(sheetData), ...extra
});

test('species, class and subclass cannot be changed from the sheet', () => {
  const player = createPlayer();
  const id = createRulesCharacter(player);
  assert.throws(() => save(id, player, {}, { class_name: 'Wizard', subclass: '' }), /set at creation and by level-ups/);
  assert.throws(() => save(id, player, {}, { race: 'Elf' }), /set at creation and by level-ups/);
  assert.throws(() => save(id, player, {}, { subclass: 'Battle Master' }), /set at creation and by level-ups/);
  assert.equal(db.getCharacterById(id).class, 'Fighter');
});

test('a stale editor cannot drop rule-owned data', () => {
  const player = createPlayer();
  const id = createRulesCharacter(player);
  const before = stored(id);
  save(id, player, {
    abilities: { str: 30, dex: 30, con: 30, int: 30, wis: 30, cha: 30 },
    savingProficiencies: ['str', 'con'],
    skillProficiencies: [],
    background: 'Sage',
    originFeats: [],
    inventory: [],
    languages: ['Common'],
    features: 'My notes',
    equipmentText: 'Edited list'
  });
  const after = stored(id);
  assert.deepEqual(after.abilities, before.abilities);
  assert.deepEqual(after.savingProficiencies, ['str', 'con', 'wis']);
  assert.deepEqual(after.skillProficiencies, before.skillProficiencies);
  assert.equal(after.background, 'Soldier');
  assert.deepEqual(after.originFeats, before.originFeats);
  assert.deepEqual(after.inventory, before.inventory);
  assert.deepEqual(after.languages, before.languages);
  assert.equal(after.features, 'My notes'); // free-form fields still save
  assert.equal(after.equipmentText, 'Edited list');
});

test('a DM may adjust ability scores and skills', () => {
  const player = createPlayer();
  const id = createRulesCharacter(player);
  save(id, player, { abilities: { str: 18, dex: 13, con: 15, int: 8, wis: 12, cha: 10 }, skillProficiencies: ['Stealth'] }, { is_admin: true });
  const after = stored(id);
  assert.equal(after.abilities.str, 18);
  assert.deepEqual(after.skillProficiencies, ['Stealth']);
  assert.equal(after.background, 'Soldier'); // still not replaceable
});

test('older characters keep free editing and can fill in missing data', () => {
  const player = createPlayer();
  db.addCharacter({ player_id: player, name: 'Old Kael', race: 'Human', class_name: 'Fighter', subclass: '', xp: 0 });
  const id = db.prepare("SELECT id FROM characters WHERE name = 'Old Kael'").get().id;
  db.updateCharacterSheet({
    id, player_id: player, is_admin: false, name: 'Old Kael', race: 'Human', class_name: 'Fighter', subclass: 'Champion',
    sheet_data: JSON.stringify({ abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, background: 'Farmer' })
  });
  const character = db.getCharacterById(id);
  assert.equal(character.subclass, 'Champion');
  const sheet = JSON.parse(character.sheet_data);
  assert.equal(sheet.abilities.str, 16);
  assert.equal(sheet.background, 'Farmer');
});
