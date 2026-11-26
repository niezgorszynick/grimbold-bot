// db/inventory.js — A character's equipment list (sheetData.inventory): items
// from the shop catalog or custom items with their own description. Magic
// items go to the Magic Items list instead (see db/magicItems.js).

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { combatWithArmorClass } = require('./combat');
const { recordGoldChange } = require('./gold');
const { formatCp } = require('../currency');

const MAX_QUANTITY = 9999;

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('Stored character sheet data is invalid.');
  }
}

function loadCharacter(characterId, playerId, isAdmin) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) throw new Error('Character not found.');
  if (!isAdmin && character.player_id !== Number(playerId)) throw new Error('Forbidden.');
  return character;
}

function readInventory(sheetData) {
  const list = sheetData.inventory;
  return Array.isArray(list)
    ? list.filter(row => row && typeof row === 'object' && typeof row.name === 'string' && row.name.trim())
    : [];
}

function cleanText(value, max, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) throw new Error(`${label} must be at most ${max} characters.`);
  return text;
}

function cleanQuantity(value) {
  const quantity = value === undefined || value === '' ? 1 : Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new Error(`Quantity must be between 1 and ${MAX_QUANTITY}.`);
  }
  return quantity;
}

// Shop catalog items a sheet can add (services such as lodging excluded).
function getCatalogForSheets() {
  return db.prepare(`
    SELECT id, name, category, description, base_price_cp, rarity, tier FROM catalog WHERE tier != 'service' ORDER BY name COLLATE NOCASE
  `).all();
}

// The catalog row Grimbold prices a piece of mundane gear by (none for magic items).
function mundaneCatalogRow(name, catalog) {
  const known = catalog.get(String(name || '').toLowerCase());
  if (!known || known.rarity || known.tier === 'magic' || rules.matchMagicItem(known.name)) return null;
  return known;
}

// The owner's weekly roll, which moves Grimbold's offers: { roll, discountPercent }.
function saleContext(character) {
  const owner = db.prepare('SELECT discord_id FROM players WHERE id = ?').get(character.player_id);
  // Required here: rollTracker loads the whole db module.
  const { getUserRoll, getDiscount } = require('../rollTracker');
  const roll = owner && owner.discord_id ? getUserRoll(owner.discord_id) : null;
  return { roll, discountPercent: roll === null ? 0 : getDiscount(roll).percent };
}

function buildView(sheetData, isAdmin, sale = { roll: null, discountPercent: 0 }) {
  const catalog = new Map(getCatalogForSheets().map(row => [row.name.toLowerCase(), row]));
  return {
    items: readInventory(sheetData).map((row, index) => {
      const known = catalog.get(row.name.toLowerCase());
      const gear = rules.inventoryGear(row);
      return {
        index,
        name: row.name,
        nickname: row.nickname || null,
        // A custom weapon's own stats, for the editor.
        weapon: row.weapon || null,
        // Custom bonuses (rules/itemBonuses.js) and whether they apply now.
        bonuses: Array.isArray(row.bonuses) ? row.bonuses.map(bonus => ({ ...bonus, text: rules.describeItemBonus(bonus) })) : [],
        bonusesActive: row.bonusesActive !== false,
        // Custom properties (rules/itemProperties.js), with the uses spent.
        properties: Array.isArray(row.properties) ? row.properties.map(property => ({
          ...property,
          usesText: rules.describeItemPropertyUses(property.uses),
          used: property.uses ? Math.min(property.uses.max, Number(((sheetData.resourcesUsed || {})[`itemProp:${property.id}`])) || 0) : 0
        })) : [],
        quantity: Number.isSafeInteger(row.quantity) && row.quantity > 0 ? row.quantity : 1,
        source: row.source || '',
        category: row.category || (known ? known.category : ''),
        // Armor, shields and weapons can be worn or wielded.
        gear: gear ? { type: gear.type, name: gear.name, stats: rules.describeGear(gear) } : null,
        worn: gear ? rules.isWornByDefault(row, gear, sheetData) : false,
        // A custom description wins; otherwise the catalog's.
        description: row.description || (known ? known.description : ''),
        // What Grimbold pays for one: { unitCp, share } or { unitCp: 0, reason }.
        sale: rules.gearOffer(row, { catalogRow: mundaneCatalogRow(row.name, catalog), discountPercent: sale.discountPercent, isAdmin }),
        // Whether the player could sell it themselves (the DM's switch).
        playerSaleBlocked: Boolean(rules.playerSaleBlock(row, mundaneCatalogRow(row.name, catalog))),
        sellableByDm: Boolean(row.sellable)
      };
    }),
    // The owner's weekly roll behind the offers (null: not rolled this week).
    saleRoll: sale.roll,
    // DMs let a player sell gear the sheet thinks wasn't paid for.
    isAdmin: Boolean(isAdmin),
    // Choices for custom weapon stats.
    weaponOptions: { bases: Object.keys(rules.WEAPONS), damageTypes: rules.DAMAGE_TYPES, actions: rules.WEAPON_ACTIONS, maxExtraDamage: rules.MAX_EXTRA_DAMAGE },
    // What item bonuses add up to now, for the skill and save numbers.
    itemBonuses: rules.itemBonusTotals(sheetData),
    // Choices for a custom bonus.
    bonusTargets: {
      skills: Object.keys(rules.SKILLS).sort(),
      abilities: ['str', 'dex', 'con', 'int', 'wis', 'cha']
    }
  };
}

function getCharacterInventory({ id, player_id, is_admin }) {
  const character = loadCharacter(id, player_id, is_admin);
  return buildView(readSheet(character.sheet_data), is_admin, saleContext(character));
}

// action: add { catalogId | name, quantity, description }
//       | update { index, name, quantity } | remove { index, name }
//       | wear { index, name, worn } (armor, shields and weapons)
//       | rename { index, name, nickname } | setWeapon { index, name, weapon | null } (custom items)
//       | setBonuses { index, name, bonuses } | useBonuses { index, name, active }
//       | setProperties { index, name, properties } (custom properties, rules/itemProperties.js)
//       | sell { index, name, quantity } (to Grimbold, see rules/gearSales.js)
//       | allowSale { index, name, allowed } | allowSaleAll (DMs: the player may sell it)
// add with weapon stats (custom items): see rules/customWeapons.js.
// `name` with update/remove guards against a list changed in another tab.
function changeCharacterInventory({ id, player_id, is_admin, action, params = {} }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    const inventory = readInventory(sheetData).map(row => ({ ...row }));
    let nextSheet;
    let message;
    let sold = null;

    if (action === 'add') {
      const quantity = cleanQuantity(params.quantity);
      let name;
      let description = '';
      let category = '';
      let source = 'custom';
      if (params.catalogId !== undefined && params.catalogId !== null && params.catalogId !== '') {
        const row = db.prepare("SELECT * FROM catalog WHERE id = ? AND tier != 'service'").get(Number(params.catalogId));
        if (!row) throw new Error('That item is not in the catalog.');
        ({ name, category } = row);
        source = 'catalog';
      } else {
        name = cleanText(params.name, 100, 'Item name');
        if (!name) throw new Error('Give the item a name.');
        description = cleanText(params.description, 2000, 'Description');
      }
      // A custom weapon: its own stats, so it attacks and rolls like any weapon.
      const customWeapon = source === 'custom' && params.weapon ? rules.validateCustomWeapon(params.weapon) : null;
      const bonuses = rules.validateItemBonuses(params.bonuses);

      const magic = rules.matchMagicItem(name);
      if (magic && (magic.variant || !magic.item.variants.length) && source === 'catalog') {
        // Items a player adds are marked, so the DM can see where they came from.
        const magicItems = rules.grantMagicItem(sheetData, { name, quantity, source: is_admin ? 'dm' : 'player' });
        nextSheet = { ...sheetData, magicItems };
        message = `${name} added to Magic Items.`;
      } else {
        // A nicknamed item ("Ambassador") stays its own row.
        const added = { name, quantity, source };
        // The DM's additions (loot) can be sold; a player's own can't.
        if (source === 'catalog' && is_admin) added.addedBy = 'dm';
        // Not onto an item made special by hand (bonuses, properties: a Rapier with a Sylvan Talon).
        const existing = customWeapon || bonuses.length ? null : inventory.find(row => !row.nickname && !row.weapon &&
          !(Array.isArray(row.bonuses) && row.bonuses.length) && !(Array.isArray(row.properties) && row.properties.length) &&
          row.name.toLowerCase() === name.toLowerCase() &&
          (row.description || '') === description && rules.sameSaleStatus(row, added));
        if (existing) {
          existing.quantity = Math.min(MAX_QUANTITY, (Number(existing.quantity) || 1) + quantity);
        } else {
          const row = added;
          if (description) row.description = description;
          if (category) row.category = category;
          if (customWeapon) row.weapon = customWeapon;
          if (bonuses.length) row.bonuses = bonuses;
          // New weapons are at hand; new armor waits until it is put on.
          const gear = rules.inventoryGear(row);
          if (gear) row.equipped = gear.type === 'weapon';
          inventory.push(row);
        }
        nextSheet = { ...sheetData, inventory };
        message = `Added ${quantity > 1 ? `${quantity} × ` : ''}${name}.`;
      }
    } else if (action === 'update' || action === 'remove') {
      const index = Number(params.index);
      const row = Number.isSafeInteger(index) ? inventory[index] : null;
      if (!row || row.name !== params.name) throw new Error('The item list changed. Reload the page and try again.');
      if (action === 'remove') {
        inventory.splice(index, 1);
        message = `Removed ${row.name}.`;
      } else {
        const quantity = cleanQuantity(params.quantity);
        // More than the list had: the extra wasn't paid for, so only the DM sells the stack.
        if (!is_admin && quantity > (Number(row.quantity) || 1)) row.unsellable = true;
        row.quantity = quantity;
        message = `${row.name}: ${row.quantity}.`;
      }
      nextSheet = { ...sheetData, inventory };
    } else if (action === 'setWeapon') {
      // Weapon stats for a custom item (null makes it a plain item again).
      const index = Number(params.index);
      const row = Number.isSafeInteger(index) ? inventory[index] : null;
      if (!row || row.name !== params.name) throw new Error('The item list changed. Reload the page and try again.');
      if (row.source !== 'custom') throw new Error('Only custom items get their own weapon stats; give a catalog weapon a nickname instead.');
      if (params.weapon) {
        row.weapon = rules.validateCustomWeapon(params.weapon);
        if (typeof row.equipped !== 'boolean') row.equipped = true;
      } else {
        delete row.weapon;
        delete row.equipped;
      }
      nextSheet = { ...sheetData, inventory };
      message = row.weapon ? `${row.name}: weapon stats saved.` : `${row.name} is no longer a weapon.`;
    } else if (action === 'setBonuses' || action === 'useBonuses') {
      // Custom bonuses (+2 to History, Advantage on Religion) and whether the
      // item is in use (worn, held close) so they apply.
      const index = Number(params.index);
      const row = Number.isSafeInteger(index) ? inventory[index] : null;
      if (!row || row.name !== params.name) throw new Error('The item list changed. Reload the page and try again.');
      if (action === 'setBonuses') {
        const bonuses = rules.validateItemBonuses(params.bonuses);
        if (bonuses.length) row.bonuses = bonuses;
        else {
          delete row.bonuses;
          delete row.bonusesActive;
        }
        message = bonuses.length ? `${row.name}: bonuses saved.` : `${row.name} has no bonuses now.`;
      } else {
        row.bonusesActive = Boolean(params.active);
        message = row.bonusesActive ? `${row.name} is in use: its bonuses apply.` : `${row.name} is put away: its bonuses don't apply.`;
      }
      nextSheet = { ...sheetData, inventory };
    } else if (action === 'setProperties') {
      // What the item does, written out (a Sylvan Talon's Fey speech and Secret Message).
      const index = Number(params.index);
      const row = Number.isSafeInteger(index) ? inventory[index] : null;
      if (!row || row.name !== params.name) throw new Error('The item list changed. Reload the page and try again.');
      const properties = rules.validateItemProperties(params.properties);
      if (properties.length) row.properties = properties;
      else delete row.properties;
      // Uses of a property taken away are forgotten.
      const kept = new Set(inventory.flatMap(other => (other.properties || []).map(property => `itemProp:${property.id}`)));
      const resourcesUsed = Object.fromEntries(Object.entries(sheetData.resourcesUsed || {})
        .filter(([key]) => !key.startsWith('itemProp:') || kept.has(key)));
      nextSheet = { ...sheetData, inventory, resourcesUsed };
      message = properties.length ? `${row.nickname || row.name}: properties saved.` : `${row.nickname || row.name} has no properties now.`;
    } else if (action === 'rename') {
      // A nickname ("Ambassador") for the sheet only; the item stays what it is. Empty clears it.
      const index = Number(params.index);
      const row = Number.isSafeInteger(index) ? inventory[index] : null;
      if (!row || row.name !== params.name) throw new Error('The item list changed. Reload the page and try again.');
      const nickname = cleanText(params.nickname, 60, 'Nickname');
      if (nickname && nickname.toLowerCase() !== row.name.toLowerCase()) row.nickname = nickname;
      else delete row.nickname;
      nextSheet = { ...sheetData, inventory };
      message = row.nickname ? `${row.name} is now called ${row.nickname}.` : `${row.name} has its own name again.`;
    } else if (action === 'allowSale' || action === 'allowSaleAll') {
      // The DM lets the player sell gear the sheet counts as not paid for
      // (added by hand, starting gear after a rebuild, an old sheet).
      if (!is_admin) throw new Error('Only a DM can let a player sell an item.');
      const catalog = new Map(getCatalogForSheets().map(entry => [entry.name.toLowerCase(), entry]));
      if (action === 'allowSale') {
        const index = Number(params.index);
        const row = Number.isSafeInteger(index) ? inventory[index] : null;
        if (!row || row.name !== params.name) throw new Error('The item list changed. Reload the page and try again.');
        if (params.allowed) row.sellable = true;
        else delete row.sellable;
        message = params.allowed ? `${row.name}: the player can sell it to Grimbold.` : `${row.name}: only a DM sells it to Grimbold.`;
      } else {
        const blocked = inventory.filter(row => rules.playerSaleBlock(row, mundaneCatalogRow(row.name, catalog)));
        blocked.forEach(row => { row.sellable = true; });
        message = blocked.length ? `The player can sell ${blocked.length} more item${blocked.length === 1 ? '' : 's'} to Grimbold.` : 'Nothing was blocked.';
      }
      nextSheet = { ...sheetData, inventory };
    } else if (action === 'sell') {
      const index = Number(params.index);
      const row = Number.isSafeInteger(index) ? inventory[index] : null;
      if (!row || row.name !== params.name) throw new Error('The item list changed. Reload the page and try again.');
      if (character.status !== 'alive') throw new Error(`${character.name} can't sell anything now.`);
      const have = Number.isSafeInteger(row.quantity) && row.quantity > 0 ? row.quantity : 1;
      const quantity = params.quantity === undefined || params.quantity === '' ? 1 : Number(params.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > have) throw new Error(`Sell from 1 to ${have}.`);
      const catalog = new Map(getCatalogForSheets().map(entry => [entry.name.toLowerCase(), entry]));
      const context = saleContext(character);
      const offer = rules.gearOffer(row, { catalogRow: mundaneCatalogRow(row.name, catalog), discountPercent: context.discountPercent, isAdmin: is_admin });
      if (!offer.unitCp) throw new Error(offer.reason);
      if (quantity === have) inventory.splice(index, 1);
      else row.quantity = have - quantity;
      nextSheet = { ...sheetData, inventory };
      // Remembered, so rebuilding the character doesn't hand out a new set to sell.
      if (row.source === 'class' || row.source === 'background') nextSheet.soldStartingGear = true;
      const totalCp = offer.unitCp * quantity;
      const purseCp = character.gold_cp + totalCp;
      db.prepare('UPDATE characters SET gold_cp = ? WHERE id = ?').run(purseCp, character.id);
      const label = `${quantity > 1 ? `${quantity} × ` : ''}${row.nickname ? `${row.nickname} (${row.name})` : row.name}`;
      recordGoldChange({ characterId: character.id, user: { id: player_id, role: is_admin ? 'admin' : 'player' }, oldCp: character.gold_cp, newCp: purseCp, reason: `Sold ${label} to Grimbold` });
      sold = { characterId: character.id, characterName: character.name, item: label, quantity, unitCp: offer.unitCp, totalCp, share: offer.share, fullValue: Boolean(offer.fullValue), roll: offer.fullValue ? null : context.roll, purseCp };
      message = `Sold ${label} to Grimbold for ${formatCp(totalCp)}.`;
    } else if (action === 'wear') {
      const index = Number(params.index);
      const row = Number.isSafeInteger(index) ? inventory[index] : null;
      if (!row || row.name !== params.name) throw new Error('The item list changed. Reload the page and try again.');
      const gear = rules.inventoryGear(row);
      if (!gear) throw new Error(`${row.name} is not armor, a shield or a weapon.`);
      const worn = Boolean(params.worn);
      nextSheet = rules.setWorn({ ...sheetData, inventory }, { from: 'inventory', index }, worn);
      message = gear.type === 'weapon'
        ? `${row.name} ${worn ? 'is at hand' : 'is stowed'}.`
        : `${row.name} ${worn ? 'is on' : 'is off'}.`;
    } else {
      throw new Error('Unknown item action.');
    }

    // Armor and shields change the Armor Class shown elsewhere.
    nextSheet = combatWithArmorClass(character, nextSheet);
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return { message, inventory: buildView(nextSheet, is_admin, saleContext(character)), ...(sold ? { sold } : {}) };
  })();
}

module.exports = { getCatalogForSheets, getCharacterInventory, changeCharacterInventory };
