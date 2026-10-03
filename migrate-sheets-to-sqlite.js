// migrate-sheets-to-sqlite.js — jednorazowy import danych z Sheets do SQLite
require('dotenv').config();
const { getShopInventory } = require('./sheets');
const db = require('./db');

async function migrate() {
  console.log('🔄 Pobieram dane z Google Sheets...');
  try {
    const items = await getShopInventory();
    console.log(`📦 Znaleziono ${items.length} pozycji w arkuszu. Rozpoczynam zapis do bazy...`);

    let imported = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        db.addItem({
          name: item.name,
          category: item.category || 'Inne',
          price: item.price,
          stock: item.stock,
          description: item.description || 'Brak opisu',
          is_active: 1
        });
        imported++;
      } catch (err) {
        console.warn(`⚠️ Pominięto/Błąd przy "${item.name}":`, err.message);
        skipped++;
      }
    }

    console.log(`\n Migracja zakończona sukcesem!`);
    console.log(` Zaimportowano: ${imported}`);
    console.log(` Pominięto: ${skipped}`);
  } catch (error) {
    console.error('❌ Błąd krytyczny migracji:', error);
  }
}

migrate();