// db/connection.js — Opens the SQLite database (WAL mode) and brings its
// schema up to date before any other db module prepares statements.

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const { runMigrations } = require('./migrations');

// DB_PATH lets local testing use a separate database file.
const dbPath = process.env.DB_PATH
  ? path.resolve(__dirname, '..', process.env.DB_PATH)
  : path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

runMigrations(db);

// Uploaded files (NPC portraits and statblocks) live next to the database,
// outside the repository. UPLOADS_DIR can point elsewhere.
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(__dirname, '..', process.env.UPLOADS_DIR)
  : path.join(path.dirname(dbPath), 'uploads');

module.exports = { db, uploadsDir };
