// rules/shopCatalog.js — Rarity, fair price and shop availability of Master
// Catalog items (Grimbold's shop).
//
// Rarity comes from the magic item list (rules/content/magic_items.md) when the
// name matches, from the spell level for spell scrolls, and otherwise from the
// 2024 price-by-rarity table the catalog's magic items already follow
// (100 / 400 / 4,000 / 40,000 / 200,000 gp; consumables cost half). Mundane
// gear has no rarity.
//
// Availability: 'shop' (may be rolled into the weekly stock) or 'adventure'
// (only given out in adventures). Rare and rarer items default to adventure
// only; a DM can open a Rare item to the shop, never a Very Rare or Legendary.

const { matchMagicItem, getMagicItemCatalog, MAGIC_ITEM_PRICE_GP, MAGIC_ITEM_RARITIES } = require('./magicItems');
const { findSpell } = require('./spells');

const RARITIES = MAGIC_ITEM_RARITIES.filter(rarity => rarity !== 'Artifact');
const AVAILABILITY = ['shop', 'adventure'];
// Always adventure only, whatever the catalog says.
const ADVENTURE_ONLY_RARITIES = ['Very Rare', 'Legendary', 'Artifact'];
// The usual level gate per rarity (the catalog already uses these).
const MIN_LEVEL = { Common: 1, Uncommon: 3, Rare: 5, 'Very Rare': 11, Legendary: 17 };
// Spell scrolls (2024): rarity by spell level.
const SCROLL_RARITY = ['Common', 'Common', 'Uncommon', 'Uncommon', 'Rare', 'Rare', 'Very Rare', 'Very Rare', 'Very Rare', 'Legendary'];

// "Spell Scroll (Level 1: Shield)", or "Scroll of Plant Growth" for a known spell.
function scrollLevel(name) {
  const match = String(name || '').match(/^Spell Scroll \((Cantrip|Level (\d))\s*:/i);
  if (match) return match[2] ? Number(match[2]) : 0;
  const named = String(name || '').match(/^Scroll of (.+)$/i);
  const spell = named && findSpell(named[1].trim());
  return spell && Number.isInteger(spell.level) ? spell.level : null;
}

// Potions, scrolls and ammunition are consumables and cost half.
function isConsumable(name, category) {
  return /^(potion|scroll|spell scroll)$/i.test(String(category || '').trim()) ||
    /\b(potion|elixir|philter|oil of|scroll|ammunition|arrows?|bolts?|bullets?|needles)\b/i.test(String(name || ''));
}

function rarityFromPrice(priceCp, consumable) {
  const gp = priceCp / 100;
  return RARITIES.find(rarity => MAGIC_ITEM_PRICE_GP[rarity] * (consumable ? 0.5 : 1) === gp) ||
    RARITIES.find(rarity => MAGIC_ITEM_PRICE_GP[rarity] === gp || MAGIC_ITEM_PRICE_GP[rarity] / 2 === gp) || null;
}

function defaultAvailability(rarity) {
  return rarity && (ADVENTURE_ONLY_RARITIES.includes(rarity) || rarity === 'Rare') ? 'adventure' : 'shop';
}

// What the catalog row should be: { rarity, priceCp (null = keep), availability,
// minLevel (null = keep), source }. row: a catalog row.
function classifyCatalogItem(row, magicCatalog = getMagicItemCatalog()) {
  const consumable = isConsumable(row.name, row.category);
  const level = scrollLevel(row.name);
  if (level !== null) {
    // Scroll prices follow the spellcasting-services table; only the rarity is set.
    const rarity = SCROLL_RARITY[level];
    return { rarity, priceCp: null, availability: defaultAvailability(rarity), minLevel: null, source: 'spell level' };
  }
  const match = matchMagicItem(row.name, magicCatalog);
  let rarity = match ? ((match.variant && match.variant.rarity) || match.item.rarity) : null;
  let source = 'magic item list';
  if (!RARITIES.includes(rarity) && rarity !== 'Artifact') {
    rarity = row.tier === 'magic' || match ? rarityFromPrice(row.base_price_cp, consumable) : null;
    source = rarity ? 'price' : 'mundane';
  }
  if (!rarity) return { rarity: '', priceCp: null, availability: 'shop', minLevel: null, source };
  const priceCp = MAGIC_ITEM_PRICE_GP[rarity] ? Math.round(MAGIC_ITEM_PRICE_GP[rarity] * (consumable ? 0.5 : 1) * 100) : null;
  return { rarity, priceCp, availability: defaultAvailability(rarity), minLevel: MIN_LEVEL[rarity] || null, source };
}

// The changes a review would make, row by row (only rows with a change).
// Each: { id, name, source, changes: { rarity?, base_price_cp?, availability?, min_level? }, current }.
function reviewCatalog(rows, magicCatalog = getMagicItemCatalog()) {
  const result = [];
  for (const row of rows) {
    const proposal = classifyCatalogItem(row, magicCatalog);
    const changes = {};
    if ((row.rarity || '') !== proposal.rarity) changes.rarity = proposal.rarity;
    if (proposal.priceCp !== null && proposal.priceCp !== row.base_price_cp) changes.base_price_cp = proposal.priceCp;
    // Availability is only proposed for rows never reviewed (no rarity yet) or
    // rarities that must stay out of the shop; a DM's own choice is kept.
    const mustBeAdventure = ADVENTURE_ONLY_RARITIES.includes(proposal.rarity) && row.availability !== 'adventure';
    if ((!row.rarity && (row.availability || 'shop') !== proposal.availability) || mustBeAdventure) changes.availability = proposal.availability;
    if (proposal.minLevel !== null && proposal.minLevel !== row.min_level) changes.min_level = proposal.minLevel;
    if (Object.keys(changes).length) {
      result.push({
        id: row.id,
        name: row.name,
        source: proposal.source,
        changes,
        current: { rarity: row.rarity || '', base_price_cp: row.base_price_cp, availability: row.availability || 'shop', min_level: row.min_level }
      });
    }
  }
  return result;
}

// Checks a DM's own rarity/availability choice for a catalog item.
function validateShopFields({ rarity, availability }) {
  const cleanRarity = rarity === undefined || rarity === null ? '' : String(rarity);
  if (cleanRarity && !RARITIES.includes(cleanRarity)) throw new Error(`Rarity must be one of: ${RARITIES.join(', ')} (or none for mundane gear).`);
  const cleanAvailability = availability ? String(availability) : defaultAvailability(cleanRarity);
  if (!AVAILABILITY.includes(cleanAvailability)) throw new Error('Availability must be shop or adventure.');
  if (cleanAvailability === 'shop' && ADVENTURE_ONLY_RARITIES.includes(cleanRarity)) {
    throw new Error(`${cleanRarity} items are given out in adventures only.`);
  }
  return { rarity: cleanRarity, availability: cleanAvailability };
}

module.exports = {
  SHOP_RARITIES: RARITIES,
  SHOP_AVAILABILITY: AVAILABILITY,
  ADVENTURE_ONLY_RARITIES,
  classifyCatalogItem,
  reviewCatalog,
  validateShopFields,
  isConsumable
};
