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
  },
  {
    version: 5,
    name: 'Dice rolls from the character sheet, and Owlbear Rodeo keys',
    up(db) {
      db.exec(`
        -- Rolls made from the panel (the old "rolls" table holds weekly shop rolls).
        CREATE TABLE IF NOT EXISTS dice_rolls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
          label TEXT NOT NULL,
          formula TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'normal',
          total INTEGER NOT NULL,
          detail TEXT NOT NULL,
          private INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS dice_rolls_character ON dice_rolls (character_id, id);
        CREATE INDEX IF NOT EXISTS dice_rolls_player ON dice_rolls (player_id, id);

        -- The key a player pastes into the Owlbear Rodeo extension.
        CREATE TABLE IF NOT EXISTS vtt_keys (
          player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
          key TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_used_at DATETIME
        );
      `);
    }
  },
  {
    version: 6,
    name: "Characters' Discord threads and a log of gold changes",
    up(db) {
      const charCols = db.prepare('PRAGMA table_info(characters)').all().map(c => c.name);
      // The character's thread in the character channel (🧝┆soh-postaci).
      if (!charCols.includes('discord_thread_id')) db.exec('ALTER TABLE characters ADD COLUMN discord_thread_id TEXT;');
      db.exec(`
        -- Every hand edit of a purse (shop purchases are in sales).
        CREATE TABLE IF NOT EXISTS gold_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          changed_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
          changed_by_admin INTEGER NOT NULL DEFAULT 0,
          old_cp INTEGER NOT NULL,
          new_cp INTEGER NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS gold_changes_character ON gold_changes (character_id, id);
      `);
    }
  },
  {
    version: 7,
    name: 'A change log for live updates of the adventure table',
    up(db) {
      // Triggers note every write, whatever code made it (sheet, shop, bot,
      // DM forms); liveUpdates.js reads new rows and pushes them to open
      // adventure tables. Old rows are pruned.
      db.exec(`
        CREATE TABLE IF NOT EXISTS change_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,            -- 'character' | 'adventure' | 'roll'
          ref_id INTEGER NOT NULL,       -- character or adventure id
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS change_log_character_update AFTER UPDATE ON characters
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('character', NEW.id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_class_insert AFTER INSERT ON character_classes
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('character', NEW.character_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_class_update AFTER UPDATE ON character_classes
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('character', NEW.character_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_class_delete AFTER DELETE ON character_classes
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('character', OLD.character_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_party_insert AFTER INSERT ON adventure_party
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_party_delete AFTER DELETE ON adventure_party
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', OLD.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_adventure_update AFTER UPDATE ON adventures
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_roll_insert AFTER INSERT ON dice_rolls
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('roll', NEW.character_id); END;
      `);
    }
  },
  {
    version: 8,
    name: 'Notable NPCs and the adventures they appear in',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS npcs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          affiliation TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',  -- lore everyone can read
          sheet_url TEXT NOT NULL DEFAULT '',    -- link to a sheet or statblock
          status TEXT NOT NULL DEFAULT 'alive',  -- 'alive' | 'dead' | 'unknown'
          dm_notes TEXT NOT NULL DEFAULT '',     -- DMs only, like the stats below
          armor_class INTEGER,
          hp_max INTEGER,
          hp_current INTEGER,
          hp_temp INTEGER NOT NULL DEFAULT 0,
          speed TEXT NOT NULL DEFAULT '',
          abilities TEXT NOT NULL DEFAULT '{}',  -- { str: 10, ... }
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        -- Every adventure an NPC appeared in (kept after the adventure ends).
        CREATE TABLE IF NOT EXISTS adventure_npcs (
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          npc_id INTEGER NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (adventure_id, npc_id)
        );
        CREATE INDEX IF NOT EXISTS adventure_npcs_npc ON adventure_npcs (npc_id);
        -- Live adventure tables (see liveUpdates.js).
        CREATE TRIGGER IF NOT EXISTS change_log_npc_update AFTER UPDATE ON npcs
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('npc', NEW.id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_adventure_npc_insert AFTER INSERT ON adventure_npcs
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_adventure_npc_delete AFTER DELETE ON adventure_npcs
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', OLD.adventure_id); END;
      `);
    }
  },
  {
    version: 9,
    name: 'NPC owners, plans, personality, portrait and statblock files',
    up(db) {
      // Only the columns still missing, so the migration is safe to run again.
      const existing = new Set(db.prepare('PRAGMA table_info(npcs)').all().map(column => column.name));
      const columns = {
        // The DM who looks after the NPC: a player id, or 0 for the Root DM.
        owner_player_id: 'INTEGER',
        // 'reserved' (long-term plans, ask the owner first), 'free' (a one-off) or ''.
        plans: "TEXT NOT NULL DEFAULT ''",
        plans_note: "TEXT NOT NULL DEFAULT ''",
        personality: "TEXT NOT NULL DEFAULT ''",
        // File names in the uploads folder (see db/npcFiles.js).
        portrait_file: "TEXT NOT NULL DEFAULT ''",
        statblock_file: "TEXT NOT NULL DEFAULT ''"
      };
      for (const [name, type] of Object.entries(columns)) {
        if (!existing.has(name)) db.exec(`ALTER TABLE npcs ADD COLUMN ${name} ${type}`);
      }
    }
  },
  {
    version: 10,
    name: 'Catalog rarity and shop availability',
    up(db) {
      // rarity: '' for mundane gear, else Common … Legendary (rules/shopCatalog.js).
      // availability: 'shop' (may be rolled into the weekly stock) or 'adventure'
      // (adventure rewards only). Only the missing columns, so it can run again.
      const existing = new Set(db.prepare('PRAGMA table_info(catalog)').all().map(column => column.name));
      if (!existing.has('rarity')) db.exec("ALTER TABLE catalog ADD COLUMN rarity TEXT NOT NULL DEFAULT ''");
      if (!existing.has('availability')) db.exec("ALTER TABLE catalog ADD COLUMN availability TEXT NOT NULL DEFAULT 'shop'");
    }
  },
  {
    version: 11,
    name: 'Shelf item sources and ages for the weekly restock',
    up(db) {
      // source: 'mundane' | 'staple' | 'magic' | 'scroll' | 'manual' (a DM's own)
      // | 'legacy' (from before this; cleared by the next restock). weeks: how
      // many restocks a magic item has stayed. See db/restock.js.
      const existing = new Set(db.prepare('PRAGMA table_info(items)').all().map(column => column.name));
      if (!existing.has('source')) {
        db.exec("ALTER TABLE items ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
        db.exec("UPDATE items SET source = 'legacy'");
      }
      if (!existing.has('rarity')) db.exec("ALTER TABLE items ADD COLUMN rarity TEXT NOT NULL DEFAULT ''");
      if (!existing.has('weeks')) db.exec('ALTER TABLE items ADD COLUMN weeks INTEGER NOT NULL DEFAULT 0');
    }
  },
  {
    version: 12,
    name: 'Artisans and weekly shop events',
    up(db) {
      db.exec(`
        -- Resident craftspeople and what they make (see db/artisans.js).
        CREATE TABLE IF NOT EXISTS artisans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS artisan_goods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          artisan_id INTEGER NOT NULL REFERENCES artisans(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Artisan Goods',
          price_cp INTEGER NOT NULL CHECK (price_cp > 0),
          description TEXT NOT NULL DEFAULT '',
          per_week INTEGER NOT NULL DEFAULT 1,
          cap INTEGER NOT NULL DEFAULT 3
        );
        -- Weekly events: kind 'merchant' | 'shortage' | 'sale' | 'news'; params JSON.
        CREATE TABLE IF NOT EXISTS shop_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          announcement TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL,
          params TEXT NOT NULL DEFAULT '{}',
          weight INTEGER NOT NULL DEFAULT 1,
          active INTEGER NOT NULL DEFAULT 1
        );
      `);
    }
  },
  {
    version: 13,
    name: 'Auctions',
    up(db) {
      db.exec(`
        -- Magic items players put up for auction (see db/auctions.js). item_data:
        -- the sheet entry, given to the winner. status: open | sold | unsold | withdrawn.
        CREATE TABLE IF NOT EXISTS auctions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          seller_character_id INTEGER NOT NULL,
          seller_player_id INTEGER NOT NULL,
          item_name TEXT NOT NULL,
          rarity TEXT NOT NULL DEFAULT '',
          item_data TEXT NOT NULL,
          value_cp INTEGER NOT NULL,
          opening_bid_cp INTEGER NOT NULL,
          current_bid_cp INTEGER NOT NULL DEFAULT 0,
          current_bidder_character_id INTEGER,
          current_bidder_npc TEXT,
          npc_cap_cp INTEGER NOT NULL DEFAULT 0,
          npc_days INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          closed_at TEXT,
          result TEXT
        );
        CREATE INDEX IF NOT EXISTS auctions_status ON auctions (status, ends_at);
        CREATE TABLE IF NOT EXISTS auction_bids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
          character_id INTEGER,
          npc_name TEXT,
          amount_cp INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 14,
    name: 'Travelling artisans',
    up(db) {
      // 'resident' (supplies every restock) or 'travelling' (only comes with a
      // visiting-merchant event). See db/artisans.js.
      const existing = new Set(db.prepare('PRAGMA table_info(artisans)').all().map(column => column.name));
      if (!existing.has('mode')) db.exec("ALTER TABLE artisans ADD COLUMN mode TEXT NOT NULL DEFAULT 'resident'");
    }
  },
  {
    version: 15,
    name: 'Wood Elf speed',
    up(db) {
      // Wood Elves have Speed 35 ft.; characters made before it was applied still
      // had the Elf 30 ft. A speed someone typed in by hand is left alone.
      db.exec(`
        UPDATE characters SET sheet_data = json_set(sheet_data, '$.speed', '35 ft.')
        WHERE race = 'Elf' AND json_valid(sheet_data)
          AND json_extract(sheet_data, '$.speciesOption') = 'Wood Elf'
          AND COALESCE(json_extract(sheet_data, '$.speed'), '30 ft.') IN ('30 ft.', '30 ft', '30')
      `);
    }
  },
  {
    version: 16,
    name: 'Character portraits',
    up(db) {
      // A file name in uploads/characters (see db/characterPortraits.js).
      const existing = new Set(db.prepare('PRAGMA table_info(characters)').all().map(column => column.name));
      if (!existing.has('portrait_file')) db.exec("ALTER TABLE characters ADD COLUMN portrait_file TEXT NOT NULL DEFAULT ''");
    }
  },
  {
    version: 17,
    name: 'Adventure secrets: hidden table NPCs, DM take-overs',
    up(db) {
      // hidden: the DM prepared the NPC; the party doesn't see it yet.
      const npcColumns = new Set(db.prepare('PRAGMA table_info(adventure_npcs)').all().map(column => column.name));
      if (!npcColumns.has('hidden')) db.exec('ALTER TABLE adventure_npcs ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
      // dm_changes: JSON list of { fromId, from, toId, to, at } when an admin took an adventure over.
      const adventureColumns = new Set(db.prepare('PRAGMA table_info(adventures)').all().map(column => column.name));
      if (!adventureColumns.has('dm_changes')) db.exec("ALTER TABLE adventures ADD COLUMN dm_changes TEXT NOT NULL DEFAULT '[]'");
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS change_log_adventure_npc_update AFTER UPDATE ON adventure_npcs
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
      `);
    }
  },
  {
    version: 18,
    name: 'Notable NPCs based on a monster statblock',
    up(db) {
      // base_monster: a statblock name from rules/content/monsters.md, or ''.
      const columns = new Set(db.prepare('PRAGMA table_info(npcs)').all().map(column => column.name));
      if (!columns.has('base_monster')) db.exec("ALTER TABLE npcs ADD COLUMN base_monster TEXT NOT NULL DEFAULT ''");
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
