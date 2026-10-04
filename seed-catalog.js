// seed-catalog.js — zasilenie katalogu wzorcowego z pliku CSV
const fs = require('fs');
const path = require('path');
const dbModule = require('./db');
const db = dbModule.db || dbModule;
const { parsePriceToCp } = require('./currency');

function determineTierAndLevel(name, category, priceCp) {
  const n = name.toLowerCase();
  const cat = category.toLowerCase();
  const gp = priceCp / 100;

  // Staple items (ograniczone zasoby, ale zawsze obecne)
  if (n === 'potion of healing') {
    return { tier: 'staple', min_level: 1, min_stock: 2, max_stock: 4 };
  }
  if (['rations', 'torch', 'waterskin', 'rope (50 feet)', "healer's kit", 'arrows (20)', 'crossbow, bolts (20)'].includes(n)) {
    return { tier: 'staple', min_level: 1, min_stock: 2, max_stock: 5 };
  }

  // Services & lodging
  if (cat.includes('food') || cat.includes('services') || cat.includes('transportation')) {
    return { tier: 'service', min_level: 1, min_stock: 1, max_stock: 5 };
  }

  // Magic items (Grimbold's Vault)
  if (
    n.includes('+1') || n.includes('resistance') || n.includes('mithral') ||
    cat === 'wondrous' || cat === 'ring' || cat === 'wand' ||
    n.includes('superior healing') || n.includes('speed') || n.includes('heroism') ||
    n.includes('hill giant') || n.includes('scintillating')
  ) {
    const minLvl = gp > 2000 ? 7 : 4;
    return { tier: 'magic', min_level: minLvl, min_stock: 1, max_stock: 1 };
  }

  // Rare items (ciężkie pancerze, zaawansowana alchemia, zwoje, droższa broń palna)
  if (
    n === 'plate armor' || n === 'half plate armor' || n === 'breastplate' ||
    n === 'potion of greater healing' || cat === 'scroll' || cat === 'gemstone' ||
    n.includes('poison') || n.includes("alchemist's fire") || n.includes('acid') ||
    n.includes('musket') || n.includes('pistol')
  ) {
    const minLvl = gp > 500 ? 5 : 3;
    return { tier: 'rare', min_level: minLvl, min_stock: 1, max_stock: 2 };
  }

  // Common: standardowy rynsztunek
  return { tier: 'common', min_level: 1, min_stock: 1, max_stock: 3 };
}

function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function seed() {
  const csvPath = path.join(__dirname, 'Catalogue.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Nie znaleziono pliku CSV w ${csvPath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(l => l.trim().length > 0);
  console.log(`Znaleziono ${lines.length - 1} wierszy w pliku CSV.`);

  const insertStmt = db.prepare(`
    INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      category = excluded.category,
      tier = excluded.tier,
      base_price_cp = excluded.base_price_cp,
      description = excluded.description,
      min_level = excluded.min_level,
      min_stock = excluded.min_stock,
      max_stock = excluded.max_stock
  `);

  let count = 0;
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const parts = parseCSVLine(row);
      if (parts.length < 4) continue;
      const [name, description, rawPrice, category] = parts;
      if (!name || name === 'Name') continue;

      const priceCp = parsePriceToCp(rawPrice);
      const meta = determineTierAndLevel(name, category, priceCp);

      insertStmt.run(
        name,
        category || 'Adventuring Gear',
        meta.tier,
        priceCp,
        description || 'A fine item from Grimbold.',
        meta.min_level,
        meta.min_stock,
        meta.max_stock
      );
      count++;
    }
  });

  insertMany(lines.slice(1));
  console.log(`✅ Zaimportowano i zmapowano ${count} przedmiotów w tabeli catalog.`);
}

seed();