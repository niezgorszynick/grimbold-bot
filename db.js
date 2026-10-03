// db.js — SQLite layer using better-sqlite3
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);

// Wymuszenie kluczy obcych i trybu WAL dla wydajności
db.pragma('journal_mode = WAL');

// 1. Tabela rzutów kośćmi
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

// 2. Tabela przedmiotów w sklepie
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

// Przygotowane zapytania SQL
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
  deleteItem: db.prepare(`DELETE FROM items WHERE id = ?`)
};

module.exports = {
  // API dla rzutów
  hasRolledThisWeek: (userId, weekStart) => queries.getRoll.get(userId, weekStart),
  saveRoll: (userId, weekStart, rollValue) => queries.saveRoll.run(userId, weekStart, rollValue),

  // API dla sklepu
  getAllActiveItems: () => queries.getAllItems.all(),
  getAllItemsForAdmin: () => queries.getAllItemsAdmin.all(),
  findItemByName: (name) => queries.getItemByName.get(name),

  // Dodawanie z pełną walidacją
  addItem: ({ name, category, price, stock, description, is_active = 1 }) => {
    const trimmedName = (name || '').trim();
    const trimmedCategory = (category || '').trim();
    const trimmedDesc = (description || '').trim();
    const parsedPrice = parseInt(price, 10);
    const parsedStock = (stock === null || stock === '' || stock === undefined) ? null : parseInt(stock, 10);

    if (!trimmedName) throw new Error('Nazwa przedmiotu jest wymagana.');
    if (!trimmedCategory) throw new Error('Kategoria jest wymagana.');
    if (isNaN(parsedPrice) || parsedPrice < 0) throw new Error('Cena musi być poprawną liczbą >= 0.');
    if (parsedStock !== null && (isNaN(parsedStock) || parsedStock < 0)) {
      throw new Error('Ilość (stock) musi być liczbą >= 0 lub pusta (nielimitowana).');
    }
    if (!trimmedDesc) throw new Error('Opis przedmiotu jest wymagany.');

    return queries.insertItem.run({
      name: trimmedName,
      category: trimmedCategory,
      price: parsedPrice,
      stock: parsedStock,
      description: trimmedDesc,
      is_active: is_active ? 1 : 0
    });
  },

  // Aktualizacja stanu magazynowego (atomowy zakup w transakcji)
  purchaseItem: db.transaction((itemId, quantity) => {
    const item = db.prepare('SELECT stock FROM items WHERE id = ?').get(itemId);
    if (!item) throw new Error('Przedmiot nie istnieje.');
    if (item.stock !== null) {
      if (item.stock < quantity) {
        throw new Error(`Niewystarczający stan magazynowy: ${item.stock}`);
      }
      queries.updateStock.run(item.stock - quantity, itemId);
    }
    return true;
  }),

  setStock: (id, newStock) => queries.updateStock.run(newStock, id),
  setPrice: (id, newPrice) => queries.updatePrice.run(newPrice, id),
  setActive: (id, isActive) => queries.toggleActive.run(isActive ? 1 : 0, id),
  deleteItem: (id) => queries.deleteItem.run(id)
};