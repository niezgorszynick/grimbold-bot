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

const queries = {
  // Rolls
  getRoll: db.prepare(`SELECT * FROM rolls WHERE user_id = ? AND week_start = ?`),
  saveRoll: db.prepare(`
    INSERT INTO rolls (user_id, week_start, roll_value)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, week_start) DO UPDATE SET roll_value = excluded.roll_value
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
  saveRoll: (userId, weekStart, rollValue) => queries.saveRoll.run(userId, weekStart, rollValue),

  // Items
  getAllActiveItems: () => queries.getAllItems.all(),
  getAllItemsForAdmin: () => queries.getAllItemsAdmin.all(),
  findItemByName: (name) => queries.getItemByName.get(name),

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
  deleteItem: (id) => queries.deleteItem.run(id)
};