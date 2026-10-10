// db/migrations.js — Numbered schema migrations, tracked with SQLite's
// user_version. Each runs once, in order, inside a transaction.
//
// Versions 1–3 describe the schema as it grew before migrations were tracked,
// so they check what already exists; a database created by any earlier version
// of the bot starts at user_version 0 and runs them safely. New migrations
// can assume the previous version and simply append to the list.

'use strict';

const MIGRATIONS = [
  {
    version: 1,
    name: 'Base schema: rolls, items, sales, catalog, players, characters, classes, adventures',
    up(db) {
      // 1. Weekly d20 rolls
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
      // Add the rolls.username column if it does not exist yet
      const rollsColumns = db.prepare("PRAGMA table_info(rolls)").all();
      if (!rollsColumns.some(col => col.name === 'username')) {
        db.exec("ALTER TABLE rolls ADD COLUMN username TEXT;");
      }
      // 2. Shop items (current stock on the counter)
      db.exec(`
        CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          stock INTEGER DEFAULT NULL CHECK (stock IS NULL OR stock >= 0),
          description TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      // 3. Sales history (replaces the old Sales spreadsheet)
      db.exec(`
        CREATE TABLE IF NOT EXISTS sales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_name TEXT NOT NULL,
          category TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          buyer_tag TEXT NOT NULL,
          buyer_id TEXT NOT NULL,
          base_price INTEGER NOT NULL,
          discount_percent INTEGER NOT NULL,
          final_price INTEGER NOT NULL,
          total_paid INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      // 4. Master item catalog
      db.exec(`
        CREATE TABLE IF NOT EXISTS catalog (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          category TEXT NOT NULL,
          tier TEXT NOT NULL CHECK (tier IN ('staple', 'common', 'rare', 'magic', 'service')),
          base_price_cp INTEGER NOT NULL CHECK (base_price_cp >= 0),
          description TEXT NOT NULL,
          min_level INTEGER NOT NULL DEFAULT 1,
          min_stock INTEGER NOT NULL DEFAULT 1,
          max_stock INTEGER NOT NULL DEFAULT 3
        );

        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        INSERT OR IGNORE INTO config (key, value) VALUES ('party_level', '3');
      `);
      // 5. Players and their characters
      db.exec(`
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id TEXT NOT NULL UNIQUE,
          discord_tag TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS characters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          class TEXT NOT NULL,
          level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 20),
          status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'dead')),
          sheet_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
        );
      `);
      const playerColumns = db.prepare('PRAGMA table_info(players)').all();
      if (!playerColumns.some(column => column.name === 'password_hash')) {
        db.exec('ALTER TABLE players ADD COLUMN password_hash TEXT;');
      }
      if (!playerColumns.some(column => column.name === 'role')) {
        db.exec("ALTER TABLE players ADD COLUMN role TEXT NOT NULL DEFAULT 'player';");
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_players_discord_tag
        ON players (discord_tag COLLATE NOCASE);
      `);
      // 5.1. Character class levels (multiclassing)
      db.exec(`
        CREATE TABLE IF NOT EXISTS character_classes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          class_name TEXT NOT NULL,
          subclass_name TEXT DEFAULT NULL,
          class_level INTEGER NOT NULL CHECK (class_level >= 1),
          is_primary INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(character_id, class_name)
        );
      `);
      // 6. Adventures
      db.exec(`
        CREATE TABLE IF NOT EXISTS adventures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          xp_awarded INTEGER NOT NULL DEFAULT 1 CHECK (xp_awarded >= 1),
          dm_player_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (dm_player_id) REFERENCES players(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS adventure_rewards (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER NOT NULL,
          character_id INTEGER NOT NULL,
          xp INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (adventure_id) REFERENCES adventures(id) ON DELETE CASCADE,
          FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
        );
      `);
      try {
        db.exec(`ALTER TABLE adventures ADD COLUMN dm_character_id INTEGER REFERENCES characters(id)`);
      } catch (e) {
        // Column already exists
      }
      // 6.1. Add missing columns to players
      const playerCols = db.prepare("PRAGMA table_info(players)").all().map(c => c.name);
      if (!playerCols.includes('dm_points')) {
        db.exec("ALTER TABLE players ADD COLUMN dm_points INTEGER NOT NULL DEFAULT 0;");
      }
      // 6.2. Add missing columns to characters
      const charCols = db.prepare("PRAGMA table_info(characters)").all().map(c => c.name);
      if (!charCols.includes('race')) {
        db.exec("ALTER TABLE characters ADD COLUMN race TEXT NOT NULL DEFAULT 'Unknown';");
      }
      if (!charCols.includes('subclass')) {
        db.exec("ALTER TABLE characters ADD COLUMN subclass TEXT NOT NULL DEFAULT '';");
      }
      if (!charCols.includes('xp')) {
        db.exec("ALTER TABLE characters ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;");
      }
      if (!charCols.includes('gold_gp')) {
        db.exec('ALTER TABLE characters ADD COLUMN gold_gp INTEGER NOT NULL DEFAULT 0 CHECK (gold_gp >= 0);');
      }
      if (!charCols.includes('death_adventure_id')) {
        db.exec('ALTER TABLE characters ADD COLUMN death_adventure_id INTEGER REFERENCES adventures(id) ON DELETE SET NULL;');
      }
      if (!charCols.includes('death_dm_player_id')) {
        db.exec('ALTER TABLE characters ADD COLUMN death_dm_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL;');
      }
      if (!charCols.includes('death_notes')) {
        db.exec('ALTER TABLE characters ADD COLUMN death_notes TEXT;');
      }
      if (!charCols.includes('sheet_data')) {
        db.exec('ALTER TABLE characters ADD COLUMN sheet_data TEXT;');
      }
      // Backfill the multiclass table from the legacy character columns.
      const existingChars = db.prepare(
        'SELECT id, class AS character_class, subclass, level FROM characters'
      ).all();
      const insertClass = db.prepare(`
        INSERT OR IGNORE INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary)
        VALUES (?, ?, ?, ?, 1)
      `);
      const migrateCharacterClasses = db.transaction(() => {
        for (const char of existingChars) {
          if (char.character_class) {
            insertClass.run(
              char.id,
              char.character_class,
              char.subclass || null,
              Math.max(1, char.level)
            );
          }
        }
      });
      migrateCharacterClasses();
    }
  },
  {
    version: 2,
    name: 'Store character gold in copper pieces (gold_cp)',
    up(db) {
      const charCols = db.prepare('PRAGMA table_info(characters)').all().map(c => c.name);
      // Gold is stored as whole copper pieces in gold_cp. gold_gp is the old column
      // (it ended up holding fractions after web purchases); triggers keep it as a
      // read-only mirror so the previous app version still shows correct gold.
      if (!charCols.includes('gold_cp')) {
        db.transaction(() => {
          db.exec('ALTER TABLE characters ADD COLUMN gold_cp INTEGER NOT NULL DEFAULT 0 CHECK (gold_cp >= 0);');
          db.exec('UPDATE characters SET gold_cp = CAST(ROUND(gold_gp * 100) AS INTEGER);');
        })();
      }
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS characters_gold_mirror_insert AFTER INSERT ON characters
        BEGIN UPDATE characters SET gold_gp = NEW.gold_cp / 100.0 WHERE id = NEW.id; END;
        CREATE TRIGGER IF NOT EXISTS characters_gold_mirror_update AFTER UPDATE OF gold_cp ON characters
        BEGIN UPDATE characters SET gold_gp = NEW.gold_cp / 100.0 WHERE id = NEW.id; END;
      `);
    }
  },
  {
    version: 3,
    name: 'Record which character paid for each sale',
    up(db) {
      // 6.3. Which character paid for a sale (NULL for sales before characters had purses).
      const saleCols = db.prepare('PRAGMA table_info(sales)').all().map(c => c.name);
      if (!saleCols.includes('character_id')) {
        db.exec('ALTER TABLE sales ADD COLUMN character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;');
      }
    }
  },
  {
    version: 4,
    name: 'Active adventures from Discord threads, with their party',
    up(db) {
      // Adventures recorded so far were entered after the session: completed.
      const advCols = db.prepare('PRAGMA table_info(adventures)').all().map(c => c.name);
      if (!advCols.includes('status')) {
        db.exec("ALTER TABLE adventures ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('active', 'completed', 'cancelled'));");
      }
      if (!advCols.includes('discord_thread_id')) db.exec('ALTER TABLE adventures ADD COLUMN discord_thread_id TEXT;');
      if (!advCols.includes('discord_guild_id')) db.exec('ALTER TABLE adventures ADD COLUMN discord_guild_id TEXT;');
      if (!advCols.includes('completed_at')) db.exec('ALTER TABLE adventures ADD COLUMN completed_at DATETIME;');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS adventures_discord_thread ON adventures (discord_thread_id)
          WHERE discord_thread_id IS NOT NULL;

        -- Characters taking part in an adventure that is still running. XP is
        -- only awarded (in adventure_rewards) when the adventure is finished.
        CREATE TABLE IF NOT EXISTS adventure_party (
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (adventure_id, character_id)
        );
      `);
    }
  }
];

function runMigrations(db) {
  const current = db.pragma('user_version', { simple: true });
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}

module.exports = { MIGRATIONS, runMigrations };
