// db/proficiencies.js — What a character is trained or proficient with, beyond
// skills and saves: armor, weapons, tools and languages. Everyone who can see
// the sheet reads them; a DM can correct them (e.g. for older characters or
// house rules). Creation, level-ups and class choices fill them in otherwise.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');

const LISTS = {
  armor: 'armorTraining',
  weapons: 'weaponProficiencies',
  tools: 'toolProficiencies',
  languages: 'languages'
};
const MAX_ENTRIES = 40;
const MAX_LENGTH = 60;

function loadCharacter(id, playerId, isAdmin) {
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(id));
  if (!character) throw new Error('Character not found.');
  if (!isAdmin && character.player_id !== Number(playerId)) throw new Error('Forbidden.');
  return character;
}

function readSheet(json) {
  try {
    const data = JSON.parse(json || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function classRows(characterId) {
  return db.prepare('SELECT class_name, subclass_name, class_level FROM character_classes WHERE character_id = ? ORDER BY is_primary DESC, id')
    .all(characterId).map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }));
}

function view(character, sheetData, isAdmin) {
  const training = rules.characterTraining(classRows(character.id), sheetData);
  const list = value => (Array.isArray(value) ? value : []);
  return {
    armor: training.armor,
    weapons: training.weapons,
    tools: list(sheetData.toolProficiencies),
    languages: list(sheetData.languages),
    canEdit: Boolean(isAdmin)
  };
}

function getCharacterProficiencies({ id, player_id, is_admin }) {
  const character = loadCharacter(id, player_id, is_admin);
  return view(character, readSheet(character.sheet_data), is_admin);
}

// lists: { armor, weapons, tools, languages } — each an array of names (DMs only).
function setCharacterProficiencies({ id, player_id, is_admin, lists }) {
  if (!is_admin) throw new Error('Only a DM can change proficiencies by hand.');
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    const next = { ...sheetData };
    for (const [key, sheetKey] of Object.entries(LISTS)) {
      if (!lists || lists[key] === undefined) continue;
      if (!Array.isArray(lists[key])) throw new Error(`${key} must be a list.`);
      const names = [...new Set(lists[key].map(name => String(name).trim()).filter(Boolean))];
      if (names.length > MAX_ENTRIES) throw new Error(`At most ${MAX_ENTRIES} ${key}.`);
      const tooLong = names.find(name => name.length > MAX_LENGTH);
      if (tooLong) throw new Error(`"${tooLong.slice(0, 20)}…" is too long (${MAX_LENGTH} characters at most).`);
      next[sheetKey] = names;
    }
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(next), character.id);
    return view(character, next, is_admin);
  })();
}

module.exports = { getCharacterProficiencies, setCharacterProficiencies };
