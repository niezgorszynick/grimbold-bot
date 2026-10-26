// shop.js — Buying from Grimbold's counter. Used by both the web shop and the
// Discord /buy command, so the price (with the buyer's weekly roll), stock,
// the character's purse, their inventory and the sales ledger always change
// together in one transaction. Bought as a gift (giftToCharacterId), the
// buyer's character pays and the item goes to the other character's sheet.

const db = require('./db');
const { getUserRoll, getDiscount, applyModifier } = require('./rollTracker');
const { formatCp } = require('./currency');
const rules = require('./rules');

// A purchase that was refused for a reason the buyer should see.
class PurchaseError extends Error {}

// Unit price for this buyer after their weekly d20 roll (if they rolled).
function quoteItem(item, buyerDiscordId) {
  const roll = buyerDiscordId ? getUserRoll(buyerDiscordId) : null;
  const modifier = roll === null ? null : getDiscount(roll);
  return {
    roll,
    discountPercent: modifier ? modifier.percent : 0,
    unitPriceCp: modifier ? applyModifier(item.price, modifier) : item.price
  };
}

// Living characters a player can buy for, with their purse.
function getShoppingCharacters(playerId) {
  return db.prepare(`
    SELECT id, name, level, gold_cp
    FROM characters
    WHERE player_id = ? AND status = 'alive'
    ORDER BY name
  `).all(Number(playerId));
}

function findPlayerByDiscordId(discordId) {
  return db.prepare('SELECT id, discord_id, discord_tag FROM players WHERE discord_id = ?').get(String(discordId)) || null;
}

// Adds the item to the sheet: magic items to the Magic Items list, anything
// else to the equipment list.
function addToSheet(sheetJson, itemName, quantity, source = 'shop') {
  let sheet = {};
  try {
    sheet = JSON.parse(sheetJson || '{}') || {};
  } catch {
    sheet = {};
  }
  const magic = rules.matchMagicItem(itemName);
  if (magic && (magic.variant || !magic.item.variants.length)) {
    const magicItems = rules.grantMagicItem(sheet, { name: itemName, quantity, source });
    return JSON.stringify({ ...sheet, magicItems });
  }
  const inventory = Array.isArray(sheet.inventory) ? sheet.inventory.map(row => ({ ...row })) : [];
  const existing = inventory.find(row => row.name === itemName && !row.description && !row.nickname);
  if (existing) existing.quantity += quantity;
  else inventory.push({ name: itemName, quantity, source });
  return JSON.stringify({ ...sheet, inventory });
}

function purchaseItem({ itemName, quantity = 1, characterId, playerId, buyerTag, buyerDiscordId, giftToCharacterId = null, giftNote = '' }) {
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new PurchaseError('Invalid quantity.');

  return db.transaction(() => {
    const character = db.prepare(`
      SELECT id, name, player_id, status, gold_cp, sheet_data
      FROM characters
      WHERE id = ?
    `).get(Number(characterId));
    if (!character || character.player_id !== Number(playerId)) {
      throw new PurchaseError("Character not found or doesn't belong to you.");
    }
    if (character.status !== 'alive') {
      throw new PurchaseError(`${character.name} is no longer among the living and cannot shop.`);
    }
    let recipient = null;
    let note = '';
    if (giftToCharacterId !== null && giftToCharacterId !== undefined && giftToCharacterId !== '') {
      try {
        recipient = db.loadGiftRecipient(giftToCharacterId, character.id);
        note = db.cleanGiftNote(giftNote);
      } catch (error) {
        throw new PurchaseError(error.message);
      }
    }

    const item = db.prepare(`
      SELECT * FROM items WHERE name = ? COLLATE NOCASE AND is_active = 1
    `).get(String(itemName || '').trim());
    if (!item) throw new PurchaseError('Item is not available in the shop.');
    if (item.stock !== null && item.stock < qty) {
      throw new PurchaseError(`Insufficient stock. Only ${item.stock} left.`);
    }

    const quote = quoteItem(item, buyerDiscordId);
    const totalCostCp = quote.unitPriceCp * qty;
    if (!Number.isSafeInteger(totalCostCp)) throw new PurchaseError('Purchase amount is too large.');
    // This character reserved it: the deposit already paid comes off.
    const ownReservation = db.prepare("SELECT * FROM reservations WHERE item_id = ? AND character_id = ? AND status = 'active'").get(item.id, character.id);
    const depositUsedCp = ownReservation ? Math.min(ownReservation.deposit_cp, totalCostCp) : 0;
    const dueCp = totalCostCp - depositUsedCp;
    if (character.gold_cp < dueCp) {
      throw new PurchaseError(
        `Insufficient funds. ${character.name} has ${formatCp(character.gold_cp)}, but this costs ${formatCp(dueCp)}${depositUsedCp ? ` (after the ${formatCp(depositUsedCp)} deposit)` : ''}.`
      );
    }

    if (recipient) {
      db.prepare('UPDATE characters SET gold_cp = gold_cp - ? WHERE id = ?').run(dueCp, character.id);
      db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(addToSheet(recipient.sheet_data, item.name, qty, 'gift'), recipient.id);
    } else {
      db.prepare('UPDATE characters SET gold_cp = gold_cp - ?, sheet_data = ? WHERE id = ?')
        .run(dueCp, addToSheet(character.sheet_data, item.name, qty), character.id);
    }
    if (item.stock !== null) {
      db.prepare('UPDATE items SET stock = stock - ? WHERE id = ?').run(qty, item.id);
    }
    if (ownReservation) db.endReservation(ownReservation, 'bought');
    // Someone else bought the last one: Grimbold refunds the reserver's deposit.
    let refunded = null;
    const othersReservation = item.stock !== null && item.stock - qty <= 0 ? db.activeReservationOfItem(item.id) : null;
    if (othersReservation) refunded = db.endReservation(othersReservation, 'refunded', { refund: true, reason: `Deposit refunded: ${item.name} was sold to someone else` });
    db.prepare(`
      INSERT INTO sales (
        item_name, category, quantity, buyer_tag, buyer_id,
        base_price, discount_percent, final_price, total_paid, character_id, gift_to_character_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.name, item.category, qty, buyerTag || '', String(buyerDiscordId || ''),
      item.price, quote.discountPercent, quote.unitPriceCp, totalCostCp, character.id, recipient ? recipient.id : null
    );
    const gift = recipient
      ? db.recordGift({ fromId: character.id, toId: recipient.id, itemName: item.name, quantity: qty, kind: 'shop', note, givenBy: Number(playerId), costCp: totalCostCp })
      : null;

    return {
      item,
      character: { id: character.id, name: character.name, gold_cp: character.gold_cp - dueCp },
      depositUsedCp,
      refundedReservation: refunded,
      quantity: qty,
      basePriceCp: item.price,
      discountPercent: quote.discountPercent,
      finalUnitPriceCp: quote.unitPriceCp,
      totalCostCp,
      remainingStock: item.stock !== null ? item.stock - qty : null,
      gift
    };
  })();
}

// Reserves a shelf item for one of the player's characters: a 10% deposit
// of their own price now (it comes off the price when they buy), and the item
// stays through the next two restocks (db/reservations.js).
function reserveItem({ itemName, characterId, playerId, buyerDiscordId }) {
  return db.transaction(() => {
    const character = db.prepare('SELECT id, name, player_id, status, gold_cp FROM characters WHERE id = ?').get(Number(characterId));
    if (!character || character.player_id !== Number(playerId)) throw new PurchaseError("Character not found or doesn't belong to you.");
    if (character.status !== 'alive') throw new PurchaseError(`${character.name} is no longer among the living.`);
    const item = db.prepare('SELECT * FROM items WHERE name = ? COLLATE NOCASE AND is_active = 1').get(String(itemName || '').trim());
    if (!item) throw new PurchaseError('Item is not available in the shop.');
    if (!db.RESERVABLE_SOURCES.includes(item.source)) throw new PurchaseError(`${item.name} is always on the shelf; there is no need to reserve it.`);
    if (item.stock === 0) throw new PurchaseError(`${item.name} is sold out.`);
    const mine = db.activeReservationOfCharacter(character.id);
    if (mine) throw new PurchaseError(`${character.name} already has ${mine.item_name} reserved; buy it or cancel that reservation first.`);
    const taken = db.activeReservationOfItem(item.id);
    if (taken) throw new PurchaseError(`${item.name} is already reserved by someone else.`);
    const depositCp = db.reservationDepositFor(quoteItem(item, buyerDiscordId).unitPriceCp);
    if (character.gold_cp < depositCp) throw new PurchaseError(`The deposit is ${formatCp(depositCp)}, but ${character.name} has ${formatCp(character.gold_cp)}.`);
    db.prepare('UPDATE characters SET gold_cp = gold_cp - ? WHERE id = ?').run(depositCp, character.id);
    db.recordGoldChange({ characterId: character.id, user: { id: Number(playerId), role: 'player' }, oldCp: character.gold_cp, newCp: character.gold_cp - depositCp, reason: `Deposit: ${item.name} reserved at Grimbold's` });
    const id = Number(db.prepare(`
      INSERT INTO reservations (item_id, item_name, character_id, player_id, deposit_cp, restocks_left) VALUES (?, ?, ?, ?, ?, ?)
    `).run(item.id, item.name, character.id, character.player_id, depositCp, db.RESERVATION_HOLD_RESTOCKS).lastInsertRowid);
    return { reservation: db.getReservation(id), purseCp: character.gold_cp - depositCp, priceCp: item.price };
  })();
}

module.exports = { PurchaseError, quoteItem, getShoppingCharacters, findPlayerByDiscordId, purchaseItem, reserveItem };
