// db.js — SQLite layer using better-sqlite3
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// 1. Tabela rzutów
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

// Bezpieczne dodanie kolumny username do rolls, jeśli jeszcze nie istnieje
const rollsColumns = db.prepare("PRAGMA table_info(rolls)").all();
if (!rollsColumns.some(col => col.name === 'username')) {
  db.exec("ALTER TABLE rolls ADD COLUMN username TEXT;");
}

// 2. Tabela przedmiotów
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

// 3. Tabela historii sprzedaży (odpowiednik arkusza Sales)
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

// 4. Stwórz catalog przedmiotów
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

// 5. Stwórz tabele dla graczy i ich postaci
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  );
`);

// 6. Tabela przygód
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

// 6.1. Bezpieczna migracja kolumn w tabeli players
const playerCols = db.prepare("PRAGMA table_info(players)").all().map(c => c.name);
if (!playerCols.includes('dm_points')) {
  db.exec("ALTER TABLE players ADD COLUMN dm_points INTEGER NOT NULL DEFAULT 0;");
}

// 6.2. Bezpieczna migracja kolumn w tabeli characters
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

// Funkcja pomocnicza: Obliczanie poziomu na podstawie punktów przygód
function calculateLevelFromXp(xp) {
  const points = Math.max(0, parseInt(xp, 10) || 0);
  if (points < 3) return 3;
  return Math.min(20, 4 + Math.floor((points - 3) / 4));
}

const queries = {
  // Rolls
  getRoll: db.prepare(`SELECT * FROM rolls WHERE user_id = ? AND week_start = ?`),
 saveRoll: db.prepare(`
    INSERT INTO rolls (user_id, username, week_start, roll_value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, week_start) DO UPDATE SET 
      roll_value = excluded.roll_value,
      username = excluded.username
  `),

  // Items
  getAllItems: db.prepare(`SELECT * FROM items WHERE is_active = 1 ORDER BY category, name`),
  getAllItemsAdmin: db.prepare(`SELECT * FROM items ORDER BY category, name`),
  getItemByName: db.prepare(`SELECT * FROM items WHERE name = ? COLLATE NOCASE AND is_active = 1`),
  
  insertItem: db.prepare(`
    INSERT INTO items (name, category, price, stock, description, is_active)
    VALUES (@name, @category, @price, @stock, @description, @is_active)
  `),

  updateStock: db.prepare(`UPDATE items SET stock = ? WHERE id = ?`),
  updatePrice: db.prepare(`UPDATE items SET price = ? WHERE id = ?`),
  toggleActive: db.prepare(`UPDATE items SET is_active = ? WHERE id = ?`),
  deleteItem: db.prepare(`DELETE FROM items WHERE id = ?`),

  // Sales
  insertSale: db.prepare(`
    INSERT INTO sales (item_name, category, quantity, buyer_tag, buyer_id, base_price, discount_percent, final_price, total_paid)
    VALUES (@item_name, @category, @quantity, @buyer_tag, @buyer_id, @base_price, @discount_percent, @final_price, @total_paid)
  `)
};

module.exports = {
  calculateLevelFromXp,

  // Postacie z rasą, podklasą i automatycznym poziomem
  addCharacter: ({ player_id, name, race, class_name, subclass = '', xp = 0, status = 'alive' }) => {
    const pId = parseInt(player_id, 10);
    const trimmedName = (name || '').trim();
    const trimmedRace = (race || '').trim();
    const trimmedClass = (class_name || '').trim();
    const trimmedSubclass = (subclass || '').trim();
    const parsedXp = Math.max(0, parseInt(xp, 10) || 0);
    const calculatedLevel = calculateLevelFromXp(parsedXp);

    if (isNaN(pId)) throw new Error('Wybierz prawidłowego gracza.');
    if (!trimmedName) throw new Error('Nazwa postaci jest wymagana.');
    if (!trimmedRace) throw new Error('Rasa postaci jest wymagana.');
    if (!trimmedClass) throw new Error('Klasa postaci jest wymagana.');

    return db.prepare(`
      INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pId, trimmedName, trimmedRace, trimmedClass, trimmedSubclass, calculatedLevel, parsedXp, status);
  },

  updateCharacter: ({ id, player_id, name, race, class_name, subclass, xp, status }) => {
    const cId = parseInt(id, 10);
    const pId = parseInt(player_id, 10);
    const trimmedName = (name || '').trim();
    const trimmedRace = (race || '').trim();
    const trimmedClass = (class_name || '').trim();
    const trimmedSubclass = (subclass || '').trim();
    const parsedXp = Math.max(0, parseInt(xp, 10) || 0);
    const calculatedLevel = calculateLevelFromXp(parsedXp);

    return db.prepare(`
      UPDATE characters
      SET player_id = ?, name = ?, race = ?, class = ?, subclass = ?, level = ?, xp = ?, status = ?
      WHERE id = ?
    `).run(pId, trimmedName, trimmedRace, trimmedClass, trimmedSubclass, calculatedLevel, parsedXp, status, cId);
  },

  // Przypisanie 1 punktu DM do wybranej postaci
  assignDmPointToCharacter: (playerId, characterId) => {
    const run = db.transaction(() => {
      const player = db.prepare('SELECT dm_points FROM players WHERE id = ?').get(playerId);
      if (!player || player.dm_points < 1) {
        throw new Error('Gracz nie posiada punktów DM do wykorzystania.');
      }
      const char = db.prepare('SELECT id, xp FROM characters WHERE id = ? AND player_id = ?').get(characterId, playerId);
      if (!char) {
        throw new Error('Wybrana postać nie należy do tego gracza.');
      }

      const newXp = char.xp + 1;
      const newLevel = calculateLevelFromXp(newXp);

      db.prepare('UPDATE players SET dm_points = dm_points - 1 WHERE id = ?').run(playerId);
      db.prepare('UPDATE characters SET xp = ?, level = ? WHERE id = ?').run(newXp, newLevel, characterId);
    });
    return run();
  },

  // Obsługa przygód
  getAllAdventures: () => db.prepare(`
    SELECT a.*, p.discord_tag AS dm_name 
    FROM adventures a
    LEFT JOIN players p ON a.dm_player_id = p.id
    ORDER BY a.created_at DESC
  `).all(),

  recordAdventure: ({ title, description, xp_awarded, dm_player_id, character_ids }) => {
    const run = db.transaction(() => {
      const xp = Math.max(1, parseInt(xp_awarded, 10) || 1);
      const insertAdv = db.prepare(`
        INSERT INTO adventures (title, description, xp_awarded, dm_player_id)
        VALUES (?, ?, ?, ?)
      `).run(title, description, xp, dm_player_id || null);

      const adventureId = insertAdv.lastInsertRowid;

      // Przyznanie XP uczestnikom
      if (Array.isArray(character_ids)) {
        for (const charId of character_ids) {
          db.prepare(`
            INSERT INTO adventure_rewards (adventure_id, character_id, xp)
            VALUES (?, ?, ?)
          `).run(adventureId, charId, xp);

          const char = db.prepare('SELECT xp FROM characters WHERE id = ?').get(charId);
          if (char) {
            const nextXp = char.xp + xp;
            const nextLevel = calculateLevelFromXp(nextXp);
            db.prepare('UPDATE characters SET xp = ?, level = ? WHERE id = ?').run(nextXp, nextLevel, charId);
          }
        }
      }

      // Przyznanie 1 punktu DM dla prowadzącego
      if (dm_player_id) {
        db.prepare('UPDATE players SET dm_points = dm_points + 1 WHERE id = ?').run(dm_player_id);
      }
    });
    return run();
  },
  
  //Bezpośredni dostęp do bazy dla skryptów (seed, restock, maintenance)
  db,
  prepare: (sql) => db.prepare(sql),
  transaction: (fn) => db.transaction(fn),

  addCatalogItem: ({ name, category, tier, base_price_cp, description, min_level, min_stock, max_stock }) => {
      const trimmedName = (name || '').trim();
      const trimmedCat = (category || '').trim();
      const trimmedDesc = (description || '').trim();
      const validTiers = ['staple', 'common', 'rare', 'magic', 'service'];

      if (!trimmedName) throw new Error('Item name is required.');
      if (!trimmedCat) throw new Error('Category is required.');
      if (!validTiers.includes(tier)) throw new Error(`Invalid tier selected: ${tier}`);
      
      const parsedPriceCp = parseInt(base_price_cp, 10);
      if (isNaN(parsedPriceCp) || parsedPriceCp < 0) throw new Error('Base price (in CP) must be a non-negative integer.');

      const parsedMinLevel = parseInt(min_level, 10);
      if (isNaN(parsedMinLevel) || parsedMinLevel < 1 || parsedMinLevel > 20) {
        throw new Error('Minimum party level must be between 1 and 20.');
      }

      const parsedMinStock = parseInt(min_stock, 10);
      const parsedMaxStock = parseInt(max_stock, 10);
      if (isNaN(parsedMinStock) || parsedMinStock < 0) throw new Error('Minimum stock must be a non-negative number.');
      if (isNaN(parsedMaxStock) || parsedMaxStock < parsedMinStock) {
        throw new Error('Maximum stock must be greater than or equal to minimum stock.');
      }
      if (!trimmedDesc) throw new Error('Description is required.');

      // Sprawdzenie unikalności nazwy
      const existing = db.prepare('SELECT id FROM catalog WHERE name = ? COLLATE NOCASE').get(trimmedName);
      if (existing) {
        throw new Error(`An item named "${trimmedName}" already exists in the Master Catalog (ID: ${existing.id}).`);
      }

      const stmt = db.prepare(`
        INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      return stmt.run(
        trimmedName,
        trimmedCat,
        tier,
        parsedPriceCp,
        trimmedDesc,
        parsedMinLevel,
        parsedMinStock,
        parsedMaxStock
      );
    },

  //getPartyLevel - w przyszłości ma dostosować katalog przedmiotów do poziomu party
  getPartyLevel: () => {
    const row = db.prepare("SELECT value FROM config WHERE key = 'party_level'").get();
    return row ? parseInt(row.value, 10) : 1;
  },
  setPartyLevel: (level) => {
    return db.prepare("INSERT INTO config (key, value) VALUES ('party_level', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(level));
  },
  getCatalogItemsByLevel: (maxLevel) => {
    return db.prepare("SELECT * FROM catalog WHERE min_level <= ?").all(maxLevel);
  },
  
  // Rolls
  hasRolledThisWeek: (userId, weekStart) => queries.getRoll.get(userId, weekStart),
  saveRoll: (userId, username, weekStart, rollValue) => queries.saveRoll.run(userId, username, weekStart, rollValue),

  // Items
  getAllActiveItems: () => queries.getAllItems.all(),
  getAllItemsForAdmin: () => queries.getAllItemsAdmin.all(),
  findItemByName: (name) => queries.getItemByName.get(name),

 // ─── MASTER CATALOG & SYNCHRONIZACJA Z LADĄ (ITEMS) ───────────────────────

  // Pobranie pojedynczego wpisu z katalogu po ID
  getCatalogItemById: (id) => {
    return db.prepare('SELECT * FROM catalog WHERE id = ?').get(parseInt(id, 10));
  },

  // Aktualizacja pozycji w catalog wraz z natychmiastową synchronizacją items
  updateCatalogItem: db.transaction(({ id, name, category, tier, base_price_cp, description, min_level, min_stock, max_stock }) => {
    const trimmedName = (name || '').trim();
    const trimmedCat = (category || '').trim();
    const trimmedDesc = (description || '').trim();
    const validTiers = ['staple', 'common', 'rare', 'magic', 'service'];

    if (!trimmedName) throw new Error('Catalog item name is required.');
    if (!trimmedCat) throw new Error('Category is required.');
    if (!validTiers.includes(tier)) throw new Error(`Invalid tier: ${tier}`);
    if (isNaN(base_price_cp) || base_price_cp < 0) throw new Error('Base price (cp) must be >= 0.');
    if (isNaN(min_level) || min_level < 1) throw new Error('Min level must be >= 1.');
    if (isNaN(min_stock) || min_stock < 0) throw new Error('Min stock must be >= 0.');
    if (isNaN(max_stock) || max_stock < min_stock) throw new Error('Max stock must be >= min stock.');
    if (!trimmedDesc) throw new Error('Description is required.');

    // 1. Sprawdzamy starą nazwę w katalogu, aby znaleźć powiązany rekord w items
    const oldItem = db.prepare('SELECT name FROM catalog WHERE id = ?').get(parseInt(id, 10));
    if (!oldItem) throw new Error('Catalog item not found.');

    // 2. Aktualizujemy Master Catalog
    db.prepare(`
      UPDATE catalog
      SET name = ?,
          category = ?,
          tier = ?,
          base_price_cp = ?,
          description = ?,
          min_level = ?,
          min_stock = ?,
          max_stock = ?
      WHERE id = ?
    `).run(
      trimmedName,
      trimmedCat,
      tier,
      parseInt(base_price_cp, 10),
      trimmedDesc,
      parseInt(min_level, 10),
      parseInt(min_stock, 10),
      parseInt(max_stock, 10),
      parseInt(id, 10)
    );

    // 3. Jeśli przedmiot znajduje się obecnie na ladzie (tabela items), synchronizujemy go od razu
    const shelfItem = db.prepare('SELECT id FROM items WHERE name = ? COLLATE NOCASE').get(oldItem.name);
    if (shelfItem) {
      const newPriceGp = Math.max(1, Math.round(parseInt(base_price_cp, 10) / 100));
      db.prepare(`
        UPDATE items
        SET name = ?,
            category = ?,
            price = ?,
            description = ?
        WHERE id = ?
      `).run(
        trimmedName,
        trimmedCat,
        newPriceGp,
        trimmedDesc,
        shelfItem.id
      );
    }
  }),

  // Usunięcie z katalogu wraz z wyczyszczeniem z lady sklepowej
  deleteCatalogItem: db.transaction((id) => {
    const item = db.prepare('SELECT name FROM catalog WHERE id = ?').get(parseInt(id, 10));
    if (item) {
      db.prepare('DELETE FROM items WHERE name = ? COLLATE NOCASE').run(item.name);
      db.prepare('DELETE FROM catalog WHERE id = ?').run(parseInt(id, 10));
    }
  }),
  
// ─── RESTOCK ENGINE CONFIG ───────────────────────────────────────────────
  getRestockConfig: () => {
    const rows = db.prepare("SELECT key, value FROM config WHERE key LIKE 'restock_%' OR key LIKE 'fluctuation_%' OR key = 'party_level'").all();
    const configMap = {};
    for (const r of rows) {
      configMap[r.key] = r.value;
    }
    return {
      party_level: parseInt(configMap['party_level'], 10) || 3,
      commons_count: parseInt(configMap['restock_commons_count'], 10) || 10,
      cantrips_count: parseInt(configMap['restock_cantrips_count'], 10) || 2,
      lvl1_count: parseInt(configMap['restock_lvl1_count'], 10) || 2,
      rares_count: parseInt(configMap['restock_rares_count'], 10) || 2,
      magics_count: parseInt(configMap['restock_magics_count'], 10) || 1,
      fluctuation_min: parseFloat(configMap['fluctuation_min']) || 0.85,
      fluctuation_max: parseFloat(configMap['fluctuation_max']) || 1.15
    };
  },

  setRestockConfig: ({ party_level, commons_count, cantrips_count, lvl1_count, rares_count, magics_count, fluctuation_min, fluctuation_max }) => {
    const upsert = db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const runAll = db.transaction(() => {
      upsert.run('party_level', String(party_level));
      upsert.run('restock_commons_count', String(commons_count));
      upsert.run('restock_cantrips_count', String(cantrips_count));
      upsert.run('restock_lvl1_count', String(lvl1_count));
      upsert.run('restock_rares_count', String(rares_count));
      upsert.run('restock_magics_count', String(magics_count));
      upsert.run('fluctuation_min', String(fluctuation_min));
      upsert.run('fluctuation_max', String(fluctuation_max));
    });
    runAll();
  },

  // ─── ZARZĄDZANIE ASORTYMENTEM SKLEPU (ITEMS) ──────────────────────────────

  addItem: ({ name, category, price, stock, description, is_active = 1 }) => {
    const trimmedName = (name || '').trim();
    const trimmedCategory = (category || '').trim();
    const trimmedDesc = (description || '').trim();
    const parsedPrice = parseInt(price, 10);
    const parsedStock = (stock === null || stock === '' || stock === undefined) ? null : parseInt(stock, 10);

    if (!trimmedName) throw new Error('Item name is required.');
    if (!trimmedCategory) throw new Error('Category is required.');
    if (isNaN(parsedPrice) || parsedPrice < 0) throw new Error('Price must be a valid number >= 0.');
    if (parsedStock !== null && (isNaN(parsedStock) || parsedStock < 0)) {
      throw new Error('Stock must be a number >= 0 or left blank for unlimited.');
    }
    if (!trimmedDesc) throw new Error('Description is required.');

    return queries.insertItem.run({
      name: trimmedName,
      category: trimmedCategory,
      price: parsedPrice,
      stock: parsedStock,
      description: trimmedDesc,
      is_active: is_active ? 1 : 0
    });
  },

  // Transakcja zakupu: weryfikacja magazynu + odliczenie + zapis do rejestru sprzedaży
  purchaseItemTransaction: db.transaction((itemId, quantity, saleData) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) throw new Error('ITEM_NOT_FOUND');

    if (item.stock !== null) {
      if (item.stock < quantity) {
        throw new Error(`INSUFFICIENT_STOCK:${item.stock}`);
      }
      queries.updateStock.run(item.stock - quantity, itemId);
    }

    queries.insertSale.run(saleData);
    return item;
  }),

  setStock: (id, newStock) => queries.updateStock.run(newStock, id),
  setPrice: (id, newPrice) => queries.updatePrice.run(newPrice, id),
  setActive: (id, isActive) => queries.toggleActive.run(isActive ? 1 : 0, id),
  deleteItem: (id) => queries.deleteItem.run(id),

  // ─── PLAYERS & CHARACTERS ────────────────────────────────────────────────
  getAllPlayersWithCharacters: () => {
    return db.prepare(`
      SELECT 
        p.id AS player_id,
        p.discord_id,
        p.discord_tag,
        c.id AS character_id,
        c.name AS character_name,
        c.class AS character_class,
        c.level AS character_level,
        c.status AS character_status
      FROM players p
      LEFT JOIN characters c ON p.id = c.player_id
      ORDER BY p.discord_tag ASC, c.name ASC
    `).all();
  },

  getAllPlayers: () => db.prepare('SELECT * FROM players ORDER BY discord_tag ASC').all(),
  
  getCharacterById: (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id),

  addPlayer: ({ discord_id, discord_tag }) => {
    const trimmedId = (discord_id || '').trim();
    const trimmedTag = (discord_tag || '').trim();
    if (!trimmedId) throw new Error('Discord ID is required.');
    if (!trimmedTag) throw new Error('Discord Tag/Username is required.');

    const existing = db.prepare('SELECT id FROM players WHERE discord_id = ?').get(trimmedId);
    if (existing) throw new Error(`Player with Discord ID "${trimmedId}" already exists.`);

    return db.prepare('INSERT INTO players (discord_id, discord_tag) VALUES (?, ?)').run(trimmedId, trimmedTag);
  },

  updatePlayer: ({ id, discord_id, discord_tag }) => {
    const trimmedId = (discord_id || '').trim();
    const trimmedTag = (discord_tag || '').trim();
    if (!trimmedId || !trimmedTag) throw new Error('Both Discord ID and Tag are required.');

    const existing = db.prepare('SELECT id FROM players WHERE discord_id = ? AND id != ?').get(trimmedId, id);
    if (existing) throw new Error(`Another player already uses Discord ID "${trimmedId}".`);

    return db.prepare('UPDATE players SET discord_id = ?, discord_tag = ? WHERE id = ?').run(trimmedId, trimmedTag, id);
  },

  deletePlayer: (id) => {
    return db.prepare('DELETE FROM players WHERE id = ?').run(id);
  },

  addCharacter: ({ player_id, name, class_name, level, status = 'alive' }) => {
    const pId = parseInt(player_id, 10);
    const trimmedName = (name || '').trim();
    const trimmedClass = (class_name || '').trim();
    const pLevel = parseInt(level, 10);

    if (isNaN(pId)) throw new Error('Valid player must be selected.');
    if (!trimmedName) throw new Error('Character name is required.');
    if (!trimmedClass) throw new Error('Character class is required.');
    if (isNaN(pLevel) || pLevel < 1 || pLevel > 20) throw new Error('Level must be between 1 and 20.');
    if (!['alive', 'dead'].includes(status)) throw new Error('Status must be alive or dead.');

    return db.prepare(`
      INSERT INTO characters (player_id, name, class, level, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(pId, trimmedName, trimmedClass, pLevel, status);
  },

  updateCharacter: ({ id, player_id, name, class_name, level, status }) => {
    const cId = parseInt(id, 10);
    const pId = parseInt(player_id, 10);
    const trimmedName = (name || '').trim();
    const trimmedClass = (class_name || '').trim();
    const pLevel = parseInt(level, 10);

    if (isNaN(cId)) throw new Error('Invalid character ID.');
    if (isNaN(pId)) throw new Error('Valid player must be selected.');
    if (!trimmedName) throw new Error('Character name is required.');
    if (!trimmedClass) throw new Error('Character class is required.');
    if (isNaN(pLevel) || pLevel < 1 || pLevel > 20) throw new Error('Level must be between 1 and 20.');
    if (!['alive', 'dead'].includes(status)) throw new Error('Status must be alive or dead.');

    return db.prepare(`
      UPDATE characters
      SET player_id = ?, name = ?, class = ?, level = ?, status = ?
      WHERE id = ?
    `).run(pId, trimmedName, trimmedClass, pLevel, status, cId);
  },

  deleteCharacter: (id) => {
    return db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  },

  // ─── POBIERANIE DANYCH DO PANELU DM ───────────────────────────────────────

  getAllCatalogItems: () => db.prepare('SELECT * FROM catalog ORDER BY name ASC').all(),
  getAllSales: () => db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 100').all(),
  getAllRolls: () => db.prepare(`
    SELECT 
      r.id,
      r.user_id,
      COALESCE(r.username, s.buyer_tag, r.user_id) AS display_name,
      r.week_start,
      r.roll_value,
      r.created_at
    FROM rolls r
    LEFT JOIN (
      SELECT buyer_id, buyer_tag 
      FROM sales 
      GROUP BY buyer_id
    ) s ON r.user_id = s.buyer_id
    ORDER BY r.week_start DESC, r.created_at DESC 
    LIMIT 100
  `).all(),

  // Eksport instancji bazy dla zewnętrznych skryptów
  db,
  prepare: (sql) => db.prepare(sql),
  transaction: (fn) => db.transaction(fn)

};