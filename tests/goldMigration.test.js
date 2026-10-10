// Checks that an existing database with fractional gold_gp values is moved to
// whole copper pieces when the new code starts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { db: firstConnection, createPlayer } = require('./helpers/tempDatabase');

test('gold_gp values are converted to gold_cp on startup', () => {
  // Turn the fresh database back into an older one: no gold_cp, no triggers, and
  // no migrations recorded (user_version 0), like a database from before migrations.
  const player = createPlayer();
  firstConnection.db.exec(`
    DROP TRIGGER characters_gold_mirror_insert;
    DROP TRIGGER characters_gold_mirror_update;
    ALTER TABLE characters DROP COLUMN gold_cp;
    PRAGMA user_version = 0;
  `);
  firstConnection.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_gp)
    VALUES (?, 'Old Timer', 'Human', 'Fighter', '', 3, 0, 'alive', 12.37), (?, 'Broke', 'Human', 'Fighter', '', 3, 0, 'alive', 0)
  `).run(player, player);
  firstConnection.db.close();

  // Starting the app again runs the migration.
  for (const file of Object.keys(require.cache)) {
    if (file === path.resolve(__dirname, '../db.js') || file.startsWith(path.resolve(__dirname, '../db') + path.sep)) delete require.cache[file];
  }
  const db = require('../db');
  assert.equal(db.db.pragma('user_version', { simple: true }), 3);
  const rows = db.prepare('SELECT name, gold_cp, gold_gp FROM characters ORDER BY name').all();
  assert.deepEqual(rows.map(row => [row.name, row.gold_cp]), [['Broke', 0], ['Old Timer', 1237]]);

  db.prepare("UPDATE characters SET gold_cp = 5 WHERE name = 'Old Timer'").run();
  assert.equal(db.prepare("SELECT gold_gp FROM characters WHERE name = 'Old Timer'").get().gold_gp, 0.05);
  db.db.close();
});
