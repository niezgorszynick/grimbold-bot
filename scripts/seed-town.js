// scripts/seed-town.js — Loads the starter artisans (with their goods) and
// weekly shop events from scripts/town-templates.js into the database. Adds
// only what is missing: an artisan or event whose name already exists is left
// exactly as it is (edit it in the Restock Engine tab), so running it again is
// safe. New artisans' goods reach the shelf at the next restock.
//
// Usage (on the server, in /var/www/grimbold-bot):
//   node scripts/seed-town.js --dry-run   # shows what would be added
//   node scripts/seed-town.js             # adds it (data.sqlite, or DB_PATH)
// Back up the database first, as before any update.

'use strict';

const db = require('../db');
const { artisans, events } = require('./town-templates');

const dryRun = process.argv.includes('--dry-run');
const lower = text => String(text).trim().toLowerCase();

function seedTown({ dry = false } = {}) {
  const existingArtisans = new Map(db.listArtisans().map(artisan => [lower(artisan.name), artisan]));
  const existingEvents = new Set(db.listShopEvents().map(event => lower(event.title)));
  const report = { artisans: [], goods: 0, events: [], skipped: [] };

  db.db.transaction(() => {
    for (const artisan of artisans) {
      if (existingArtisans.has(lower(artisan.name))) {
        report.skipped.push(`artisan ${artisan.name}`);
        continue;
      }
      report.artisans.push(`${artisan.name} (${artisan.mode}, ${artisan.goods.length} goods)`);
      report.goods += artisan.goods.length;
      if (dry) continue;
      const id = db.saveArtisan({ name: artisan.name, description: artisan.description, mode: artisan.mode, active: true });
      existingArtisans.set(lower(artisan.name), { id, name: artisan.name, mode: artisan.mode });
      for (const good of artisan.goods) {
        db.saveArtisanGood({ artisan_id: id, name: good.name, category: good.category, price_gp: good.price_gp, description: good.description, per_week: good.per_week, cap: good.cap });
      }
    }

    for (const event of events) {
      if (existingEvents.has(lower(event.title))) {
        report.skipped.push(`event ${event.title}`);
        continue;
      }
      report.events.push(`${event.title} (${event.kind})`);
      if (dry) continue;
      const fields = { title: event.title, announcement: event.announcement, kind: event.kind, weight: event.weight || 1, active: true };
      if (event.kind === 'merchant') {
        fields.min_goods = event.min_goods || 1;
        fields.max_goods = event.max_goods || 3;
        if (event.artisan) {
          const artisan = existingArtisans.get(lower(event.artisan));
          if (!artisan) throw new Error(`Event "${event.title}" needs the travelling artisan ${event.artisan}.`);
          fields.artisan_id = artisan.id;
        } else {
          fields.goods = event.goods.join('\n');
        }
      } else if (event.kind === 'shortage') {
        fields.target = event.target;
      } else if (event.kind === 'sale') {
        fields.target = event.target;
        fields.percent = event.percent;
      }
      db.saveShopEvent(fields);
    }
  })();
  return report;
}

module.exports = { seedTown };

if (require.main === module) {
  const report = seedTown({ dry: dryRun });
  const list = items => (items.length ? items.map(item => `  + ${item}`).join('\n') : '  (none)');
  console.log(`${dryRun ? 'Would add' : 'Added'} artisans:\n${list(report.artisans)}`);
  console.log(`${dryRun ? 'Would add' : 'Added'} ${report.goods} artisan goods.`);
  console.log(`${dryRun ? 'Would add' : 'Added'} weekly events:\n${list(report.events)}`);
  if (report.skipped.length) console.log(`Already there (left as they are):\n${report.skipped.map(item => `  = ${item}`).join('\n')}`);
  if (!dryRun) console.log('Artisan goods reach the shelf at the next restock (or "Run restock now" in the Restock Engine tab).');
}
