// db/inventory.js — A character's equipment list (sheetData.inventory): items
// from the shop catalog or custom items with their own description. Magic
// items go to the Magic Items list instead (see db/magicItems.js).

'use strict';

const { db } = require('./connection');
const rules = require('../rules');

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
    SELECT id, name, category, description FROM catalog WHERE tier != 'service' ORDER BY name COLLATE NOCASE
  `).all();
}

function buildView(sheetData, isAdmin) {
  const catalog = new Map(getCatalogForSheets().map(row => [row.name.toLowerCase(), row]));
  return {
    items: readInventory(sheetData).map((row, index) => {
      const known = catalog.get(row.name.toLowerCase());
      return {
        index,
        name: row.name,
        quantity: Number.isSafeInteger(row.quantity) && row.quantity > 0 ? row.quantity : 1,
        source: row.source || '',
        category: row.category || (known ? known.category : ''),
        // A custom description wins; otherwise the catalog's.
        description: row.description || (known ? known.description : '')
      };
    }),
    canAddMagicItems: Boolean(isAdmin)
  };
}

function getCharacterInventory({ id, player_id, is_admin }) {
  const character = loadCharacter(id, player_id, is_admin);
  return buildView(readSheet(character.sheet_data), is_admin);
}

// action: add { catalogId | name, quantity, description }
//       | update { index, name, quantity } | remove { index, name }
// `name` with update/remove guards against a list changed in another tab.
function changeCharacterInventory({ id, player_id, is_admin, action, params = {} }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    const inventory = readInventory(sheetData).map(row => ({ ...row }));
    let nextSheet;
    let message;

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

      const magic = rules.matchMagicItem(name);
      if (magic && (magic.variant || !magic.item.variants.length) && source === 'catalog') {
        if (!is_admin) throw new Error(`${name} is a magic item: buy it in the shop or ask your DM for it.`);
        const magicItems = rules.grantMagicItem(sheetData, { name, quantity, source: 'dm' });
        nextSheet = { ...sheetData, magicItems };
        message = `${name} added to Magic Items.`;
      } else {
        const existing = inventory.find(row => row.name.toLowerCase() === name.toLowerCase() &&
          (row.description || '') === description);
        if (existing) {
          existing.quantity = Math.min(MAX_QUANTITY, (Number(existing.quantity) || 1) + quantity);
        } else {
          const row = { name, quantity, source };
          if (description) row.description = description;
          if (category) row.category = category;
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
        row.quantity = cleanQuantity(params.quantity);
        message = `${row.name}: ${row.quantity}.`;
      }
      nextSheet = { ...sheetData, inventory };
    } else {
      throw new Error('Unknown item action.');
    }

    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return { message, inventory: buildView(nextSheet, is_admin) };
  })();
}

module.exports = { getCatalogForSheets, getCharacterInventory, changeCharacterInventory };
