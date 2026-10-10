// tests/helpers/tempDatabase.js — Points db.js at a fresh temporary database.
//
// Require this before anything that loads ../../db. node --test runs each test
// file in its own process, so every file gets its own empty database.

const fs = require('fs');
const os = require('os');
const path = require('path');

const file = path.join(os.tmpdir(), `grimbold-test-${process.pid}-${Date.now()}.sqlite`);
process.env.DB_PATH = file;

const db = require('../../db');

// Windows cannot delete an open database file, so close it first.
process.on('exit', () => {
  db.db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
});

let accounts = 0;
// Creates a player who can log in, and returns their id.
function createPlayer(role = 'player') {
  accounts += 1;
  db.addPlayer({ discord_id: `test-${accounts}`, discord_tag: `tester${accounts}` });
  const { id } = db.prepare('SELECT id FROM players WHERE discord_id = ?').get(`test-${accounts}`);
  db.setPlayerCredentials(id, 'test1234', role);
  return id;
}

module.exports = { db, file, createPlayer };
