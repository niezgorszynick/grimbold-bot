// restock.js — weekly store restock and price fluctuation
const dbModule = require('./db');
// Instancja bazy SQLite z better-sqlite3:
const sqlite = dbModule.db || dbModule;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateFluctuatedPriceCp(basePriceCp) {
  // Wahanie od 0.85 do 1.15
  const factor = 0.85 + Math.random() * 0.30;
  return Math.max(1, Math.round(basePriceCp * factor));
}

function pickRandom(array, count) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function restockShop() {
  // 1. Pobieramy party level
  const partyLevel = typeof dbModule.getPartyLevel === 'function'
    ? dbModule.getPartyLevel()
    : 3;

  // 2. Pobieramy przedmioty z katalogu dla danego poziomu
  const pool = typeof dbModule.getCatalogItemsByLevel === 'function'
    ? dbModule.getCatalogItemsByLevel(partyLevel)
    : sqlite.prepare('SELECT * FROM catalog WHERE min_level <= ?').all(partyLevel);

  const staples = pool.filter(i => i.tier === 'staple');
  const commons = pool.filter(i => i.tier === 'common');
  const rares = pool.filter(i => i.tier === 'rare');
  const magics = pool.filter(i => i.tier === 'magic');

  const selectedStaples = staples;
  const selectedCommons = pickRandom(commons, 10);
  const selectedRares = pickRandom(rares, 2);   // Dokładnie 2 rare
  const selectedMagics = pickRandom(magics, 1); // Dokładnie 1 magic

  const newWeeklySelection = [
    ...selectedStaples,
    ...selectedCommons,
    ...selectedRares,
    ...selectedMagics
  ];

  // 3. Atomowe czyszczenie i zatowarowanie items
  const updateStore = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM items').run();

    const insertItem = sqlite.prepare(`
      INSERT INTO items (name, category, price, stock, description, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    for (const item of newWeeklySelection) {
      const stock = randomInt(item.min_stock, item.max_stock);
      const priceCp = item.tier === 'staple'
        ? item.base_price_cp
        : calculateFluctuatedPriceCp(item.base_price_cp);

      // Konwersja z cp na gp dla kolumny price w items (min. 1 gp)
      const priceGp = Math.max(1, Math.round(priceCp / 100));

      insertItem.run(
        item.name,
        item.category,
        priceGp,
        stock,
        item.description
      );
    }
  });

  updateStore();
  console.log(`🛒 Restock zakończony sukcesem! Wystawiono ${newWeeklySelection.length} pozycji (Party Level: ${partyLevel}).`);
}

module.exports = { restockShop };

if (require.main === module) {
  restockShop();
}