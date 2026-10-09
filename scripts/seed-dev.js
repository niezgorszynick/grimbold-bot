// scripts/seed-dev.js — Resets a local test database with accounts and
// characters in useful states for trying out the character features.
//
// Usage: npm run seed:dev   (reads .env.dev; DB_PATH must point at a test file)
// Running it again wipes and recreates the test database.

const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH ? path.resolve(__dirname, '..', process.env.DB_PATH) : null;
if (!dbPath || path.basename(dbPath) === 'data.sqlite') {
  console.error('Refusing to seed: set DB_PATH to a test database (e.g. data.dev.sqlite), never data.sqlite.');
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });

const db = require('../db');
const rules = require('../rules');

const PASSWORD = 'test1234';

function addAccount(tag, role) {
  db.addPlayer({ discord_id: `dev-${tag}`, discord_tag: tag });
  const { id } = db.prepare('SELECT id FROM players WHERE discord_tag = ?').get(tag);
  db.setPlayerCredentials(id, PASSWORD, role);
  return id;
}

function addCharacter(playerId, request, adjustSheet) {
  const character = rules.buildStartingCharacter(request);
  if (adjustSheet) adjustSheet(character.sheetData);
  return db.insertStartingCharacter(playerId, character);
}

const alice = addAccount('alice', 'player');
const bob = addAccount('bob', 'player');
const dm = addAccount('dungeonmaster', 'admin');

// Alice: a Fighter who has earned level 4 (ASI or feat waiting).
const thorin = addCharacter(alice, {
  name: 'Thorin Ironfist', species: 'Dwarf', className: 'Fighter', subclass: 'Champion',
  background: 'Soldier', generationMethod: 'Standard Array',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
  classSkills: ['Perception', 'Survival'], backgroundTool: 'Dice', languages: ['Dwarvish', 'Giant'],
  classEquipment: 'A', backgroundEquipment: 'A'
});

// Alice: a wounded Wizard with a spent spell slot and Hit Point Die (try a Short Rest).
addCharacter(alice, {
  name: 'Elara Moonwhisper', species: 'Elf', speciesOption: 'High Elf', speciesSpellAbility: 'int',
  speciesSkills: ['Perception'], className: 'Wizard', subclass: 'Evoker', background: 'Sage',
  generationMethod: 'Point Buy', baseScores: { str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 8 },
  backgroundBonuses: { int: 2, con: 1 }, originFeatChoices: { spellAbility: 'int' },
  classSkills: ['Investigation', 'Medicine'], languages: ['Elvish', 'Draconic'],
  classEquipment: 'A', backgroundEquipment: 'A'
}, sheet => {
  sheet.hpCurrent = 6;
  sheet.hitDiceSpent = { d6: 1 };
  sheet.spellSlotsSpent = [1];
});

// Bob: a Bard with two levels waiting; DEX 15 qualifies for a Rogue multiclass.
const brindle = addCharacter(bob, {
  name: 'Brindle Tealeaf', species: 'Human', size: 'Small', className: 'Bard', subclass: 'College of Lore',
  background: 'Entertainer', backgroundTool: 'Lute', generationMethod: 'Standard Array',
  baseScores: { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 15 }, backgroundBonuses: { cha: 2, dex: 1 },
  originFeatChoices: { picks: ['Flute', 'Drum', 'Horn'] }, versatileFeat: { name: 'Lucky' },
  speciesSkills: ['Insight'], classSkills: ['Deception', 'Persuasion', 'History'],
  classTools: ['Lyre', 'Viol', 'Bagpipes'], languages: ['Halfling', 'Elvish'],
  classEquipment: 'A', backgroundEquipment: 'A', equipmentChoices: { instrument: 'Lyre' }
});

// Bob: a Warlock at 0 HP mid death saves (try Roll Death Save / Heal / Stabilize).
addCharacter(bob, {
  name: 'Vex', species: 'Tiefling', size: 'Medium', speciesOption: 'Infernal', speciesSpellAbility: 'cha',
  className: 'Warlock', subclass: 'Fiend Patron', background: 'Acolyte', generationMethod: 'Standard Array',
  baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }, backgroundBonuses: { cha: 2, wis: 1 },
  originFeatChoices: { spellAbility: 'cha' }, classSkills: ['Arcana', 'Deception'],
  languages: ['Elvish', 'Dwarvish'], classEquipment: 'A', backgroundEquipment: 'B'
}, sheet => {
  sheet.hpCurrent = 0;
  sheet.deathSaves = { successes: 1, failures: 1 };
  sheet.pactSlotsSpent = 2;
});

// Adventure XP: 3 points = level 4, 10 points = level 5 (campaign rule).
db.recordAdventure({ title: 'The Sunken Crypt', description: 'Test adventure', xp_awarded: 3, dm_player_id: dm, dm_character_id: null, character_ids: [thorin] });
db.recordAdventure({ title: 'Goblin Market', description: 'Test adventure', xp_awarded: 10, dm_player_id: dm, dm_character_id: null, character_ids: [brindle] });

console.log(`Seeded ${dbPath}`);
console.log(`Accounts (password "${PASSWORD}"): alice, bob (players), dungeonmaster (DM). Emergency admin: "admin" + ADMIN_PASSWORD.`);
