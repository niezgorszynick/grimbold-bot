// migrate-sheets-to-sqlite.js — jednorazowy import danych z Sheets do SQLite
require('dotenv').config();
const { initSheets, getItems } = require('./sheets');
const db = require('./db');

async function migrate() {
  console.log('🔄 Łączenie z Google Sheets API...');
  try {
    // 1. Inicjalizacja klienta Google Sheets
    await initSheets();

    console.log('🔄 Pobieram dane z arkusza...');
    const items = await getItems();
    console.log(`📦 Znaleziono ${items.length} pozycji w arkuszu. Zapisuję do SQLite...`);

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

    console.log(`\n🎉 Migracja zakończona sukcesem!`);
    console.log(`✅ Zaimportowano: ${imported}`);
    console.log(`⚠️ Pominięto: ${skipped}`);

    // Sprawdzenie stanu bazy
    const total = db.getAllActiveItems();
    console.log(`🔍 Łącznie w SQLite (tabela items): ${total.length} aktywnych przedmiotów.`);

  } catch (error) {
    console.error('❌ Błąd krytyczny migracji:', error);
  }
}

migrate();