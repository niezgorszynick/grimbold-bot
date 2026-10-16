// db/artisans.js — Grimbold's suppliers and the week's news, both used by the
// weekly restock (db/restock.js):
//
//   Artisans (e.g. Benet the leatherworker): resident craftspeople with a few
//   goods each. Every restock adds `per_week` of each good, up to `cap` on the
//   shelf; buying frees room for the next delivery.
//
//   Weekly events: a DM-written list. Each restock there's a chance (Restock
//   Engine setting) that one of them happens, picked by weight:
//     merchant — a visitor sells 1–3 of their goods for one week
//     shortage — no new scrolls, or no new magic items, this week
//     sale     — a percentage off part of the shelf this week
//     news     — only a line in the restock announcement

'use strict';

const { db } = require('./connection');

const EVENT_KINDS = ['merchant', 'shortage', 'sale', 'news'];
const SHORTAGE_TARGETS = ['scroll', 'magic'];
// Sales cover parts of the shelf rebuilt every week (magic items keep their price).
const SALE_TARGETS = ['mundane', 'staple', 'scroll', 'artisan'];

function text(value, max, label, required = false) {
  const clean = String(value === undefined || value === null ? '' : value).trim();
  if (required && !clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return clean;
}

function whole(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return number;
}

// "12.5" gp → 1250 cp.
function priceCp(value, label = 'Price') {
  const gp = Number(String(value === undefined ? '' : value).replace(',', '.'));
  if (!Number.isFinite(gp) || gp <= 0 || gp > 1000000) throw new Error(`${label} must be a number of gold pieces above 0.`);
  return Math.max(1, Math.round(gp * 100));
}

// ─── Artisans ───────────────────────────────────────────────────────────────

function listArtisans() {
  const artisans = db.prepare('SELECT * FROM artisans ORDER BY name COLLATE NOCASE').all();
  const goods = db.prepare('SELECT * FROM artisan_goods ORDER BY name COLLATE NOCASE').all();
  return artisans.map(artisan => ({ ...artisan, active: Boolean(artisan.active), goods: goods.filter(good => good.artisan_id === artisan.id) }));
}

function saveArtisan(fields) {
  const values = [text(fields.name, 80, 'Name', true), text(fields.description, 1000, 'Description'), fields.active === undefined || fields.active === '1' || fields.active === true ? 1 : 0];
  const id = Number(fields.id) || null;
  if (id) {
    if (!db.prepare('UPDATE artisans SET name = ?, description = ?, active = ? WHERE id = ?').run(...values, id).changes) throw new Error('Artisan not found.');
    return id;
  }
  return Number(db.prepare('INSERT INTO artisans (name, description, active) VALUES (?, ?, ?)').run(...values).lastInsertRowid);
}

function deleteArtisan(id) {
  db.transaction(() => {
    db.prepare('DELETE FROM artisan_goods WHERE artisan_id = ?').run(Number(id));
    db.prepare('DELETE FROM artisans WHERE id = ?').run(Number(id));
  })();
}

function saveArtisanGood(fields) {
  const artisanId = Number(fields.artisan_id);
  if (!db.prepare('SELECT 1 FROM artisans WHERE id = ?').get(artisanId)) throw new Error('Artisan not found.');
  const perWeek = whole(fields.per_week, 1, 20, 'Made per week');
  const cap = whole(fields.cap, 1, 50, 'Most on the shelf');
  if (cap < perWeek) throw new Error('"Most on the shelf" must be at least "Made per week".');
  const values = [text(fields.name, 100, 'Item name', true), text(fields.category, 60, 'Category') || 'Artisan Goods', priceCp(fields.price_gp), text(fields.description, 2000, 'Description'), perWeek, cap];
  const id = Number(fields.id) || null;
  if (id) {
    db.prepare('UPDATE artisan_goods SET name = ?, category = ?, price_cp = ?, description = ?, per_week = ?, cap = ? WHERE id = ?').run(...values, id);
    return id;
  }
  return Number(db.prepare('INSERT INTO artisan_goods (name, category, price_cp, description, per_week, cap, artisan_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...values, artisanId).lastInsertRowid);
}

function deleteArtisanGood(id) {
  db.prepare('DELETE FROM artisan_goods WHERE id = ?').run(Number(id));
}

// Goods of active artisans, for the restock: [{ name, category, price_cp, description, per_week, cap, artisan }].
function activeArtisanGoods() {
  return db.prepare(`
    SELECT g.*, a.name AS artisan FROM artisan_goods g JOIN artisans a ON a.id = g.artisan_id WHERE a.active = 1 ORDER BY g.id
  `).all();
}

// ─── Weekly events ──────────────────────────────────────────────────────────

// Merchant goods, one per line: "Name | price in gp | category | description".
function parseMerchantGoods(raw) {
  const goods = [];
  String(raw || '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const [name, price, category, ...rest] = line.split('|').map(part => part.trim());
    if (!name) throw new Error(`Line ${index + 1}: give the item a name.`);
    goods.push({
      name: text(name, 100, `Line ${index + 1} name`),
      price_cp: priceCp(price, `Line ${index + 1} price`),
      category: text(category, 60, `Line ${index + 1} category`) || 'Travelling Merchant',
      description: text(rest.join(' | '), 2000, `Line ${index + 1} description`)
    });
  });
  if (!goods.length) throw new Error('A visiting merchant needs at least one item (one per line).');
  if (goods.length > 30) throw new Error('At most 30 items per merchant.');
  return goods;
}

function readEvent(row) {
  let params = {};
  try {
    params = JSON.parse(row.params || '{}') || {};
  } catch {
    params = {};
  }
  return { ...row, active: Boolean(row.active), params };
}

function listShopEvents() {
  return db.prepare('SELECT * FROM shop_events ORDER BY title COLLATE NOCASE').all().map(readEvent);
}

function getShopEvent(id) {
  const row = db.prepare('SELECT * FROM shop_events WHERE id = ?').get(Number(id));
  return row ? readEvent(row) : null;
}

function saveShopEvent(fields) {
  const kind = EVENT_KINDS.includes(fields.kind) ? fields.kind : null;
  if (!kind) throw new Error('Choose what kind of event this is.');
  let params = {};
  if (kind === 'merchant') {
    params = { goods: parseMerchantGoods(fields.goods), min: whole(fields.min_goods || 1, 1, 10, 'Fewest items'), max: whole(fields.max_goods || 3, 1, 10, 'Most items') };
    if (params.max < params.min) throw new Error('"Most items" must be at least "Fewest items".');
  } else if (kind === 'shortage') {
    if (!SHORTAGE_TARGETS.includes(fields.target)) throw new Error('Choose what runs short.');
    params = { target: fields.target };
  } else if (kind === 'sale') {
    if (!SALE_TARGETS.includes(fields.target)) throw new Error('Choose what goes on sale.');
    params = { target: fields.target, percent: whole(fields.percent, 5, 75, 'Discount') };
  }
  const values = [
    text(fields.title, 100, 'Title', true),
    text(fields.announcement, 1000, 'Announcement', true),
    kind,
    JSON.stringify(params),
    whole(fields.weight || 1, 1, 100, 'Weight'),
    fields.active === undefined || fields.active === '1' || fields.active === true ? 1 : 0
  ];
  const id = Number(fields.id) || null;
  if (id) {
    if (!db.prepare('UPDATE shop_events SET title = ?, announcement = ?, kind = ?, params = ?, weight = ?, active = ? WHERE id = ?').run(...values, id).changes) throw new Error('Event not found.');
    return id;
  }
  return Number(db.prepare('INSERT INTO shop_events (title, announcement, kind, params, weight, active) VALUES (?, ?, ?, ?, ?, ?)').run(...values).lastInsertRowid);
}

function deleteShopEvent(id) {
  db.prepare('DELETE FROM shop_events WHERE id = ?').run(Number(id));
}

// This week's event, or null: a chance roll, then a pick by weight.
function rollWeeklyEvent({ chance, random = Math.random }) {
  const events = listShopEvents().filter(event => event.active);
  if (!events.length || random() * 100 >= chance) return null;
  let pick = random() * events.reduce((sum, event) => sum + event.weight, 0);
  return events.find(event => (pick -= event.weight) < 0) || events[events.length - 1];
}

module.exports = {
  SHOP_EVENT_KINDS: EVENT_KINDS,
  SHOP_SHORTAGE_TARGETS: SHORTAGE_TARGETS,
  SHOP_SALE_TARGETS: SALE_TARGETS,
  listArtisans,
  saveArtisan,
  deleteArtisan,
  saveArtisanGood,
  deleteArtisanGood,
  activeArtisanGoods,
  listShopEvents,
  getShopEvent,
  saveShopEvent,
  deleteShopEvent,
  rollWeeklyEvent
};
