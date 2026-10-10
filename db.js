// db.js — SQLite access for the bot and the admin panel. The database is
// opened and migrated in db/connection.js; each area lives in its own module
// under db/, and this file re-exports them under one object.

'use strict';

const { db } = require('./db/connection');

module.exports = {
  ...require('./db/players'),
  ...require('./db/characters'),
  ...require('./db/adventures'),
  ...require('./db/shop'),
  ...require('./db/analytics'),
  ...require('./db/spells'),
  ...require('./db/magicItems'),
  ...require('./db/inventory'),
  ...require('./db/combat'),
  ...require('./db/roster'),
  ...require('./db/activeAdventures'),
  // Direct database access for scripts (seed, restock, maintenance)
  db,
  prepare: (sql) => db.prepare(sql),
  transaction: (fn) => db.transaction(fn)
};
