// rules/itemProperties.js — Custom properties on inventory items: what an
// item does that the rules engine doesn't know, written out by hand. A Sylvan
// Talon set in a Rapier: "While this weapon is on your person, you understand
// the nonwritten communication of all Fey" (always on), and "Secret Message:
// cast Message, once per dawn" (a use that comes back).
//
// Stored on the inventory row: properties: [{ id, name, text, uses }]
//   id:   a short random key, so its uses are tracked whatever the item's place
//   uses: null (always on) | { max: 1…20, recovery: 'dawn' | 'long' | 'short' }
// A property with uses is a resource on the Resources card too (key
// 'itemProp:<id>', counted in the vitals' resourcesUsed): a Long Rest counts as
// the dawn, as for magic item charges.

'use strict';

const crypto = require('crypto');

const RECOVERY = { dawn: 'at dawn', long: 'on a Long Rest', short: 'on a Short or Long Rest' };
const MAX_PROPERTIES = 8;
const MAX_NAME = 60;
const MAX_TEXT = 1000;

const clean = (value, max) => String(value ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max);

// [{ name, text, uses }] from the sheet → the stored list, or throws.
function validateItemProperties(list) {
  if (!Array.isArray(list)) throw new Error('Properties must be a list.');
  if (list.length > MAX_PROPERTIES) throw new Error(`An item can have ${MAX_PROPERTIES} properties at most.`);
  return list.map(entry => {
    const name = clean(entry && entry.name, MAX_NAME);
    const text = clean(entry && entry.text, MAX_TEXT);
    if (!name && !text) throw new Error('A property needs a name or a description.');
    let uses = null;
    if (entry && entry.uses && Number(entry.uses.max) > 0) {
      const max = Number(entry.uses.max);
      if (!Number.isInteger(max) || max > 20) throw new Error('Uses must be a whole number from 1 to 20.');
      const recovery = Object.hasOwn(RECOVERY, entry.uses.recovery) ? entry.uses.recovery : 'dawn';
      uses = { max, recovery };
    }
    const id = /^[a-f0-9]{8,16}$/.test(String(entry && entry.id || '')) ? entry.id : crypto.randomBytes(5).toString('hex');
    return { id, name: name || 'Property', text, uses };
  });
}

// "1 use, back at dawn", "3 uses, back on a Short or Long Rest".
function describeUses(uses) {
  if (!uses) return '';
  return `${uses.max} use${uses.max === 1 ? '' : 's'}, back ${RECOVERY[uses.recovery] || RECOVERY.dawn}`;
}

const itemLabel = row => row.nickname || row.name;

// The properties with uses, as resources for the Resources card.
function itemPropertyResources(sheetData) {
  const rows = Array.isArray((sheetData || {}).inventory) ? sheetData.inventory : [];
  const resources = [];
  for (const row of rows) {
    if (!row || !Array.isArray(row.properties)) continue;
    for (const property of row.properties) {
      if (!property || !property.id || !property.uses || !(property.uses.max > 0)) continue;
      resources.push({
        key: `itemProp:${property.id}`,
        name: `${property.name} (${itemLabel(row)})`,
        max: property.uses.max,
        // Dawn and a Long Rest both come with the Long Rest; Short: either rest.
        recovery: property.uses.recovery === 'short' ? 'short' : 'long',
        text: [property.text, describeUses(property.uses)].filter(Boolean).join(' '),
        item: true
      });
    }
  }
  return resources;
}

module.exports = { ITEM_PROPERTY_RECOVERY: RECOVERY, validateItemProperties, describeItemPropertyUses: describeUses, itemPropertyResources };
