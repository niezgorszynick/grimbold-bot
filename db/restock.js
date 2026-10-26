// db/restock.js — The weekly restock of Grimbold's shelf. Each shelf row has a
// source, and each source restocks by its own rules:
//
//   mundane — every mundane catalog item (no rarity) the party level allows,
//             always in stock, at its catalog price.
//   staple  — catalog items marked "staple" (Potion of Healing, rations, ...):
//             always there, stock rolled each week, fixed price.
//   magic   — a few Common / Uncommon (and, from party level 5, Rare) items the
//             DMs allow in the shop. Each stays two weeks unless it sells out,
//             so about half the magic stock changes every week.
//   scroll  — the scroll case: spell scrolls drawn from the whole spell list,
//             spell level capped by the party level, all new each week.
//   artisan — goods of resident artisans (db/artisans.js): each restock adds
//             their weekly amount, up to a cap; unsold stock stays.
//   event   — a visiting merchant's goods (a weekly event): one week only.
//   manual  — items a DM put on the shelf by hand: left alone (removed once
//             sold out).
//   legacy  — rows from before sources existed: cleared by the next restock.
//
// A reserved item (db/reservations.js) stays where it is through the next two
// restocks, whatever its source would do.
//
// At most one weekly event happens per restock (a chance roll, then a pick by
// weight): a visiting merchant, a shortage (no new scrolls / magic items), a
// sale on part of the shelf, or news only.
//
// planRestock is pure (shelf + catalog in, changes out) so it can be tested;
// runRestock applies a plan in one transaction.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { activeArtisanGoods, travellingGoods, rollWeeklyEvent } = require('./artisans');

const MAGIC_RARITIES = ['Common', 'Uncommon', 'Rare'];
// Rare items only once the party reaches tier 2 (level 5).
const RARE_FROM_LEVEL = 5;
// Spell scroll prices by spell level (the campaign's spellcasting-services table).
const SCROLL_PRICE_GP = [30, 50, 200, 300, 2000, 2000, 20000, 20000, 20000, 100000];
const SCROLL_RARITY = ['Common', 'Common', 'Uncommon', 'Uncommon', 'Rare', 'Rare', 'Very Rare', 'Very Rare', 'Very Rare', 'Legendary'];
// The scroll case: low, low, mid, mid, high (each capped by the party level).
const SCROLL_SLOTS = [[0, 1], [0, 1], [2, 3], [2, 3], [4, 9]];

const DEFAULTS = {
  party_level: 3,
  party_level_auto: false,
  magic_common_count: 3,
  magic_uncommon_count: 2,
  magic_rare_count: 1,
  scroll_count: 5,
  fluctuation_min: 0.85,
  fluctuation_max: 1.15,
  // Percent chance of a weekly event.
  event_chance: 40
};

function readConfig() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const map = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const int = (key, min, max) => {
    const value = parseInt(map[key], 10);
    return Number.isInteger(value) && value >= min && value <= max ? value : DEFAULTS[key];
  };
  const float = key => {
    const value = parseFloat(map[key]);
    return Number.isFinite(value) && value > 0 ? value : DEFAULTS[key];
  };
  return {
    party_level: int('party_level', 1, 20),
    party_level_auto: map.party_level_auto === '1',
    magic_common_count: int('magic_common_count', 0, 20),
    magic_uncommon_count: int('magic_uncommon_count', 0, 20),
    magic_rare_count: int('magic_rare_count', 0, 10),
    scroll_count: int('scroll_count', 0, 20),
    fluctuation_min: float('fluctuation_min'),
    fluctuation_max: float('fluctuation_max'),
    event_chance: map.event_chance === undefined ? DEFAULTS.event_chance : int('event_chance', 0, 100)
  };
}

function saveConfig(values) {
  const upsert = db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const checked = {
    party_level: [1, 20], magic_common_count: [0, 20], magic_uncommon_count: [0, 20], magic_rare_count: [0, 10], scroll_count: [0, 20], event_chance: [0, 100]
  };
  db.transaction(() => {
    for (const [key, [min, max]] of Object.entries(checked)) {
      const value = parseInt(values[key], 10);
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key.replace(/_/g, ' ')} must be a whole number from ${min} to ${max}.`);
      upsert.run(key, String(value));
    }
    const fMin = parseFloat(values.fluctuation_min);
    const fMax = parseFloat(values.fluctuation_max);
    if (!(fMin > 0) || !(fMax >= fMin)) throw new Error('Invalid price fluctuation range (Min must be > 0 and Max >= Min).');
    upsert.run('fluctuation_min', String(fMin));
    upsert.run('fluctuation_max', String(fMax));
    upsert.run('party_level_auto', values.party_level_auto ? '1' : '0');
  })();
}

// The median level of living characters (what "the party" is in a campaign
// with many groups), or null when there are none.
function medianCharacterLevel() {
  const levels = db.prepare("SELECT level FROM characters WHERE status = 'alive' AND level > 0 ORDER BY level").all().map(row => row.level);
  if (!levels.length) return null;
  const middle = Math.floor(levels.length / 2);
  return levels.length % 2 ? levels[middle] : Math.round((levels[middle - 1] + levels[middle]) / 2);
}

function partyLevel(config = readConfig()) {
  return config.party_level_auto ? (medianCharacterLevel() || config.party_level) : config.party_level;
}

const isScrollRow = row => /^(spell scroll|scroll)$/i.test(String(row.category || '').trim()) || /^spell scroll \(/i.test(row.name);

function shuffle(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function scrollName(spell) {
  return spell.level === 0 ? `Spell Scroll (Cantrip: ${spell.name})` : `Spell Scroll (Level ${spell.level}: ${spell.name})`;
}

// The changes this week's restock makes. shelf: items rows (with source,
// weeks); catalog: catalog rows; spells: spell list entries. Returns
// { remove: [ids], keep: [{ id, weeks }], update: [{ id, stock, price }],
// insert: [rows], partyLevel }. artisanGoods: active artisans' goods; event:
// this week's event or null.
function planRestock({ shelf: wholeShelf, catalog, spells, config, level, artisanGoods = [], event = null, heldIds = [], random = Math.random }) {
  const plan = { remove: [], keep: [], update: [], insert: [], held: [], partyLevel: level };
  const params = (event && event.params) || {};
  const shortage = event && event.kind === 'shortage' ? params.target : null;
  // A shopkeeper's price: whole gold from 10 gp, whole silver below that.
  const roundPrice = cp => (cp >= 1000 ? Math.round(cp / 100) * 100 : cp >= 10 ? Math.round(cp / 10) * 10 : Math.max(1, Math.round(cp)));
  const fluctuate = priceCp => roundPrice(priceCp * (config.fluctuation_min + random() * (config.fluctuation_max - config.fluctuation_min)));
  const between = (min, max) => min + Math.floor(random() * (Math.max(min, max) - min + 1));
  const allowed = catalog.filter(row => row.min_level <= level && row.availability !== 'adventure' && row.tier !== 'service');
  const taken = new Set();
  const take = row => { taken.add(row.name.toLowerCase()); return row; };
  // Reserved items: untouched (and their names taken); the rest restocks as usual.
  const held = new Set(heldIds.map(Number));
  wholeShelf.filter(item => held.has(item.id)).forEach(item => { plan.held.push(item.id); take(item); });
  const shelf = wholeShelf.filter(item => !held.has(item.id));

  // Manual rows stay until sold out; their names are taken.
  for (const row of shelf.filter(item => !['mundane', 'staple', 'magic', 'scroll', 'artisan', 'event'].includes(item.source))) {
    if (row.stock === 0 || row.source === 'legacy') plan.remove.push(row.id);
    else take(row);
  }

  // Artisans: this week's batch, up to each good's cap. Goods no longer made
  // (artisan away or the good removed) leave the shelf.
  const artisanRows = new Map(shelf.filter(item => item.source === 'artisan').map(item => [item.name.toLowerCase(), item]));
  for (const good of artisanGoods) {
    const key = good.name.toLowerCase();
    if (taken.has(key)) continue;
    const existing = artisanRows.get(key);
    if (existing) {
      plan.update.push({ id: existing.id, stock: Math.min(good.cap, (existing.stock || 0) + good.per_week), price: good.price_cp, source: 'artisan' });
      artisanRows.delete(key);
    } else {
      plan.insert.push({ name: good.name, category: good.category, price: good.price_cp, stock: Math.min(good.cap, good.per_week), description: good.description, source: 'artisan', rarity: '' });
    }
    take(good);
  }
  artisanRows.forEach(item => plan.remove.push(item.id));

  // Last week's visiting merchant has moved on; this week's sets up shop.
  shelf.filter(item => item.source === 'event').forEach(item => plan.remove.push(item.id));
  if (event && event.kind === 'merchant') {
    const goods = shuffle((params.goods || []).filter(good => !taken.has(good.name.toLowerCase())), random);
    for (const good of goods.slice(0, between(params.min || 1, params.max || 3))) {
      plan.insert.push(take({ name: good.name, category: good.category, price: good.price_cp, stock: good.stock || 1, description: good.description, source: 'event', rarity: '' }));
    }
  }

  // Staples: rolled again each week.
  shelf.filter(item => item.source === 'staple').forEach(item => plan.remove.push(item.id));
  for (const row of allowed.filter(item => item.tier === 'staple' && shortage !== 'staple' && !taken.has(item.name.toLowerCase()))) {
    plan.insert.push(take({ name: row.name, category: row.category, price: row.base_price_cp, stock: between(row.min_stock, row.max_stock), description: row.description, source: 'staple', rarity: row.rarity || '' }));
  }

  // Mundane counter: always stocked; rebuilt so catalog edits show up.
  shelf.filter(item => item.source === 'mundane').forEach(item => plan.remove.push(item.id));
  for (const row of allowed.filter(item => !item.rarity && item.tier !== 'staple' && !isScrollRow(item) && !taken.has(item.name.toLowerCase()))) {
    plan.insert.push(take({ name: row.name, category: row.category, price: row.base_price_cp, stock: null, description: row.description, source: 'mundane', rarity: '' }));
  }

  // Magic: last week's new arrivals stay one more week (unless sold out).
  const keptMagic = [];
  for (const item of shelf.filter(row => row.source === 'magic')) {
    if ((item.weeks || 0) < 1 && item.stock !== 0) {
      plan.keep.push({ id: item.id, weeks: (item.weeks || 0) + 1 });
      keptMagic.push(take(item));
    } else {
      plan.remove.push(item.id);
    }
  }
  const targets = { Common: config.magic_common_count, Uncommon: config.magic_uncommon_count, Rare: level >= RARE_FROM_LEVEL ? config.magic_rare_count : 0 };
  for (const rarity of MAGIC_RARITIES) {
    const missing = targets[rarity] - keptMagic.filter(item => item.rarity === rarity).length;
    // A magic shortage: what's left stays, nothing new arrives.
    if (missing <= 0 || shortage === 'magic') continue;
    const pool = allowed.filter(row => row.rarity === rarity && row.tier !== 'staple' && !isScrollRow(row) && !taken.has(row.name.toLowerCase()));
    for (const row of shuffle(pool, random).slice(0, missing)) {
      plan.insert.push(take({ name: row.name, category: row.category, price: fluctuate(row.base_price_cp), stock: Math.max(1, between(row.min_stock, row.max_stock)), description: row.description, source: 'magic', rarity }));
    }
  }

  // Scroll case: all new each week, spell level capped by the party level.
  shelf.filter(item => item.source === 'scroll').forEach(item => plan.remove.push(item.id));
  const maxLevel = Math.min(9, Math.ceil(level / 2));
  for (let index = 0; index < (shortage === 'scroll' ? 0 : config.scroll_count); index += 1) {
    const [low, high] = SCROLL_SLOTS[index] || [0, maxLevel];
    let range = [low, Math.min(high, maxLevel)];
    if (range[0] > range[1]) range = [Math.max(0, maxLevel - 1), maxLevel];
    const free = spell => !taken.has(scrollName(spell).toLowerCase());
    let pool = spells.filter(spell => spell.level >= range[0] && spell.level <= range[1] && free(spell));
    // That level range ran out: any spell up to the cap.
    if (!pool.length) pool = spells.filter(spell => spell.level <= maxLevel && free(spell));
    const spell = pool.length ? pool[Math.floor(random() * pool.length)] : null;
    if (!spell) continue;
    const school = spell.school ? ` ${spell.school.toLowerCase()}` : '';
    const kind = spell.level === 0 ? `a${school} cantrip` : `a level ${spell.level}${school} spell`;
    plan.insert.push(take({
      name: scrollName(spell),
      category: 'Spell Scroll',
      price: fluctuate(SCROLL_PRICE_GP[spell.level] * 100),
      stock: 1,
      description: `A spell scroll of ${spell.name}, ${kind}. Anyone with the spell on their class list can cast it from the scroll once.`,
      source: 'scroll',
      rarity: SCROLL_RARITY[spell.level]
    }));
  }

  // A category shortage: nothing new of that category (a visiting merchant's
  // goods excepted).
  if (shortage && shortage.startsWith('category:')) {
    const category = shortage.slice('category:'.length).toLowerCase();
    plan.insert = plan.insert.filter(row => row.source === 'event' || String(row.category || '').toLowerCase() !== category);
  }

  // A sale: this week's price off one part of the shelf.
  if (event && event.kind === 'sale') {
    const cut = price => roundPrice(price * (100 - params.percent) / 100);
    [...plan.insert, ...plan.update].filter(row => row.source === params.target).forEach(row => { row.price = cut(row.price); });
  }
  return plan;
}

// Restocks the shelf now. Returns a summary for the announcement.
function runRestock({ random = Math.random } = {}) {
  const config = readConfig();
  let event = rollWeeklyEvent({ chance: config.event_chance, random });
  // A travelling artisan visits with their own goods.
  if (event && event.kind === 'merchant' && event.params.artisanId) {
    event = { ...event, params: { ...event.params, goods: travellingGoods(event.params.artisanId) } };
  }
  const level = partyLevel(config);
  const shelf = db.prepare('SELECT * FROM items').all();
  const catalog = db.prepare('SELECT * FROM catalog').all();
  const spells = Object.values(rules.getSpellCatalog()).filter(spell => Number.isInteger(spell.level));
  const reservations = require('./reservations');
  const plan = planRestock({ shelf, catalog, spells, config, level, artisanGoods: activeArtisanGoods(), event, heldIds: reservations.heldItemIds(), random });
  db.transaction(() => {
    const remove = db.prepare('DELETE FROM items WHERE id = ?');
    plan.remove.forEach(id => remove.run(id));
    const age = db.prepare('UPDATE items SET weeks = ? WHERE id = ?');
    plan.keep.forEach(row => age.run(row.weeks, row.id));
    const restock = db.prepare('UPDATE items SET stock = ?, price = ?, is_active = 1 WHERE id = ?');
    plan.update.forEach(row => restock.run(row.stock, row.price, row.id));
    // The last event, shown in the Restock Engine tab.
    db.prepare("INSERT INTO config (key, value) VALUES ('last_shop_event', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(event ? { title: event.title, at: new Date().toISOString() } : { title: null, at: new Date().toISOString() }));
    const insert = db.prepare(`
      INSERT INTO items (name, category, price, stock, description, is_active, source, rarity, weeks)
      VALUES (@name, @category, @price, @stock, @description, 1, @source, @rarity, 0)
      ON CONFLICT(name) DO UPDATE SET category = excluded.category, price = excluded.price, stock = excluded.stock,
        description = excluded.description, is_active = 1, source = excluded.source, rarity = excluded.rarity, weeks = 0
    `);
    plan.insert.forEach(row => insert.run(row));
  })();
  // Reservations count down, run out, or are refunded if their item is gone.
  const reserved = reservations.afterRestock();
  const newOf = source => plan.insert.filter(row => row.source === source).map(row => row.name);
  const artisanStock = [...plan.insert, ...plan.update].filter(row => row.source === 'artisan').length;
  return {
    partyLevel: level,
    newMagic: newOf('magic'),
    keptMagic: plan.keep.length,
    scrolls: newOf('scroll'),
    mundane: newOf('mundane').length,
    artisanGoods: artisanStock,
    merchantGoods: newOf('event'),
    event: event ? { title: event.title, announcement: event.announcement, kind: event.kind } : null,
    reserved
  };
}

module.exports = {
  RESTOCK_DEFAULTS: DEFAULTS,
  readRestockConfig: readConfig,
  saveRestockConfig: saveConfig,
  medianCharacterLevel,
  restockPartyLevel: partyLevel,
  planRestock,
  runRestock
};
