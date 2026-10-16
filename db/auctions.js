// db/auctions.js — Selling magic items at Grimbold's auction (/sell).
//
// A player lists one of a character's magic items: it leaves the sheet while
// the auction runs (7 days). The opening bid is half the item's value (the
// 2024 price for its rarity; consumables half). Other players bid from their
// characters' purses: a bid is held from the purse and handed back when
// someone outbids it. "Adventurers" (NPCs) sometimes join in: each day an
// interested NPC may raise the bid by 5–20%, up to a limit set when the item
// is listed (about its full value). Some items draw no NPC interest at all.
//
// When the auction ends: the highest player gets the item on their sheet, or
// the NPC carries it off; the seller is paid the winning bid minus Grimbold's
// 10% cut. With no bids at all Grimbold buys it for the opening bid and puts it
// on his shelf. A seller can withdraw an item that has no bids yet.
//
// Settling (NPC bids and endings) happens whenever auctions are read and on a
// timer in the bot (index.js), so nothing depends on anyone opening the page.

'use strict';

const crypto = require('crypto');
const { db } = require('./connection');
const rules = require('../rules');
const { recordGoldChange } = require('./gold');
const { changeCharacterMagicItems } = require('./magicItems');

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATION_DAYS = 7;
const COMMISSION = 0.10;
const NPC_INTEREST_CHANCE = 0.65;
const NPC_DAILY_BID_CHANCE = 0.35;
const NPC_BIDDERS = [
  'a hooded collector', 'Varis the Fence', 'an envoy of the Silver Hand', 'a gnome antiquarian', 'a mercenary captain',
  'a temple quartermaster', "a noble's steward", 'a wandering sellsword', 'an elven curio dealer', 'a dwarven treasure-seeker'
];

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const roundGp = cp => Math.max(100, Math.round(cp / 100) * 100);
const iso = time => new Date(time).toISOString();

// What a magic item entry is worth: { name, rarity, valueCp }.
function itemValue(entry, catalog = rules.getMagicItemCatalog()) {
  const item = catalog[entry.name] || null;
  const variant = item && entry.variant ? item.variants.find(v => v.label === entry.variant) : null;
  const rarity = (variant && variant.rarity) || (item && item.rarity) || entry.rarity || null;
  const priceGp = rules.MAGIC_ITEM_PRICE_GP[rarity] || 100;
  const consumable = item ? item.consumable : false;
  return { name: rules.magicItemDisplayName(entry, catalog), rarity: rarity || 'Unknown', valueCp: Math.round(priceGp * (consumable ? 0.5 : 1) * 100) };
}

function loadCharacter(id) {
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(id));
  if (!character) throw new Error('Character not found.');
  return character;
}

function changePurse(character, deltaCp, reason, user = null) {
  const fresh = db.prepare('SELECT gold_cp FROM characters WHERE id = ?').get(character.id);
  const next = fresh.gold_cp + deltaCp;
  if (next < 0) throw new Error(`${character.name} has only ${(fresh.gold_cp / 100).toFixed(2)} gp.`);
  db.prepare('UPDATE characters SET gold_cp = ? WHERE id = ?').run(next, character.id);
  recordGoldChange({ characterId: character.id, user, oldCp: fresh.gold_cp, newCp: next, reason });
}

// Magic items a player's character could put up for auction.
function sellableItems(characterId) {
  const character = loadCharacter(characterId);
  const catalog = rules.getMagicItemCatalog();
  return rules.readMagicItems(readSheet(character.sheet_data)).map(entry => ({
    uid: entry.uid, quantity: entry.quantity || 1, attuned: Boolean(entry.attuned), ...itemValue(entry, catalog)
  }));
}

function minNextBid(auction) {
  return auction.current_bid_cp ? auction.current_bid_cp + Math.max(100, roundGp(auction.current_bid_cp * 0.05)) : auction.opening_bid_cp;
}

// user: { id, role }. Lists one unit of the item (a stack keeps the rest).
function createAuction({ user, characterId, uid, now = Date.now(), random = Math.random }) {
  return db.transaction(() => {
    const character = loadCharacter(characterId);
    const isAdmin = user && user.role === 'admin';
    if (!isAdmin && character.player_id !== Number(user && user.id)) throw new Error('You can only sell your own characters\' items.');
    if (character.status !== 'alive') throw new Error(`${character.name} can't sell anything now.`);
    const entry = rules.readMagicItems(readSheet(character.sheet_data)).find(item => item.uid === uid);
    if (!entry) throw new Error(`${character.name} doesn't have that magic item.`);
    const value = itemValue(entry);
    // Off the sheet: one of a stack, or the item itself.
    changeCharacterMagicItems({ id: character.id, player_id: character.player_id, is_admin: true, action: (entry.quantity || 1) > 1 ? 'consume' : 'remove', params: { uid } });
    const snapshot = { ...entry, quantity: 1, attuned: false, equipped: false };
    const interested = random() < NPC_INTEREST_CHANCE;
    const npcCap = interested ? roundGp(value.valueCp * (0.85 + random() * 0.3)) : 0;
    const id = Number(db.prepare(`
      INSERT INTO auctions (seller_character_id, seller_player_id, item_name, rarity, item_data, value_cp, opening_bid_cp, npc_cap_cp, status, created_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(character.id, character.player_id, value.name, value.rarity, JSON.stringify(snapshot), value.valueCp,
      roundGp(value.valueCp * 0.5), npcCap, iso(now), iso(now + DURATION_DAYS * DAY_MS)).lastInsertRowid);
    return getAuction(id);
  })();
}

function topPlayerBidder(auction) {
  return auction.current_bidder_character_id ? loadCharacter(auction.current_bidder_character_id) : null;
}

// Hands a held bid back to the player who was outbid.
function refundTopBidder(auction, reason) {
  const previous = topPlayerBidder(auction);
  if (previous) changePurse(previous, auction.current_bid_cp, reason);
}

function placeBid({ user, auctionId, characterId, amountCp, now = Date.now() }) {
  return db.transaction(() => {
    settle({ now, onlyId: Number(auctionId) });
    const auction = db.prepare('SELECT * FROM auctions WHERE id = ?').get(Number(auctionId));
    if (!auction) throw new Error('Auction not found.');
    if (auction.status !== 'open') throw new Error('That auction has ended.');
    const bidder = loadCharacter(characterId);
    if (bidder.player_id !== Number(user && user.id)) throw new Error('Bid with one of your own characters.');
    if (bidder.status !== 'alive') throw new Error(`${bidder.name} can't bid now.`);
    if (bidder.player_id === auction.seller_player_id) throw new Error("You can't bid on your own item.");
    if (auction.current_bidder_character_id === bidder.id) throw new Error(`${bidder.name} already has the highest bid.`);
    const amount = Math.round(Number(amountCp));
    const minimum = minNextBid(auction);
    if (!Number.isSafeInteger(amount) || amount < minimum) throw new Error(`The next bid must be at least ${minimum / 100} gp.`);
    changePurse(bidder, -amount, `Bid on ${auction.item_name} (auction #${auction.id})`, user);
    refundTopBidder(auction, `Outbid on ${auction.item_name} (auction #${auction.id}): bid returned`);
    db.prepare('INSERT INTO auction_bids (auction_id, character_id, npc_name, amount_cp, created_at) VALUES (?, ?, NULL, ?, ?)').run(auction.id, bidder.id, amount, iso(now));
    db.prepare('UPDATE auctions SET current_bid_cp = ?, current_bidder_character_id = ?, current_bidder_npc = NULL WHERE id = ?').run(amount, bidder.id, auction.id);
    return getAuction(auction.id);
  })();
}

// The seller (no bids yet) or a DM (any time; a held bid is returned) takes the item back.
function cancelAuction({ user, auctionId }) {
  return db.transaction(() => {
    const auction = db.prepare('SELECT * FROM auctions WHERE id = ?').get(Number(auctionId));
    if (!auction || auction.status !== 'open') throw new Error('That auction is not running.');
    const isAdmin = user && user.role === 'admin';
    if (!isAdmin && auction.seller_player_id !== Number(user && user.id)) throw new Error('Only the seller or a DM can withdraw an item.');
    if (!isAdmin && auction.current_bid_cp) throw new Error('Someone has already bid: the auction has to run its course.');
    refundTopBidder(auction, `Auction #${auction.id} for ${auction.item_name} withdrawn: bid returned`);
    giveItem(auction.seller_character_id, auction);
    db.prepare("UPDATE auctions SET status = 'withdrawn', closed_at = ? WHERE id = ?").run(iso(Date.now()), auction.id);
    return getAuction(auction.id);
  })();
}

// Puts the listed item on a character's sheet.
function giveItem(characterId, auction) {
  const character = loadCharacter(characterId);
  const sheetData = readSheet(character.sheet_data);
  const entry = { ...JSON.parse(auction.item_data), uid: crypto.randomBytes(8).toString('hex'), source: 'auction' };
  const next = { ...sheetData, magicItems: [...rules.readMagicItems(sheetData), entry] };
  db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(next), character.id);
}

// NPC bids for each day passed, then the ending. Returns news for Discord.
function settleOne(auction, now, random, news) {
  const created = Date.parse(auction.created_at);
  const ends = Date.parse(auction.ends_at);
  const daysPassed = Math.min(DURATION_DAYS, Math.floor((Math.min(now, ends) - created) / DAY_MS));
  let current = { ...auction };
  for (let day = auction.npc_days + 1; day <= daysPassed; day += 1) {
    if (!current.npc_cap_cp || current.current_bidder_npc || random() >= NPC_DAILY_BID_CHANCE) continue;
    const base = current.current_bid_cp || current.opening_bid_cp;
    const bid = Math.max(minNextBid(current), roundGp(base * (1.05 + random() * 0.15)));
    if (bid > current.npc_cap_cp) {
      current.npc_cap_cp = 0; // The NPCs lose interest.
      continue;
    }
    const npc = NPC_BIDDERS[Math.floor(random() * NPC_BIDDERS.length)];
    refundTopBidder(current, `Outbid on ${current.item_name} (auction #${current.id}): bid returned`);
    db.prepare('INSERT INTO auction_bids (auction_id, character_id, npc_name, amount_cp, created_at) VALUES (?, NULL, ?, ?, ?)').run(current.id, npc, bid, iso(created + day * DAY_MS));
    current = { ...current, current_bid_cp: bid, current_bidder_character_id: null, current_bidder_npc: npc };
    news.push({ kind: 'npcBid', auctionId: current.id, item: current.item_name, npc, amountCp: bid });
  }
  db.prepare('UPDATE auctions SET npc_days = ?, npc_cap_cp = ?, current_bid_cp = ?, current_bidder_character_id = ?, current_bidder_npc = ? WHERE id = ?')
    .run(Math.max(auction.npc_days, daysPassed), current.npc_cap_cp, current.current_bid_cp, current.current_bidder_character_id, current.current_bidder_npc, current.id);
  if (now < ends) return;

  const seller = loadCharacter(current.seller_character_id);
  let result;
  if (current.current_bidder_character_id) {
    const winner = loadCharacter(current.current_bidder_character_id);
    giveItem(winner.id, current);
    const paid = Math.round(current.current_bid_cp * (1 - COMMISSION));
    changePurse(seller, paid, `Sold ${current.item_name} at auction #${current.id} (${COMMISSION * 100}% to Grimbold)`);
    result = { status: 'sold', winner: winner.name, priceCp: current.current_bid_cp, sellerGetsCp: paid };
  } else if (current.current_bidder_npc) {
    const paid = Math.round(current.current_bid_cp * (1 - COMMISSION));
    changePurse(seller, paid, `Sold ${current.item_name} at auction #${current.id} (${COMMISSION * 100}% to Grimbold)`);
    result = { status: 'sold', winner: current.current_bidder_npc, priceCp: current.current_bid_cp, sellerGetsCp: paid };
  } else {
    // No bids: Grimbold buys it for the opening bid and shelves it at full value.
    changePurse(seller, current.opening_bid_cp, `Grimbold bought ${current.item_name} (auction #${current.id}, no bids)`);
    db.prepare(`
      INSERT INTO items (name, category, price, stock, description, is_active, source, rarity)
      VALUES (?, 'Magic Item', ?, 1, ?, 1, 'resale', ?)
      ON CONFLICT(name) DO UPDATE SET stock = COALESCE(items.stock, 0) + 1, is_active = 1
    `).run(current.item_name, current.value_cp, `Bought from an adventurer at auction. ${current.rarity} magic item.`, current.rarity);
    result = { status: 'unsold', winner: 'Grimbold', priceCp: current.opening_bid_cp, sellerGetsCp: current.opening_bid_cp };
  }
  db.prepare('UPDATE auctions SET status = ?, closed_at = ?, result = ? WHERE id = ?').run(result.status, iso(now), JSON.stringify(result), current.id);
  news.push({ kind: 'closed', auctionId: current.id, item: current.item_name, seller: seller.name, ...result });
}

// Runs NPC bids and endings that are due. Returns news items for Discord.
function settle({ now = Date.now(), random = Math.random, onlyId = null } = {}) {
  const news = [];
  db.transaction(() => {
    const open = db.prepare(`SELECT * FROM auctions WHERE status = 'open'${onlyId ? ' AND id = ?' : ''}`).all(...(onlyId ? [onlyId] : []));
    open.forEach(auction => settleOne(auction, now, random, news));
  })();
  return news;
}

// DM test tools. An adventurer (NPC) bids now, whatever their interest; a held
// player bid is returned as usual. Returns news for Discord.
function forceNpcBid({ auctionId, now = Date.now(), random = Math.random }) {
  const news = [];
  db.transaction(() => {
    const auction = db.prepare('SELECT * FROM auctions WHERE id = ?').get(Number(auctionId));
    if (!auction || auction.status !== 'open') throw new Error('That auction is not running.');
    const base = auction.current_bid_cp || auction.opening_bid_cp;
    const bid = Math.max(minNextBid(auction), roundGp(base * (1.05 + random() * 0.15)));
    const npc = NPC_BIDDERS[Math.floor(random() * NPC_BIDDERS.length)];
    refundTopBidder(auction, `Outbid on ${auction.item_name} (auction #${auction.id}): bid returned`);
    db.prepare('INSERT INTO auction_bids (auction_id, character_id, npc_name, amount_cp, created_at) VALUES (?, NULL, ?, ?, ?)').run(auction.id, npc, bid, iso(now));
    db.prepare('UPDATE auctions SET current_bid_cp = ?, current_bidder_character_id = NULL, current_bidder_npc = ? WHERE id = ?').run(bid, npc, auction.id);
    news.push({ kind: 'npcBid', auctionId: auction.id, item: auction.item_name, npc, amountCp: bid });
  })();
  return news;
}

// Ends an auction now (DM test): the winner, payout or Grimbold's purchase as at the real end.
function endAuctionNow({ auctionId, now = Date.now() }) {
  const auction = db.prepare('SELECT * FROM auctions WHERE id = ?').get(Number(auctionId));
  if (!auction || auction.status !== 'open') throw new Error('That auction is not running.');
  db.prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(iso(now), auction.id);
  // No more NPC days: only the ending runs.
  db.prepare('UPDATE auctions SET npc_days = ? WHERE id = ?').run(DURATION_DAYS, auction.id);
  return settle({ now, onlyId: auction.id });
}

function auctionView(row) {
  if (!row) return null;
  const sellerName = (db.prepare('SELECT c.name, p.discord_tag FROM characters c JOIN players p ON p.id = c.player_id WHERE c.id = ?').get(row.seller_character_id)) || {};
  const bidder = row.current_bidder_character_id ? db.prepare('SELECT name FROM characters WHERE id = ?').get(row.current_bidder_character_id) : null;
  let result = null;
  try {
    result = row.result ? JSON.parse(row.result) : null;
  } catch {
    result = null;
  }
  return {
    id: row.id,
    item: row.item_name,
    rarity: row.rarity,
    valueCp: row.value_cp,
    openingBidCp: row.opening_bid_cp,
    currentBidCp: row.current_bid_cp,
    highestBidder: bidder ? bidder.name : row.current_bidder_npc,
    highestBidderCharacterId: row.current_bidder_character_id,
    nextBidCp: minNextBid(row),
    seller: sellerName.name || '?',
    sellerPlayer: sellerName.discord_tag || '',
    sellerPlayerId: row.seller_player_id,
    status: row.status,
    createdAt: row.created_at,
    endsAt: row.ends_at,
    closedAt: row.closed_at,
    result,
    bids: db.prepare('SELECT b.amount_cp, b.npc_name, b.created_at, c.name AS character FROM auction_bids b LEFT JOIN characters c ON c.id = b.character_id WHERE b.auction_id = ? ORDER BY b.id DESC LIMIT 10')
      .all(row.id).map(bid => ({ amountCp: bid.amount_cp, by: bid.character || bid.npc_name, at: bid.created_at }))
  };
}

function getAuction(id) {
  return auctionView(db.prepare('SELECT * FROM auctions WHERE id = ?').get(Number(id)));
}

// Open auctions (soonest ending first) and the latest finished ones.
function listAuctions({ now = Date.now() } = {}) {
  const news = settle({ now });
  return {
    news,
    open: db.prepare("SELECT * FROM auctions WHERE status = 'open' ORDER BY ends_at").all().map(auctionView),
    closed: db.prepare("SELECT * FROM auctions WHERE status != 'open' ORDER BY closed_at DESC LIMIT 20").all().map(auctionView)
  };
}

module.exports = {
  AUCTION_DAYS: DURATION_DAYS,
  AUCTION_COMMISSION: COMMISSION,
  auctionItemValue: itemValue,
  sellableItems,
  createAuction,
  placeBid,
  cancelAuction,
  settleAuctions: settle,
  forceNpcBid,
  endAuctionNow,
  getAuction,
  listAuctions
};
