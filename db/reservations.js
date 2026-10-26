// db/reservations.js — Reserving an item at Grimbold's: a character pays a
// 10% deposit (of their own price) and the item stays on the shelf through
// the next two restocks. The deposit comes off the price when they buy it;
// it is kept if the reservation runs out or is cancelled, and refunded if
// someone else buys the last one (or a DM takes the item off the shelf).
// Others may still buy a reserved item. One reservation per character, one
// reserver per item. Only rotating stock can be reserved (magic items, the
// scroll case, a visiting merchant's goods): the rest is always there.
//
// Reserving and buying are in shop.js (they need the buyer's price); the
// weekly restock (db/restock.js) asks heldItemIds() and calls afterRestock().

'use strict';

const { db } = require('./connection');
const { recordGoldChange } = require('./gold');

const RESERVABLE_SOURCES = ['magic', 'scroll', 'event'];
const DEPOSIT_PERCENT = 10;
const HOLD_RESTOCKS = 2;

const depositFor = unitPriceCp => Math.max(1, Math.round(unitPriceCp * DEPOSIT_PERCENT / 100));

const VIEW_QUERY = `
  SELECT r.*, c.name AS character_name, p.discord_tag AS player_tag
  FROM reservations r JOIN characters c ON c.id = r.character_id LEFT JOIN players p ON p.id = r.player_id
`;

function reservationView(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    item: row.item_name,
    characterId: row.character_id,
    character: row.character_name,
    playerId: row.player_id,
    player: row.player_tag || null,
    depositCp: row.deposit_cp,
    restocksLeft: row.restocks_left,
    status: row.status,
    createdAt: row.created_at
  };
}

function getReservation(id) {
  const row = db.prepare(`${VIEW_QUERY} WHERE r.id = ?`).get(Number(id));
  return row ? reservationView(row) : null;
}

// Active reservations (the shop shows them on the shelf).
function listActiveReservations() {
  return db.prepare(`${VIEW_QUERY} WHERE r.status = 'active' ORDER BY r.id`).all().map(reservationView);
}

function activeReservationOfCharacter(characterId) {
  return db.prepare("SELECT * FROM reservations WHERE character_id = ? AND status = 'active'").get(Number(characterId)) || null;
}

function activeReservationOfItem(itemId) {
  return db.prepare("SELECT * FROM reservations WHERE item_id = ? AND status = 'active'").get(Number(itemId)) || null;
}

// Ends a reservation; refund: the deposit goes back to the purse (logged).
// Returns the reservation as it ended, for Grimbold's note.
function endReservation(row, status, { refund = false, reason = '' } = {}) {
  db.prepare("UPDATE reservations SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").run(status, row.id);
  if (refund) {
    const character = db.prepare('SELECT gold_cp FROM characters WHERE id = ?').get(row.character_id);
    if (character) {
      db.prepare('UPDATE characters SET gold_cp = gold_cp + ? WHERE id = ?').run(row.deposit_cp, row.character_id);
      recordGoldChange({ characterId: row.character_id, user: null, oldCp: character.gold_cp, newCp: character.gold_cp + row.deposit_cp, reason: reason || `Deposit refunded: ${row.item_name}` });
    }
  }
  return getReservation(row.id);
}

// The player gives up their reservation; the deposit stays with Grimbold.
function cancelReservation({ reservationId, user }) {
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM reservations WHERE id = ? AND status = 'active'").get(Number(reservationId));
    if (!row) throw new Error('That reservation is no longer active.');
    const isAdmin = Boolean(user && user.role === 'admin');
    if (!isAdmin && row.player_id !== Number(user && user.id)) throw new Error('Forbidden.');
    // A DM cancelling gives the deposit back; a player cancelling forfeits it.
    return endReservation(row, isAdmin ? 'refunded' : 'cancelled', { refund: isAdmin, reason: `Deposit refunded by a DM: ${row.item_name}` });
  })();
}

// Shelf rows the restock must leave alone this time.
function heldItemIds() {
  return db.prepare("SELECT item_id FROM reservations WHERE status = 'active' AND restocks_left > 0").all().map(row => row.item_id);
}

// After a restock: held reservations count down; those that had no restock
// left expire (deposit kept); those whose item is gone (a DM removed it) are
// refunded. Returns { held, expired, refunded } for the notes.
function afterRestock() {
  const active = db.prepare("SELECT * FROM reservations WHERE status = 'active'").all();
  const result = { held: [], expired: [], refunded: [] };
  for (const row of active) {
    const item = db.prepare('SELECT id FROM items WHERE id = ?').get(row.item_id);
    if (row.restocks_left <= 0) {
      result.expired.push(endReservation(row, 'expired'));
    } else if (!item) {
      result.refunded.push(endReservation(row, 'refunded', { refund: true, reason: `Deposit refunded: ${row.item_name} left the shelf` }));
    } else {
      db.prepare('UPDATE reservations SET restocks_left = restocks_left - 1 WHERE id = ?').run(row.id);
      result.held.push(getReservation(row.id));
    }
  }
  return result;
}

module.exports = {
  RESERVABLE_SOURCES,
  RESERVATION_DEPOSIT_PERCENT: DEPOSIT_PERCENT,
  RESERVATION_HOLD_RESTOCKS: HOLD_RESTOCKS,
  reservationDepositFor: depositFor,
  getReservation,
  listActiveReservations,
  activeReservationOfCharacter,
  activeReservationOfItem,
  endReservation,
  cancelReservation,
  heldItemIds,
  afterRestock
};
