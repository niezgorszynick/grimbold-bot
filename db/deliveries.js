// db/deliveries.js — Resident artisans with their own delivery window
// (db/artisans.js) deliver once a week, at a moment picked at random inside it.
// deliverDueArtisans runs every few minutes in the bot (artisanDeliveries.js):
// each artisan whose moment has come adds their goods' weekly amount, up to
// each cap, like the restock would, plus their random magic items (a pawn
// shop, up to its cap), and gets next week's moment. The week's
// sale on artisan goods or category shortage (the last restock's event) still
// applies to what they bring.

'use strict';

const { db } = require('./connection');
const { weekStart, pickDeliveryTime } = require('../rules/deliveryWindow');
const { artisanDeliveryWindow, nextArtisanDeliveryAt } = require('./artisans');
const { shopRoundPrice, drawArtisanMagic, readRestockConfig, restockPartyLevel } = require('./restock');

// The last restock's sale or shortage, if that restock was this week.
function thisWeeksEvent(now) {
  try {
    const event = JSON.parse((db.prepare("SELECT value FROM config WHERE key = 'last_shop_event'").get() || {}).value || 'null');
    return event && event.kind && new Date(event.at) >= weekStart(now) ? event : null;
  } catch {
    return null;
  }
}

// What one artisan's goods do to the shelf. shelf: items rows; heldIds: reserved
// item ids; event: this week's event or null. Returns [{ good, existing, stock,
// added, price }] — existing null means a new shelf row. Pure, for tests.
function planDelivery({ goods, shelf, heldIds = [], event = null }) {
  const byName = new Map(shelf.map(item => [item.name.toLowerCase(), item]));
  const held = new Set(heldIds.map(Number));
  const params = (event && event.params) || {};
  const shortCategory = event && event.kind === 'shortage' && String(params.target || '').startsWith('category:')
    ? params.target.slice('category:'.length).toLowerCase() : null;
  const saleCut = event && event.kind === 'sale' && params.target === 'artisan' ? Number(params.percent) || 0 : 0;
  const changes = [];
  for (const good of goods) {
    const existing = byName.get(good.name.toLowerCase());
    // Someone else's item by that name, or one reserved: left alone.
    if (existing && (existing.source !== 'artisan' || held.has(existing.id))) continue;
    if (existing) {
      const stock = Math.min(good.cap, (existing.stock || 0) + good.per_week);
      changes.push({ good, existing, stock, added: Math.max(0, stock - (existing.stock || 0)), price: existing.price });
      continue;
    }
    if (shortCategory && String(good.category || '').toLowerCase() === shortCategory) continue;
    const stock = Math.min(good.cap, good.per_week);
    changes.push({ good, existing: null, stock, added: stock, price: saleCut ? shopRoundPrice(good.price_cp * (100 - saleCut) / 100) : good.price_cp });
  }
  return changes;
}

// A scheduled artisan's random magic items, put on the shelf now (not during
// a magic shortage; a category shortage keeps out that category). Returns the rows.
function deliverArtisanMagic(artisan, now, random) {
  const settings = { id: artisan.id, cap: artisan.magic_cap || 0, common: artisan.magic_common || 0, uncommon: artisan.magic_uncommon || 0, rare: artisan.magic_rare || 0 };
  if (!settings.common && !settings.uncommon && !settings.rare) return [];
  const event = thisWeeksEvent(now);
  const target = event && event.kind === 'shortage' ? String((event.params || {}).target || '') : '';
  if (target === 'magic') return [];
  const shelf = db.prepare('SELECT * FROM items').all();
  const config = readRestockConfig();
  const fluctuate = cp => shopRoundPrice(cp * (config.fluctuation_min + random() * (config.fluctuation_max - config.fluctuation_min)));
  const held = shelf.filter(item => item.source === 'artisan_magic' && item.artisan_id === artisan.id && item.stock !== 0).length;
  const rows = drawArtisanMagic({
    artisan: settings,
    held,
    catalog: db.prepare('SELECT * FROM catalog').all(),
    level: restockPartyLevel(config),
    taken: new Set(shelf.map(item => item.name.toLowerCase())),
    fluctuate,
    random
  }).filter(row => !target.startsWith('category:') || String(row.category || '').toLowerCase() !== target.slice('category:'.length).toLowerCase());
  const insert = db.prepare(`
    INSERT INTO items (name, category, price, stock, description, is_active, source, rarity, weeks, artisan_id)
    VALUES (?, ?, ?, 1, ?, 1, 'artisan_magic', ?, 0, ?)
  `);
  rows.forEach(row => insert.run(row.name, row.category, row.price, row.description, row.rarity, artisan.id));
  return rows;
}

// Delivers for every scheduled artisan whose moment has passed, and picks a
// moment for any that has none. Returns [{ artisan, note, delivered: [{ name,
// added, stock, price_cp }], full: [names] }] for the announcements.
function deliverDueArtisans({ now = new Date(), random = Math.random } = {}) {
  const artisans = db.prepare("SELECT * FROM artisans WHERE active = 1 AND mode = 'resident' AND delivery_day_from IS NOT NULL").all();
  const results = [];
  for (const artisan of artisans) {
    if (!artisan.next_delivery_at) {
      db.prepare('UPDATE artisans SET next_delivery_at = ? WHERE id = ? AND next_delivery_at IS NULL').run(nextArtisanDeliveryAt(artisan, now, random), artisan.id);
      continue;
    }
    const due = new Date(artisan.next_delivery_at);
    if (due > now) continue;
    // Next week's moment: a late delivery (the bot was down) still leaves this week's window if it's due later.
    const after = new Date(Math.max(now.getTime(), weekStart(due, 1).getTime()));
    const next = pickDeliveryTime(artisanDeliveryWindow(artisan), after, random);
    const result = db.transaction(() => {
      // Claimed once, even with two processes checking.
      const claimed = db.prepare('UPDATE artisans SET next_delivery_at = ?, last_delivery_at = ? WHERE id = ? AND next_delivery_at = ?')
        .run(next ? next.toISOString() : null, now.toISOString(), artisan.id, artisan.next_delivery_at).changes;
      if (!claimed) return null;
      const goods = db.prepare('SELECT * FROM artisan_goods WHERE artisan_id = ? ORDER BY id').all(artisan.id);
      const changes = planDelivery({
        goods,
        shelf: db.prepare('SELECT * FROM items').all(),
        heldIds: require('./reservations').heldItemIds(),
        event: thisWeeksEvent(now)
      });
      const restock = db.prepare('UPDATE items SET stock = ?, is_active = 1 WHERE id = ?');
      const insert = db.prepare(`
        INSERT INTO items (name, category, price, stock, description, is_active, source, rarity, weeks)
        VALUES (?, ?, ?, ?, ?, 1, 'artisan', '', 0)
      `);
      for (const change of changes) {
        if (change.existing) restock.run(change.stock, change.existing.id);
        else insert.run(change.good.name, change.good.category, change.price, change.stock, change.good.description);
      }
      const magic = deliverArtisanMagic(artisan, now, random);
      return {
        artisan: artisan.name,
        note: artisan.delivery_note || '',
        delivered: [
          ...changes.filter(change => change.added > 0).map(change => ({ name: change.good.name, added: change.added, stock: change.stock, price_cp: change.price })),
          ...magic.map(row => ({ name: row.name, added: 1, stock: 1, price_cp: row.price, rarity: row.rarity }))
        ],
        full: changes.filter(change => change.added === 0).map(change => change.good.name)
      };
    })();
    if (result) results.push(result);
  }
  return results;
}

module.exports = { planArtisanDelivery: planDelivery, deliverDueArtisans };
