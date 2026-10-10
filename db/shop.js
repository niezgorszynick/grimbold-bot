// db/shop.js — Shop data: counter items, master catalog, weekly rolls, sales and restock settings.

'use strict';

const { db } = require('./connection');

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
  deleteItem: db.prepare(`DELETE FROM items WHERE id = ?`)
};

module.exports = {
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

      // Names must be unique
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
  // Party level, used to filter the catalog by min_level
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
  // Pobranie pojedynczego wpisu z katalogu po ID
  getCatalogItemById: (id) => {
    return db.prepare('SELECT * FROM catalog WHERE id = ?').get(parseInt(id, 10));
  },
  // Update a catalog entry and sync it to the counter (items) immediately
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

    // 1. Look up the old name to find the matching counter item
    const oldItem = db.prepare('SELECT name FROM catalog WHERE id = ?').get(parseInt(id, 10));
    if (!oldItem) throw new Error('Catalog item not found.');

    // 2. Update the master catalog
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

    // 3. If the item is currently on the counter (items), sync it now
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
  // Delete from the catalog and remove it from the counter
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
setStock: (id, newStock) => queries.updateStock.run(newStock, id),
setPrice: (id, newPrice) => queries.updatePrice.run(newPrice, id),
setActive: (id, isActive) => queries.toggleActive.run(isActive ? 1 : 0, id),
deleteItem: (id) => queries.deleteItem.run(id),
getAllCatalogItems: () => db.prepare('SELECT * FROM catalog ORDER BY name ASC').all(),
getAllSales: () => db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 100').all(),
getAllRolls: () => db.prepare(`
    SELECT 
      r.id,
      r.user_id,
      COALESCE(p.discord_tag, r.username, s.buyer_tag, r.user_id) AS display_name,
      r.week_start,
      r.roll_value,
      r.created_at
    FROM rolls r
    LEFT JOIN players p ON p.discord_id = r.user_id
    LEFT JOIN (
      SELECT buyer_id, buyer_tag 
      FROM sales 
      GROUP BY buyer_id
    ) s ON r.user_id = s.buyer_id
    ORDER BY r.week_start DESC, r.created_at DESC 
    LIMIT 100
  `).all()
};
