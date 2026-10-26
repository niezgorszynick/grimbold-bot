// db/gifts.js — Gifts between characters: an item from one sheet's equipment
// or Magic Items list moves to another character's sheet, and Grimbold logs
// it (the gifts table; characterThreads.js posts his note in both threads).
// Shop purchases bought for someone else are logged here too (shop.js).

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { combatWithArmorClass } = require('./combat');

const MAX_NOTE = 300;

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('Stored character sheet data is invalid.');
  }
}

function classRowsOf(character) {
  const rows = db.prepare('SELECT class_name, subclass_name, class_level FROM character_classes WHERE character_id = ? ORDER BY is_primary DESC, id')
    .all(character.id);
  return rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
}

// HP maximum and Armor Class follow what the character now has (an attuned
// item may have raised them).
function settle(character, sheetData) {
  let next = sheetData;
  try {
    const context = rules.deriveVitalsContext({ species: character.race, sheetData: next, classRows: classRowsOf(character) });
    next = { ...next, hpMax: context.hpMax };
  } catch {
    // Keep the stored maximum if the sheet can't be worked out.
  }
  return combatWithArmorClass(character, next);
}

const newUid = () => `mi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Living characters who can receive a gift (everyone's), with their player.
function listGiftRecipients() {
  return db.prepare(`
    SELECT c.id, c.name, c.level, c.player_id, p.discord_tag AS player
    FROM characters c JOIN players p ON p.id = c.player_id
    WHERE c.status = 'alive' ORDER BY c.name COLLATE NOCASE
  `).all().map(row => ({ id: row.id, name: row.name, level: row.level, playerId: row.player_id, player: row.player }));
}

function cleanNote(value) {
  const note = String(value || '').replace(/\s+/g, ' ').trim();
  if (note.length > MAX_NOTE) throw new Error(`A gift note can be ${MAX_NOTE} characters at most.`);
  return note;
}

function loadRecipient(toId, fromId) {
  const recipient = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(toId));
  if (!recipient) throw new Error('Choose who the gift is for.');
  if (recipient.id === Number(fromId)) throw new Error('A character cannot give a gift to themselves.');
  if (recipient.status !== 'alive') throw new Error(`${recipient.name} is no longer among the living.`);
  return recipient;
}

// The gift as logged; returned to the routes for Grimbold's notes.
function recordGift({ fromId, toId, itemName, quantity, kind, note, givenBy, costCp = 0 }) {
  const id = Number(db.prepare(`
    INSERT INTO gifts (from_character_id, to_character_id, item_name, quantity, kind, note, given_by_player_id, cost_cp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fromId, toId, itemName, quantity, kind, note || '', givenBy > 0 ? givenBy : null, costCp).lastInsertRowid);
  return getGift(id);
}

function getGift(id) {
  const row = db.prepare(`
    SELECT g.*, f.name AS from_name, t.name AS to_name, p.discord_tag AS given_by_tag
    FROM gifts g JOIN characters f ON f.id = g.from_character_id JOIN characters t ON t.id = g.to_character_id
    LEFT JOIN players p ON p.id = g.given_by_player_id WHERE g.id = ?
  `).get(Number(id));
  return row ? giftView(row) : null;
}

function giftView(row) {
  return {
    id: row.id,
    from: { id: row.from_character_id, name: row.from_name },
    to: { id: row.to_character_id, name: row.to_name },
    item: row.item_name,
    quantity: row.quantity,
    kind: row.kind,
    note: row.note || '',
    costCp: row.cost_cp || 0,
    givenBy: row.given_by_tag || null,
    createdAt: row.created_at
  };
}

// The latest gifts, newest first (the Sales Ledger tab).
function listGifts({ limit = 100 } = {}) {
  return db.prepare(`
    SELECT g.*, f.name AS from_name, t.name AS to_name, p.discord_tag AS given_by_tag
    FROM gifts g JOIN characters f ON f.id = g.from_character_id JOIN characters t ON t.id = g.to_character_id
    LEFT JOIN players p ON p.id = g.given_by_player_id ORDER BY g.id DESC LIMIT ?
  `).all(Math.min(500, Number(limit) || 100)).map(giftView);
}

// Puts an equipment row (a copy, put away) on a sheet: stacks with a plain
// row of the same item, otherwise a row of its own (nickname, weapon stats
// and bonuses go with it).
function receiveInventoryRow(sheetData, row, quantity) {
  const inventory = (Array.isArray(sheetData.inventory) ? sheetData.inventory : []).map(entry => ({ ...entry }));
  const plain = !row.nickname && !row.weapon && !(Array.isArray(row.bonuses) && row.bonuses.length);
  const stack = plain && inventory.find(entry => entry && entry.name && !entry.nickname && !entry.weapon &&
    !(Array.isArray(entry.bonuses) && entry.bonuses.length) &&
    entry.name.toLowerCase() === row.name.toLowerCase() && (entry.description || '') === (row.description || ''));
  if (stack) {
    stack.quantity = Math.min(9999, (Number(stack.quantity) || 1) + quantity);
  } else {
    const copy = { ...row, quantity };
    delete copy.equipped;
    if (rules.inventoryGear(copy)) copy.equipped = false;
    inventory.push(copy);
  }
  return { ...sheetData, inventory };
}

// Puts a magic item on a sheet: not worn, not attuned, its charges kept;
// consumables stack.
function receiveMagicItem(sheetData, entry, quantity) {
  const list = rules.readMagicItems(sheetData).map(item => ({ ...item }));
  const info = rules.magicItemEntryInfo(entry);
  const consumable = Boolean(info.item && info.item.consumable);
  const stack = consumable && !entry.nickname && list.find(item => item.name === entry.name &&
    (item.variant || null) === (entry.variant || null) && (item.label || null) === (entry.label || null) && !item.nickname);
  if (stack) stack.quantity = (stack.quantity || 1) + quantity;
  else list.push({ ...entry, uid: newUid(), quantity, equipped: false, attuned: false, source: 'gift' });
  return { ...sheetData, magicItems: list };
}

// request: { toCharacterId, kind: 'item' | 'magic', index + name (equipment)
// or uid (magic), quantity, note }. The giver's player (or a DM).
function giveItem({ characterId, user, request = {} }) {
  return db.transaction(() => {
    const giver = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(characterId));
    if (!giver) throw new Error('Character not found.');
    const isAdmin = user && user.role === 'admin';
    if (!isAdmin && giver.player_id !== Number(user && user.id)) throw new Error('Forbidden.');
    if (giver.status !== 'alive') throw new Error(`${giver.name} is no longer among the living.`);
    const recipient = loadRecipient(request.toCharacterId, giver.id);
    const note = cleanNote(request.note);
    const giverSheet = readSheet(giver.sheet_data);
    let nextGiver;
    let nextRecipient;
    let itemName;
    let quantity;

    if (request.kind === 'magic') {
      const list = rules.readMagicItems(giverSheet).map(entry => ({ ...entry }));
      const entry = list.find(item => item.uid === request.uid);
      if (!entry) throw new Error(`${giver.name} does not have that magic item.`);
      const have = Number(entry.quantity) || 1;
      quantity = request.quantity === undefined ? 1 : Number(request.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > have) throw new Error(`Give from 1 to ${have}.`);
      itemName = rules.magicItemDisplayName(entry);
      const remaining = have === quantity ? list.filter(item => item !== entry) : list.map(item => (item === entry ? { ...item, quantity: have - quantity } : item));
      nextGiver = { ...giverSheet, magicItems: remaining };
      nextRecipient = receiveMagicItem(readSheet(recipient.sheet_data), entry, quantity);
    } else {
      const inventory = (Array.isArray(giverSheet.inventory) ? giverSheet.inventory : []).map(row => ({ ...row }));
      const index = Number(request.index);
      const row = Number.isSafeInteger(index) ? inventory[index] : null;
      if (!row || row.name !== request.name) throw new Error('The item list changed. Reload the page and try again.');
      const have = Number.isSafeInteger(row.quantity) && row.quantity > 0 ? row.quantity : 1;
      quantity = request.quantity === undefined ? have : Number(request.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > have) throw new Error(`Give from 1 to ${have}.`);
      itemName = row.nickname ? `${row.nickname} (${row.name})` : row.name;
      if (quantity === have) inventory.splice(index, 1);
      else row.quantity = have - quantity;
      nextGiver = { ...giverSheet, inventory };
      nextRecipient = receiveInventoryRow(readSheet(recipient.sheet_data), row, quantity);
    }

    const update = db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?');
    update.run(JSON.stringify(settle(giver, nextGiver)), giver.id);
    update.run(JSON.stringify(settle(recipient, nextRecipient)), recipient.id);
    const gift = recordGift({ fromId: giver.id, toId: recipient.id, itemName, quantity, kind: request.kind === 'magic' ? 'magic' : 'item', note, givenBy: Number(user && user.id) || 0 });
    return { gift, message: `${quantity > 1 ? `${quantity} × ` : ''}${itemName} given to ${recipient.name}.` };
  })();
}

module.exports = { listGiftRecipients, giveItem, recordGift, getGift, listGifts, receiveInventoryRow, receiveMagicItem, loadGiftRecipient: loadRecipient, cleanGiftNote: cleanNote };
