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
  },
  {
    version: 19,
    name: 'Encounters: monsters and NPCs the DM prepares for an adventure',
    up(db) {
      db.exec(`
        -- status: planned (the DM's secret), running (on the table), done.
        CREATE TABLE IF NOT EXISTS encounters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'planned',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          ended_at DATETIME
        );
        CREATE INDEX IF NOT EXISTS encounters_adventure ON encounters (adventure_id);
        -- One row per creature: a monster from the catalog (its own HP here),
        -- or a Notable NPC (HP on the npcs row). number: Goblin 1, Goblin 2...
        CREATE TABLE IF NOT EXISTS encounter_combatants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          monster_name TEXT,
          npc_id INTEGER REFERENCES npcs(id) ON DELETE CASCADE,
          number INTEGER NOT NULL DEFAULT 1,
          hp_max INTEGER,
          hp_current INTEGER,
          hp_temp INTEGER NOT NULL DEFAULT 0,
          initiative INTEGER,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS encounter_combatants_encounter ON encounter_combatants (encounter_id);
        CREATE TRIGGER IF NOT EXISTS change_log_encounter_insert AFTER INSERT ON encounters
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_encounter_update AFTER UPDATE ON encounters
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_encounter_delete AFTER DELETE ON encounters
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', OLD.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_combatant_insert AFTER INSERT ON encounter_combatants
          BEGIN INSERT INTO change_log (kind, ref_id) SELECT 'adventure', adventure_id FROM encounters WHERE id = NEW.encounter_id; END;
        CREATE TRIGGER IF NOT EXISTS change_log_combatant_update AFTER UPDATE ON encounter_combatants
          BEGIN INSERT INTO change_log (kind, ref_id) SELECT 'adventure', adventure_id FROM encounters WHERE id = NEW.encounter_id; END;
        CREATE TRIGGER IF NOT EXISTS change_log_combatant_delete AFTER DELETE ON encounter_combatants
          BEGIN INSERT INTO change_log (kind, ref_id) SELECT 'adventure', adventure_id FROM encounters WHERE id = OLD.encounter_id; END;
      `);
    }
  },
  {
    version: 20,
    name: "Encounter combatants: the DM's own name (to match a VTT token) and AC",
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(encounter_combatants)').all().map(column => column.name));
      if (!columns.has('name')) db.exec('ALTER TABLE encounter_combatants ADD COLUMN name TEXT');
      if (!columns.has('armor_class')) db.exec('ALTER TABLE encounter_combatants ADD COLUMN armor_class INTEGER');
    }
  },
  {
    version: 21,
    name: 'Encounter combatants: party members (their initiative; HP stays on the sheet)',
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(encounter_combatants)').all().map(column => column.name));
      if (!columns.has('character_id')) db.exec('ALTER TABLE encounter_combatants ADD COLUMN character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE');
    }
  },
  {
    version: 22,
    name: 'Gifts between characters (and shop purchases bought for someone)',
    up(db) {
      db.exec(`
        -- kind: item (equipment), magic (Magic Items), shop (bought as a gift; cost_cp paid by the giver).
        CREATE TABLE IF NOT EXISTS gifts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          to_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          item_name TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 1,
          kind TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          given_by_player_id INTEGER,
          cost_cp INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS gifts_from ON gifts (from_character_id);
        CREATE INDEX IF NOT EXISTS gifts_to ON gifts (to_character_id);
      `);
      const columns = new Set(db.prepare('PRAGMA table_info(sales)').all().map(column => column.name));
      if (!columns.has('gift_to_character_id')) db.exec('ALTER TABLE sales ADD COLUMN gift_to_character_id INTEGER');
    }
  },
  {
    version: 23,
    name: "Reserving items at Grimbold's (a deposit keeps them through restocks)",
    up(db) {
      db.exec(`
        -- status: active, bought, cancelled (deposit kept), expired (deposit kept), refunded.
        CREATE TABLE IF NOT EXISTS reservations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          item_name TEXT NOT NULL,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL,
          deposit_cp INTEGER NOT NULL,
          restocks_left INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          ended_at DATETIME
        );
        CREATE INDEX IF NOT EXISTS reservations_active ON reservations (status, item_id);
      `);
    }
  },
  {
    version: 24,
    name: 'Monsters imported from 5etools files',
    up(db) {
      db.exec(`
        -- status: uploading (batches arriving), ready. meta: the file's _meta (homebrew sources).
        CREATE TABLE IF NOT EXISTS monster_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT NOT NULL,
          file_name TEXT NOT NULL DEFAULT '',
          meta TEXT,
          uploaded_by INTEGER,
          status TEXT NOT NULL DEFAULT 'uploading',
          monster_count INTEGER NOT NULL DEFAULT 0,
          skipped TEXT NOT NULL DEFAULT '[]',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        -- raw: the creature as 5etools has it (converted by rules/fiveTools.js).
        CREATE TABLE IF NOT EXISTS imported_monsters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT '',
          raw TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS imported_monsters_import ON imported_monsters (import_id);
      `);
    }
  },
  {
    version: 25,
    name: "Monster rolls kept with the adventure; the DM can reveal them",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS encounter_rolls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          encounter_id INTEGER,
          combatant TEXT NOT NULL,
          label TEXT NOT NULL,
          formula TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'normal',
          total INTEGER NOT NULL,
          natural INTEGER,
          text TEXT NOT NULL DEFAULT '',
          revealed INTEGER NOT NULL DEFAULT 0,
          -- 1, 2, 3… in the order rolls were revealed (Owlbear reads them after the last it saw).
          reveal_seq INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          revealed_at DATETIME
        );
        CREATE INDEX IF NOT EXISTS encounter_rolls_adventure ON encounter_rolls (adventure_id, id);
        CREATE TRIGGER IF NOT EXISTS change_log_encounter_roll_update AFTER UPDATE ON encounter_rolls
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
      `);
    }
  },
  {
    version: 26,
    name: "Homebrew statblocks for one adventure (catalog monsters stay as they are)",
    up(db) {
      db.exec(`
        -- data: the editable draft (rules/customMonsters.js). based_on: the catalog monster it was copied from.
        CREATE TABLE IF NOT EXISTS adventure_statblocks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          based_on TEXT,
          data TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS adventure_statblocks_adventure ON adventure_statblocks (adventure_id);
        CREATE TRIGGER IF NOT EXISTS change_log_statblock_insert AFTER INSERT ON adventure_statblocks
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_statblock_update AFTER UPDATE ON adventure_statblocks
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
      `);
      const columns = new Set(db.prepare('PRAGMA table_info(encounter_combatants)').all().map(column => column.name));
      if (!columns.has('statblock_id')) db.exec('ALTER TABLE encounter_combatants ADD COLUMN statblock_id INTEGER');
    }
  },
  {
    version: 27,
    name: 'Scheduling sessions: polls in the Discord thread, confirmed sessions',
    up(db) {
      db.exec(`
        -- status: open, confirmed, cancelled, replaced (a newer poll took over). created_by: a Discord id.
        CREATE TABLE IF NOT EXISTS session_polls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          created_by TEXT NOT NULL,
          minutes INTEGER NOT NULL DEFAULT 240,
          status TEXT NOT NULL DEFAULT 'open',
          chosen_option_id INTEGER,
          channel_id TEXT,
          message_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS session_polls_adventure ON session_polls (adventure_id, status);
        -- Times are ISO moments (UTC).
        CREATE TABLE IF NOT EXISTS session_options (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER NOT NULL REFERENCES session_polls(id) ON DELETE CASCADE,
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS session_options_poll ON session_options (poll_id);
        -- answer: yes, maybe, no. name: the Discord name at the time of the answer.
        CREATE TABLE IF NOT EXISTS session_votes (
          option_id INTEGER NOT NULL REFERENCES session_options(id) ON DELETE CASCADE,
          discord_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          answer TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (option_id, discord_id)
        );
        -- status: scheduled, cancelled. reminded: the day-before note went out.
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          poll_id INTEGER,
          option_id INTEGER,
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled',
          discord_event_id TEXT,
          reminded INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS sessions_time ON sessions (status, starts_at);
        CREATE TRIGGER IF NOT EXISTS change_log_session_insert AFTER INSERT ON sessions
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_session_update AFTER UPDATE ON sessions
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
      `);
    }
  },
  {
    version: 28,
    name: 'Sessions: changes counted for calendars; personal calendar feeds',
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(column => column.name));
      // sequence: bumped on every change, so calendars take the new version.
      if (!columns.has('sequence')) db.exec('ALTER TABLE sessions ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0');
      if (!columns.has('updated_at')) db.exec('ALTER TABLE sessions ADD COLUMN updated_at TEXT');
      db.exec(`
        -- A secret link per Discord account: its sessions as a calendar feed (/calendar/<token>.ics).
        CREATE TABLE IF NOT EXISTS calendar_tokens (
          discord_id TEXT PRIMARY KEY,
          token TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 29,
    name: 'Campaigns: sessions outside adventure threads (a DM, members, a channel)',
    up(db) {
      db.exec(`
        -- A campaign run apart from the panel's adventures; its sessions join the
        -- same calendar, so clashes with one-shots show. channel_id: where Grimbrandt posts.
        CREATE TABLE IF NOT EXISTS campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          dm_discord_id TEXT NOT NULL,
          dm_name TEXT NOT NULL DEFAULT '',
          channel_id TEXT,
          guild_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS campaign_members (
          campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          discord_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (campaign_id, discord_id)
        );
        -- Sessions now belong to an adventure or a campaign: the table is
        -- rebuilt so adventure_id may be empty (its rows are kept).
        DROP TRIGGER IF EXISTS change_log_session_insert;
        DROP TRIGGER IF EXISTS change_log_session_update;
        CREATE TABLE sessions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER REFERENCES adventures(id) ON DELETE CASCADE,
          campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
          poll_id INTEGER,
          option_id INTEGER,
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled',
          discord_event_id TEXT,
          reminded INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          sequence INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT
        );
        INSERT INTO sessions_new (id, adventure_id, poll_id, option_id, starts_at, ends_at, status, discord_event_id, reminded, created_by, created_at, sequence, updated_at)
          SELECT id, adventure_id, poll_id, option_id, starts_at, ends_at, status, discord_event_id, reminded, created_by, created_at, sequence, updated_at FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
        CREATE INDEX IF NOT EXISTS sessions_time ON sessions (status, starts_at);
        CREATE TRIGGER IF NOT EXISTS change_log_session_insert AFTER INSERT ON sessions WHEN NEW.adventure_id IS NOT NULL
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_session_update AFTER UPDATE ON sessions WHEN NEW.adventure_id IS NOT NULL
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
      `);
    }
  },
  {
    version: 30,
    name: 'World map: the image and its hex grid, markers, adventure routes, hexes revealed by hand',
    up(db) {
      db.exec(`
        -- One map; the grid is lined up with the image by a DM (hex centres in image pixels).
        CREATE TABLE IF NOT EXISTS world_map (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          image_file TEXT NOT NULL DEFAULT '',
          cols INTEGER NOT NULL DEFAULT 21,
          rows INTEGER NOT NULL DEFAULT 16,
          origin_x REAL NOT NULL DEFAULT 92,
          origin_y REAL NOT NULL DEFAULT 56,
          hex_size REAL NOT NULL DEFAULT 62.3,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT OR IGNORE INTO world_map (id) VALUES (1);
        -- hex: "column.row" as on the map ("9.6"). secret: DMs only; shown ones
        -- appear to players in hexes they have revealed.
        CREATE TABLE IF NOT EXISTS map_markers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hex TEXT NOT NULL,
          name TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT 'site',
          note TEXT NOT NULL DEFAULT '',
          adventure_id INTEGER REFERENCES adventures(id) ON DELETE SET NULL,
          secret INTEGER NOT NULL DEFAULT 1,
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        -- The hexes an adventure went through: revealed to everyone in its party.
        CREATE TABLE IF NOT EXISTS adventure_hexes (
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          hex TEXT NOT NULL,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (adventure_id, hex)
        );
        -- Hexes a DM revealed to one character by hand.
        CREATE TABLE IF NOT EXISTS character_hexes (
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          hex TEXT NOT NULL,
          revealed_by INTEGER,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (character_id, hex)
        );
      `);
    }
  },
  {
    version: 31,
    name: 'World map: hexes revealed to everyone (the main hub)',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS map_public_hexes (
          hex TEXT PRIMARY KEY,
          revealed_by INTEGER,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 32,
    name: 'World map: a marker can belong to several adventures',
    up(db) {
      db.exec(`
        -- Replaces map_markers.adventure_id (kept, no longer used).
        CREATE TABLE IF NOT EXISTS map_marker_adventures (
          marker_id INTEGER NOT NULL REFERENCES map_markers(id) ON DELETE CASCADE,
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          PRIMARY KEY (marker_id, adventure_id)
        );
        INSERT OR IGNORE INTO map_marker_adventures (marker_id, adventure_id)
          SELECT id, adventure_id FROM map_markers WHERE adventure_id IS NOT NULL;
      `);
    }
  },
  {
    version: 33,
    name: 'Adventures may award 0 XP',
    // Rebuilding a table others point to: with foreign keys on, dropping it
    // would delete their rows, so this one runs with them off.
    foreignKeysOff: true,
    up(db) {
      const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'adventures'").get();
      if (!table || !table.sql.includes('CHECK (xp_awarded >= 1)')) return;
      // Indexes and triggers go with the table; made again afterwards.
      const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'adventures' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all().map(row => row.sql);
      const columns = db.prepare('PRAGMA table_info(adventures)').all().map(column => `"${column.name}"`).join(', ');
      const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'adventures'").get();
      db.exec(table.sql.replace(/^CREATE TABLE "?adventures"?/, 'CREATE TABLE adventures_new').replace('CHECK (xp_awarded >= 1)', 'CHECK (xp_awarded >= 0)'));
      db.exec(`INSERT INTO adventures_new (${columns}) SELECT ${columns} FROM adventures`);
      db.exec('DROP TABLE adventures');
      db.exec('ALTER TABLE adventures_new RENAME TO adventures');
      extras.forEach(sql => db.exec(sql));
      if (sequence) db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'adventures'").run(sequence.seq);
      const broken = db.pragma('foreign_key_check');
      if (broken.length) throw new Error(`Rebuilding adventures broke ${broken.length} references.`);
    }
  },
  {
    version: 34,
    name: 'Skill challenges: the challenge, who takes part, and each attempt',
    up(db) {
      db.exec(`
        -- A skill challenge of an adventure (rules/skillChallenges.js). dc: hidden
        -- from players. turn_character_id: whose turn it is; help_by: a Help
        -- waiting to give the next roller Advantage. outcome: set when it ends.
        CREATE TABLE IF NOT EXISTS skill_challenges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          situation TEXT NOT NULL DEFAULT '',
          successes_needed INTEGER NOT NULL DEFAULT 6,
          failures_allowed INTEGER NOT NULL DEFAULT 3,
          dc INTEGER NOT NULL DEFAULT 15,
          skills TEXT NOT NULL DEFAULT '[]',
          show_tally INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'planned',
          round INTEGER NOT NULL DEFAULT 1,
          turn_character_id INTEGER,
          help_by INTEGER,
          outcome TEXT,
          outcome_note TEXT NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          ended_at DATETIME
        );
        CREATE INDEX IF NOT EXISTS skill_challenges_adventure ON skill_challenges (adventure_id);
        CREATE TABLE IF NOT EXISTS skill_challenge_participants (
          challenge_id INTEGER NOT NULL REFERENCES skill_challenges(id) ON DELETE CASCADE,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          initiative INTEGER,
          PRIMARY KEY (challenge_id, character_id)
        );
        -- kind: check (a skill roll), help (Advantage for the next roller),
        -- feature (a spell, feature or item the DM counts as a success).
        -- success: 1 / 0 for checks and features, NULL for help. voided: the DM
        -- took it back (it no longer counts, the skill is free again).
        CREATE TABLE IF NOT EXISTS skill_challenge_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          challenge_id INTEGER NOT NULL REFERENCES skill_challenges(id) ON DELETE CASCADE,
          character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
          character_name TEXT NOT NULL DEFAULT '',
          round INTEGER NOT NULL,
          kind TEXT NOT NULL,
          skill TEXT,
          detail TEXT NOT NULL DEFAULT '',
          roll_id INTEGER,
          total INTEGER,
          natural INTEGER,
          mode TEXT,
          dc INTEGER,
          success INTEGER,
          voided INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS skill_challenge_attempts_challenge ON skill_challenge_attempts (challenge_id);
        CREATE TRIGGER IF NOT EXISTS change_log_challenge_insert AFTER INSERT ON skill_challenges
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_challenge_update AFTER UPDATE ON skill_challenges
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_challenge_delete AFTER DELETE ON skill_challenges
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', OLD.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_challenge_participant AFTER INSERT ON skill_challenge_participants
          BEGIN INSERT INTO change_log (kind, ref_id) SELECT 'adventure', adventure_id FROM skill_challenges WHERE id = NEW.challenge_id; END;
        CREATE TRIGGER IF NOT EXISTS change_log_challenge_participant_update AFTER UPDATE ON skill_challenge_participants
          BEGIN INSERT INTO change_log (kind, ref_id) SELECT 'adventure', adventure_id FROM skill_challenges WHERE id = NEW.challenge_id; END;
        CREATE TRIGGER IF NOT EXISTS change_log_challenge_participant_delete AFTER DELETE ON skill_challenge_participants
          BEGIN INSERT INTO change_log (kind, ref_id) SELECT 'adventure', adventure_id FROM skill_challenges WHERE id = OLD.challenge_id; END;
        CREATE TRIGGER IF NOT EXISTS change_log_challenge_attempt AFTER INSERT ON skill_challenge_attempts
          BEGIN INSERT INTO change_log (kind, ref_id) SELECT 'adventure', adventure_id FROM skill_challenges WHERE id = NEW.challenge_id; END;
        CREATE TRIGGER IF NOT EXISTS change_log_challenge_attempt_update AFTER UPDATE ON skill_challenge_attempts
          BEGIN INSERT INTO change_log (kind, ref_id) SELECT 'adventure', adventure_id FROM skill_challenges WHERE id = NEW.challenge_id; END;
      `);
    }
  },
  {
    // The DM's reward is the adventure's XP (it was always 1): what the DM got
    // is stored, so editing or deleting an adventure takes back the right
    // amount. Finished adventures gave 1 (to a character or as a DM point);
    // the difference is topped up once at startup (db/adventures.js settleDmRewards).
    version: 35,
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(adventures)').all().map(column => column.name));
      if (columns.has('dm_reward_xp')) return;
      db.exec(`
        ALTER TABLE adventures ADD COLUMN dm_reward_xp INTEGER NOT NULL DEFAULT 0;
        UPDATE adventures SET dm_reward_xp = 1
        WHERE status = 'completed' AND (dm_character_id IS NOT NULL OR dm_player_id IS NOT NULL);
      `);
    }
  },
  {
    // A player's dice colour (db/dice.js DICE_COLORS), changed when the dice
    // stop rolling well; each roll keeps the colour it was made with.
    version: 36,
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(players)').all().map(column => column.name));
      if (!columns.has('dice_color')) db.exec('ALTER TABLE players ADD COLUMN dice_color TEXT');
    }
  },
  {
    // A resident artisan's own delivery window (days 1 = Monday … 7 = Sunday,
    // hours 0–24, Polish time) and Discord line; NULL days = they deliver with
    // the weekly restock, as before. next_delivery_at is this week's moment,
    // picked at random inside the window (db/deliveries.js).
    version: 37,
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(artisans)').all().map(column => column.name));
      const add = (name, type) => { if (!columns.has(name)) db.exec(`ALTER TABLE artisans ADD COLUMN ${name} ${type}`); };
      add('delivery_day_from', 'INTEGER');
      add('delivery_day_to', 'INTEGER');
      add('delivery_hour_from', 'INTEGER');
      add('delivery_hour_to', 'INTEGER');
      add('delivery_note', "TEXT NOT NULL DEFAULT ''");
      add('next_delivery_at', 'TEXT');
      add('last_delivery_at', 'TEXT');
    }
  },
  {
    // Google Docs about characters (diaries, letters, stories) shared in the
    // Discord docs channel (chronicles.js, db/characterDocs.js). doc_key is the
    // doc's ID ('pub:<id>' for a published-to-web link); character_id NULL =
    // unsorted. saved_text is Grimbold's copy, in case the doc goes away.
    version: 38,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS character_docs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_key TEXT NOT NULL UNIQUE,
          url TEXT NOT NULL,
          title TEXT,
          kind TEXT NOT NULL DEFAULT 'other',
          character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
          matched_by TEXT,
          hidden INTEGER NOT NULL DEFAULT 0,
          channel_id TEXT,
          guild_id TEXT,
          message_id TEXT,
          posted_by_discord_id TEXT,
          posted_by_tag TEXT,
          posted_at TEXT,
          message_text TEXT,
          access TEXT NOT NULL DEFAULT 'unknown',
          saved_text TEXT,
          saved_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS character_docs_character ON character_docs (character_id);
      `);
    }
  },
  {
    // Głos (glos.js, db/glos.js): the messages one DM sends players as "The
    // Voice" in Discord DMs, and what the players write back. direction 'out'
    // = to the player, 'in' = their reply. status 'failed' keeps the reason.
    version: 39,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS glos_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
          discord_id TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
          text TEXT NOT NULL DEFAULT '',
          image_url TEXT,
          status TEXT NOT NULL DEFAULT 'sent',
          error TEXT,
          discord_message_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS glos_messages_discord ON glos_messages (discord_id, id);
      `);
    }
  },
  {
    // NPC voices (npcVoice.js, db/npcVoice.js) replace Głos's own tab: a
    // private NPC is seen only by its owning DM and the Root DM; any NPC
    // speaks in a channel (webhook) or in a player's DMs (Grimbold, as an
    // embed in the NPC's colour). npc_voice_messages keeps what was said and
    // the players' replies (direction 'in'). target: 'dm', 'channel', 'thread'.
    version: 40,
    up(db) {
      const columns = db.prepare('PRAGMA table_info(npcs)').all().map(column => column.name);
      if (!columns.includes('private')) db.exec('ALTER TABLE npcs ADD COLUMN private INTEGER NOT NULL DEFAULT 0');
      if (!columns.includes('voice_color')) db.exec('ALTER TABLE npcs ADD COLUMN voice_color TEXT');
      db.exec(`
        DROP TABLE IF EXISTS glos_messages;
        CREATE TABLE IF NOT EXISTS npc_voice_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          npc_id INTEGER NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
          direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
          target TEXT NOT NULL DEFAULT 'dm',
          player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
          discord_id TEXT,
          place_label TEXT,
          text TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'sent',
          error TEXT,
          discord_message_id TEXT,
          sent_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS npc_voice_messages_npc ON npc_voice_messages (npc_id, id);
        CREATE INDEX IF NOT EXISTS npc_voice_messages_discord ON npc_voice_messages (discord_id, direction, id);
      `);
    }
  },
  {
    // Chronicles keep the doc's formatting too (docHtml.js): saved_html is
    // the cleaned HTML of Google's export, beside the plain saved_text.
    version: 41,
    up(db) {
      const columns = db.prepare('PRAGMA table_info(character_docs)').all().map(column => column.name);
      if (!columns.includes('saved_html')) db.exec('ALTER TABLE character_docs ADD COLUMN saved_html TEXT');
    }
  },
  {
    // The voice bot (voiceBot.js): an NPC's own Discord bot sends its DMs.
    // via: who delivered a DM ('grimbold' as a card, or 'bot'), so a reply
    // goes to the NPC whose messenger it answers.
    version: 42,
    up(db) {
      const columns = db.prepare('PRAGMA table_info(npc_voice_messages)').all().map(column => column.name);
      if (!columns.includes('via')) db.exec("ALTER TABLE npc_voice_messages ADD COLUMN via TEXT NOT NULL DEFAULT 'grimbold'");
    }
  },
  {
    // Familiars (db/familiars.js), and later other companions (Steel Defender,
    // Primal Companion, Homunculus) by kind. form: the monster catalog name;
    // creature_type: Celestial, Fey or Fiend; status: active, dismissed (in
    // its pocket dimension) or gone (0 HP or dismissed forever, until Find
    // Familiar is cast again). dm_granted: the DM gave a familiar to someone
    // without Find Familiar; any_form: the DM allows any catalog statblock.
    // options: JSON of feat choices (elemental / otherworldly damage type,
    // Chain Master's fly or swim). A fight's row for one: encounter_combatants.companion_id.
    version: 43,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS companions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          kind TEXT NOT NULL DEFAULT 'familiar',
          name TEXT,
          form TEXT,
          creature_type TEXT,
          hp_current INTEGER,
          hp_temp INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'gone',
          dm_granted INTEGER NOT NULL DEFAULT 0,
          any_form INTEGER NOT NULL DEFAULT 0,
          options TEXT NOT NULL DEFAULT '{}',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (character_id, kind)
        );
        CREATE TRIGGER IF NOT EXISTS change_log_companion_insert AFTER INSERT ON companions
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('character', NEW.character_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_companion_update AFTER UPDATE ON companions
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('character', NEW.character_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_companion_delete AFTER DELETE ON companions
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('character', OLD.character_id); END;
      `);
      const columns = new Set(db.prepare('PRAGMA table_info(encounter_combatants)').all().map(column => column.name));
      if (!columns.has('companion_id')) db.exec('ALTER TABLE encounter_combatants ADD COLUMN companion_id INTEGER REFERENCES companions(id) ON DELETE CASCADE');
    }
  },
  {
    // Resources the DM tracks on the adventure table (db/trackers.js): for a
    // party member (character_id) or a notable NPC (npc_id), a name, a short
    // comment and an optional count (current of max). The adventure's DM and
    // the Root DM only.
    version: 44,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS adventure_trackers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adventure_id INTEGER NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
          character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
          npc_id INTEGER REFERENCES npcs(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          comment TEXT NOT NULL DEFAULT '',
          current INTEGER,
          max INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS adventure_trackers_adventure ON adventure_trackers (adventure_id);
        CREATE TRIGGER IF NOT EXISTS change_log_tracker_insert AFTER INSERT ON adventure_trackers
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_tracker_update AFTER UPDATE ON adventure_trackers
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', NEW.adventure_id); END;
        CREATE TRIGGER IF NOT EXISTS change_log_tracker_delete AFTER DELETE ON adventure_trackers
          BEGIN INSERT INTO change_log (kind, ref_id) VALUES ('adventure', OLD.adventure_id); END;
      `);
    }
  },
  {
    // Trackers for a monster in an encounter too: combatant_id (each Goblin
    // its own); gone with the combatant or the encounter.
    version: 45,
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(adventure_trackers)').all().map(column => column.name));
      if (!columns.has('combatant_id')) db.exec('ALTER TABLE adventure_trackers ADD COLUMN combatant_id INTEGER REFERENCES encounter_combatants(id) ON DELETE CASCADE');
    }
  },
  {
    // The Art tab (art.js, db/art.js): images posted in the Discord art
    // channel, one row per attachment, with Grimbold's own copy (file, thumb)
    // since Discord's links expire. Tagged with the characters in it and an
    // adventure. tagged_by / adventure_by: who set them — 'name' (found in the
    // post), 'guess' (adventure only), 'discord' (Tag art), 'dm' (the panel);
    // adventure_by 'none' = nobody wants one guessed. not_art: a meme or a
    // screenshot, never shown in the gallery.
    version: 46,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS art_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attachment_id TEXT NOT NULL UNIQUE,
          message_id TEXT NOT NULL,
          channel_id TEXT,
          guild_id TEXT,
          thread_name TEXT,
          posted_by_discord_id TEXT,
          posted_by_tag TEXT,
          posted_at TEXT,
          message_text TEXT,
          filename TEXT,
          width INTEGER,
          height INTEGER,
          file TEXT,
          thumb_file TEXT,
          download_error TEXT,
          adventure_id INTEGER REFERENCES adventures(id) ON DELETE SET NULL,
          adventure_by TEXT,
          tagged_by TEXT,
          not_art INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS art_images_message ON art_images (message_id);
        CREATE INDEX IF NOT EXISTS art_images_adventure ON art_images (adventure_id);
        CREATE TABLE IF NOT EXISTS art_image_characters (
          image_id INTEGER NOT NULL REFERENCES art_images(id) ON DELETE CASCADE,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          PRIMARY KEY (image_id, character_id)
        );
        CREATE INDEX IF NOT EXISTS art_image_characters_character ON art_image_characters (character_id);
      `);
    }
  },
  {
    // Art: who else is in a picture (art_figures: a Notable NPC, a familiar or
    // pet from companions, or anyone else by name; name_key is the name
    // without case, accents, punctuation or extra spaces, so one isn't added
    // twice), and the artist's credit (artist_by as tagged_by).
    version: 47,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS art_figures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK (kind IN ('npc', 'companion', 'custom')),
          ref_id INTEGER,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS art_figures_ref ON art_figures (kind, ref_id) WHERE ref_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS art_figures_custom ON art_figures (name_key) WHERE kind = 'custom';
        CREATE TABLE IF NOT EXISTS art_image_figures (
          image_id INTEGER NOT NULL REFERENCES art_images(id) ON DELETE CASCADE,
          figure_id INTEGER NOT NULL REFERENCES art_figures(id) ON DELETE CASCADE,
          PRIMARY KEY (image_id, figure_id)
        );
        CREATE INDEX IF NOT EXISTS art_image_figures_figure ON art_image_figures (figure_id);
      `);
      const columns = new Set(db.prepare('PRAGMA table_info(art_images)').all().map(column => column.name));
      if (!columns.has('artist_name')) db.exec('ALTER TABLE art_images ADD COLUMN artist_name TEXT');
      if (!columns.has('artist_url')) db.exec('ALTER TABLE art_images ADD COLUMN artist_url TEXT');
      if (!columns.has('artist_by')) db.exec('ALTER TABLE art_images ADD COLUMN artist_by TEXT');
    }
  },
  {
    // Art: a picture nobody credited is credited to whoever posted it, by
    // their player name (Discord's name for someone without an account);
    // artist_by 'poster'. A name credited before keeps its first spelling.
    version: 48,
    up(db) {
      const key = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const known = new Map(db.prepare('SELECT DISTINCT artist_name FROM art_images WHERE artist_name IS NOT NULL').all()
        .map(row => [key(row.artist_name), row.artist_name]));
      const rows = db.prepare(`
        SELECT i.id, COALESCE(p.discord_tag, i.posted_by_tag) AS poster FROM art_images i
        LEFT JOIN players p ON p.discord_id = i.posted_by_discord_id
        WHERE i.artist_name IS NULL AND i.artist_by IS NULL
      `).all();
      const credit = db.prepare("UPDATE art_images SET artist_name = ?, artist_by = 'poster' WHERE id = ?");
      for (const row of rows) {
        const name = String(row.poster || '').replace(/\s+/g, ' ').trim();
        if (!name) continue;
        if (!known.has(key(name))) known.set(key(name), name);
        credit.run(known.get(key(name)), row.id);
      }
    }
  },
  {
    // Art: memes are a category of their own beside art and Not art
    // (is_meme; a picture is art, a meme, or not_art, never two).
    version: 49,
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(art_images)').all().map(column => column.name));
      if (!columns.has('is_meme')) db.exec('ALTER TABLE art_images ADD COLUMN is_meme INTEGER NOT NULL DEFAULT 0');
    }
  },
  {
    // Art editors (db/art.js): players, by Discord ID, who tag and sort the
    // Art tab as DMs do. The first two, as asked on 2026-11-23.
    version: 50,
    up(db) {
      db.prepare("INSERT INTO config (key, value) VALUES ('art_editors', ?) ON CONFLICT(key) DO NOTHING")
        .run(JSON.stringify(['1447629856870240471', '280626176341442570']));
    }
  },
  {
    // Art: reference material, a category of its own (is_reference), and
    // images uploaded in the panel rather than posted in Discord
    // (uploaded_by_player_id; their attachment and message ids start 'upload:').
    version: 51,
    up(db) {
      const columns = new Set(db.prepare('PRAGMA table_info(art_images)').all().map(column => column.name));
      if (!columns.has('is_reference')) db.exec('ALTER TABLE art_images ADD COLUMN is_reference INTEGER NOT NULL DEFAULT 0');
      if (!columns.has('uploaded_by_player_id')) db.exec('ALTER TABLE art_images ADD COLUMN uploaded_by_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL');
    }
  },
  {
    // Art: reference material has no adventure unless one was chosen for it
    // (a guessed or post-named one is dropped).
    version: 52,
    up(db) {
      db.exec(`UPDATE art_images SET adventure_id = NULL, adventure_by = 'none'
        WHERE is_reference = 1 AND (adventure_by IS NULL OR adventure_by IN ('guess', 'name'))`);
    }
  },
  {
    // Players (by Discord ID) who, with the Root DM, may grant any spell to a
    // character in sheet debug mode (db/spells.js). The first, as asked on 2026-11-23.
    version: 53,
    up(db) {
      db.prepare("INSERT INTO config (key, value) VALUES ('spell_granters', ?) ON CONFLICT(key) DO NOTHING")
        .run(JSON.stringify(['210398055516602369']));
    }
  },
  {
    // Gifts from Notable NPCs (a DM buys at Grimbold's as the NPC, shop.js):
    // from_character_id may be empty, from_npc_id says who, from_name keeps
    // the NPC's name for the ledger even if the NPC is deleted.
    version: 54,
    foreignKeysOff: true,
    up(db) {
      db.exec(`
        CREATE TABLE gifts_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
          from_npc_id INTEGER REFERENCES npcs(id) ON DELETE SET NULL,
          from_name TEXT,
          to_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          item_name TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 1,
          kind TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          given_by_player_id INTEGER,
          cost_cp INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO gifts_new (id, from_character_id, to_character_id, item_name, quantity, kind, note, given_by_player_id, cost_cp, created_at)
          SELECT id, from_character_id, to_character_id, item_name, quantity, kind, note, given_by_player_id, cost_cp, created_at FROM gifts;
        DROP TABLE gifts;
        ALTER TABLE gifts_new RENAME TO gifts;
        CREATE INDEX IF NOT EXISTS gifts_from ON gifts (from_character_id);
        CREATE INDEX IF NOT EXISTS gifts_to ON gifts (to_character_id);
      `);
    }
  },
  {
    // Legends (legends.js, db/legends.js): docs and art about characters that
    // have no sheet, read from their own two Discord channels and seen only by
    // the players listed in config 'legends_viewers' (and the Root DM). Kept
    // apart from character_docs and art_images so none of it reaches the
    // Chronicles or Art tabs. A doc or an image can be about several of them;
    // hidden = not about anyone (a meme, a stray link).
    version: 55,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS legend_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attachment_id TEXT NOT NULL UNIQUE,
          message_id TEXT NOT NULL,
          channel_id TEXT,
          guild_id TEXT,
          thread_name TEXT,
          posted_by_discord_id TEXT,
          posted_by_tag TEXT,
          posted_at TEXT,
          message_text TEXT,
          filename TEXT,
          width INTEGER,
          height INTEGER,
          file TEXT,
          thumb_file TEXT,
          download_error TEXT,
          tagged_by TEXT,
          artist_name TEXT,
          artist_url TEXT,
          hidden INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS legend_images_message ON legend_images (message_id);
        CREATE TABLE IF NOT EXISTS legend_characters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL UNIQUE,
          aliases TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          portrait_image_id INTEGER REFERENCES legend_images(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS legend_docs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_key TEXT NOT NULL UNIQUE,
          url TEXT NOT NULL,
          title TEXT,
          kind TEXT NOT NULL DEFAULT 'other',
          tagged_by TEXT,
          hidden INTEGER NOT NULL DEFAULT 0,
          channel_id TEXT,
          guild_id TEXT,
          message_id TEXT,
          posted_by_discord_id TEXT,
          posted_by_tag TEXT,
          posted_at TEXT,
          message_text TEXT,
          access TEXT NOT NULL DEFAULT 'unknown',
          saved_text TEXT,
          saved_html TEXT,
          saved_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS legend_doc_characters (
          doc_id INTEGER NOT NULL REFERENCES legend_docs(id) ON DELETE CASCADE,
          character_id INTEGER NOT NULL REFERENCES legend_characters(id) ON DELETE CASCADE,
          PRIMARY KEY (doc_id, character_id)
        );
        CREATE TABLE IF NOT EXISTS legend_image_characters (
          image_id INTEGER NOT NULL REFERENCES legend_images(id) ON DELETE CASCADE,
          character_id INTEGER NOT NULL REFERENCES legend_characters(id) ON DELETE CASCADE,
          PRIMARY KEY (image_id, character_id)
        );
      `);
      // The five who see the tab, as asked on 2026-11-25.
      db.prepare("INSERT INTO config (key, value) VALUES ('legends_viewers', ?) ON CONFLICT(key) DO NOTHING")
        .run(JSON.stringify(['210398055516602369', '1283501577893712003', '507671376371646464', '600030860950896670', '322015943075299330']));
      const add = db.prepare('INSERT OR IGNORE INTO legend_characters (name, name_key) VALUES (?, ?)');
      for (const name of ['Torak', 'Ilphas', 'Aidan', 'Eris', 'Opal', 'Kaala', 'Silv', 'Rankor']) add.run(name, name.toLowerCase());
    }
  }
];

function runMigrations(db) {
  const current = db.pragma('user_version', { simple: true });
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    // Foreign keys can only be switched off outside a transaction.
    const keysWereOn = migration.foreignKeysOff && db.pragma('foreign_keys', { simple: true });
    if (keysWereOn) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      })();
    } finally {
      if (keysWereOn) db.pragma('foreign_keys = ON');
    }
  }
}

module.exports = { MIGRATIONS, runMigrations };
