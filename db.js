const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    roll_value INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_start)
  );
`);

module.exports = {
  hasRolledThisWeek: (userId, weekStart) => {
    const row = db.prepare('SELECT roll_value FROM rolls WHERE user_id = ? AND week_start = ?').get(userId, weekStart);
    return row || null;
  },
  saveRoll: (userId, weekStart, rollValue) => {
    const stmt = db.prepare('INSERT INTO rolls (user_id, week_start, roll_value) VALUES (?, ?, ?)');
    return stmt.run(userId, weekStart, rollValue);
  }
};