// shop.js — Buying from Grimbold's counter. Used by both the web shop and the
// Discord /buy command, so the price (with the buyer's weekly roll), stock,
// the character's purse, their inventory and the sales ledger always change
// together in one transaction.

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
function addToSheet(sheetJson, itemName, quantity) {
  let sheet = {};
  try {
    sheet = JSON.parse(sheetJson || '{}') || {};
  } catch {
    sheet = {};
  }
  const magic = rules.matchMagicItem(itemName);
  if (magic && (magic.variant || !magic.item.variants.length)) {
    const magicItems = rules.grantMagicItem(sheet, { name: itemName, quantity, source: 'shop' });
    return JSON.stringify({ ...sheet, magicItems });
  }
  const inventory = Array.isArray(sheet.inventory) ? sheet.inventory.map(row => ({ ...row })) : [];
  const existing = inventory.find(row => row.name === itemName && !row.description);
  if (existing) existing.quantity += quantity;
  else inventory.push({ name: itemName, quantity, source: 'shop' });
  return JSON.stringify({ ...sheet, inventory });
}

function purchaseItem({ itemName, quantity = 1, characterId, playerId, buyerTag, buyerDiscordId }) {
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
    if (character.gold_cp < totalCostCp) {
      throw new PurchaseError(
        `Insufficient funds. ${character.name} has ${formatCp(character.gold_cp)}, but this costs ${formatCp(totalCostCp)}.`
      );
    }

    db.prepare('UPDATE characters SET gold_cp = gold_cp - ?, sheet_data = ? WHERE id = ?')
      .run(totalCostCp, addToSheet(character.sheet_data, item.name, qty), character.id);
    if (item.stock !== null) {
      db.prepare('UPDATE items SET stock = stock - ? WHERE id = ?').run(qty, item.id);
    }
    db.prepare(`
      INSERT INTO sales (
        item_name, category, quantity, buyer_tag, buyer_id,
        base_price, discount_percent, final_price, total_paid, character_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.name, item.category, qty, buyerTag || '', String(buyerDiscordId || ''),
      item.price, quote.discountPercent, quote.unitPriceCp, totalCostCp, character.id
    );

    return {
      item,
      character: { id: character.id, name: character.name, gold_cp: character.gold_cp - totalCostCp },
      quantity: qty,
      basePriceCp: item.price,
      discountPercent: quote.discountPercent,
      finalUnitPriceCp: quote.unitPriceCp,
      totalCostCp,
      remainingStock: item.stock !== null ? item.stock - qty : null
    };
  })();
}

module.exports = { PurchaseError, quoteItem, getShoppingCharacters, findPlayerByDiscordId, purchaseItem };
