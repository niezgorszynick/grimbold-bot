// rules/gearSales.js — Selling mundane gear back to Grimbold (2024 PHB: gear
// sells for half its price).
//
// The offer is half the catalog price, moved by the owner's weekly d20 (the
// same roll that sets their buying discount, mirrored): nat 20 → 60%,
// 17–19 → 57.5%, 14–16 → 55%, 11–13 → 52.5%, 2–10 → 50%, nat 1 → 45%. Even
// the best buying price (80%) stays above the best selling price, so buying
// to resell never pays. Gems, art and trade goods the DM handed out keep
// their full value (the PHB rule for treasure).
//
// A player sells only gear that was paid for or given: bought in the shop,
// a gift, starting equipment, or added by the DM. Items a player put on their
// own list (or whose count they raised) cost nothing, so only the DM can sell
// those for them. Custom items have no catalog price.

'use strict';

const SELL_SHARE = 0.5;
const PAID_SOURCES = ['shop', 'gift', 'class', 'background'];
const FULL_VALUE_CATEGORY = /\b(trade goods?|gems?|gemstones?|jewel(?:ry|s)?|art objects?)\b/i;

const isCustom = row => row.source === 'custom' || Boolean(row.weapon) || (Array.isArray(row.bonuses) && row.bonuses.length > 0);

// Paid for or given (not added by the player themselves).
function isPaidFor(row) {
  if (!row || row.unsellable || isCustom(row)) return false;
  return PAID_SOURCES.includes(row.source) || (row.source === 'catalog' && row.addedBy === 'dm');
}

// Two rows stack only when both are paid for, or neither is.
const sameSaleStatus = (a, b) => isPaidFor(a) === isPaidFor(b);

// discountPercent: the weekly roll's buying discount (−20 … +10), 0 without a roll.
const sellShare = (discountPercent = 0) => SELL_SHARE * (1 - (Number(discountPercent) || 0) / 100);

// What Grimbold offers for one of an equipment row: { unitCp, share, fullValue }
// or { unitCp: 0, reason } when he won't buy it. catalogRow: the mundane
// catalog row of that name (or null). isAdmin: the DM sells for a player.
function gearOffer(row, { catalogRow = null, discountPercent = 0, isAdmin = false } = {}) {
  if (isCustom(row)) return { unitCp: 0, reason: 'Custom items have no shop price. The DM can buy it from you by hand.' };
  if (!catalogRow || !(catalogRow.base_price_cp > 0)) return { unitCp: 0, reason: "Grimbold doesn't trade in this (it isn't in his catalog)." };
  if (!isAdmin && !isPaidFor(row)) return { unitCp: 0, reason: 'Added to the list by hand, so Grimbold only buys it through the DM.' };
  const fullValue = FULL_VALUE_CATEGORY.test(catalogRow.category || '') && row.source === 'catalog' && row.addedBy === 'dm';
  const share = fullValue ? 1 : sellShare(discountPercent);
  // Whole-number maths: 57.5% of 15 gp is 863 cp, not 862.
  const unitCp = fullValue ? catalogRow.base_price_cp : Math.round(catalogRow.base_price_cp * (100 - (Number(discountPercent) || 0)) / 200);
  return { unitCp: Math.max(1, unitCp), share, fullValue };
}

module.exports = { SELL_SHARE, isPaidFor, sameSaleStatus, sellShare, gearOffer };
