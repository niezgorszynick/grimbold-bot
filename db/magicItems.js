// db/magicItems.js — A character's magic items (sheetData.magicItems):
// attunement, equipping, charges and DM grants, plus importing the magic item
// list into the shop catalog.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { getCharacterClasses } = require('./characters');

const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
// Actions only an admin (DM) may take.
const DM_ACTIONS = ['grant', 'remove'];

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

function classRowsOf(character) {
  const rows = getCharacterClasses(character.id);
  return rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
}

// The shape the rules engine expects, with spellcasting known for attunement.
function itemCharacter(character, sheetData) {
  const classes = classRowsOf(character);
  const spellChar = { classes, species: character.race, sheetData };
  let spellcaster = false;
  try {
    spellcaster = rules.getSpellSources(spellChar).some(source => source.kind === 'class');
  } catch {
    spellcaster = false;
  }
  return { ...spellChar, spellcaster };
}

function describeEffects(effects) {
  if (!effects) return [];
  const parts = [];
  for (const [ability, value] of Object.entries(effects.setScores || {})) parts.push(`${ABILITY_NAMES[ability]} becomes ${value}`);
  for (const [ability, [increase, max]] of Object.entries(effects.raiseScores || {})) {
    parts.push(`${ABILITY_NAMES[ability]} +${increase} (max ${max})`);
  }
  const forClasses = effects.spellClasses ? ` (${effects.spellClasses.join(', ')} spells)` : '';
  if (effects.ac) parts.push(`+${effects.ac} AC`);
  if (effects.saves) parts.push(`+${effects.saves} saving throws`);
  if (effects.checks) parts.push(`+${effects.checks} ability checks`);
  if (effects.spellAttack) parts.push(`+${effects.spellAttack} spell attacks${forClasses}`);
  if (effects.spellDc) parts.push(`+${effects.spellDc} spell save DC${forClasses}`);
  if (effects.condition) parts.push(effects.condition);
  return parts;
}

function buildView(character, sheetData, isAdmin) {
  const catalog = rules.getMagicItemCatalog();
  const owner = itemCharacter(character, sheetData);
  const entries = rules.readMagicItems(sheetData);
  const items = entries.map(entry => {
    const item = catalog[entry.name] || null;
    const variant = item && entry.variant ? item.variants.find(v => v.label === entry.variant) || null : null;
    const effects = item ? ((variant && variant.effects) || item.effects) : null;
    const charges = item && item.charges
      ? { ...item.charges, left: Math.max(0, item.charges.max - (entry.chargesUsed || 0)) }
      : null;
    return {
      uid: entry.uid,
      name: rules.magicItemDisplayName(entry, catalog),
      rulesName: rules.magicItemCatalogName(entry, catalog),
      baseName: entry.name,
      variant: entry.variant || null,
      quantity: entry.quantity ?? 1,
      equipped: Boolean(entry.equipped),
      attuned: Boolean(entry.attuned),
      source: entry.source || 'dm',
      known: Boolean(item),
      kind: item ? item.kind : '',
      baseItem: item ? item.baseItem : '',
      rarity: variant ? variant.rarity : (item ? item.rarity : ''),
      consumable: Boolean(item && item.consumable),
      attunement: item ? { required: item.attunement.required, by: item.attunement.by } : { required: false, by: null },
      attuneBlocked: item && item.attunement.required && !entry.attuned ? rules.attunementIneligibility(item, owner) : null,
      charges,
      effects: describeEffects(effects),
      description: item ? item.description : 'This item is not in the magic item list.'
    };
  });
  const totals = rules.magicItemEffects(sheetData, catalog);
  return {
    items,
    attuned: items.filter(item => item.attuned).length,
    attunementLimit: rules.ATTUNEMENT_LIMIT,
    effects: {
      scores: Object.entries(totals.changes).map(([ability, change]) => ({
        ability, name: ABILITY_NAMES[ability], from: change.from, to: change.to, items: change.items
      })),
      ac: totals.ac,
      saves: totals.saves,
      checks: totals.checks,
      spellAttack: totals.spellAttack,
      spellDc: totals.spellDc,
      classBonuses: totals.classBonuses,
      notes: totals.notes
    },
    canGrant: Boolean(isAdmin)
  };
}

function getCharacterMagicItems({ id, player_id, is_admin }) {
  const character = loadCharacter(id, player_id, is_admin);
  return buildView(character, readSheet(character.sheet_data), is_admin);
}

// Items that change Constitution change maximum Hit Points.
function withHpMax(character, sheetData) {
  try {
    const context = rules.deriveVitalsContext({ species: character.race, sheetData, classRows: classRowsOf(character) });
    return { ...sheetData, hpMax: context.hpMax };
  } catch {
    return sheetData;
  }
}

// action: grant { name, variant, quantity, source } (DM) | remove { uid } (DM)
//       | equip | unequip | attune | unattune | consume { uid }
//       | useCharges | restoreCharges { uid, count }
function changeCharacterMagicItems({ id, player_id, is_admin, action, params = {} }) {
  if (DM_ACTIONS.includes(action) && !is_admin) throw new Error('Only a DM can give or take away magic items.');
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    let magicItems;
    let message;
    if (action === 'grant') {
      magicItems = rules.grantMagicItem(sheetData, { ...params, source: params.source || 'dm' });
      const added = magicItems[magicItems.length - 1];
      message = `${character.name} received ${params.quantity > 1 ? `${params.quantity} × ` : ''}${rules.magicItemDisplayName(added)}.`;
    } else {
      const result = rules.changeMagicItem(itemCharacter(character, sheetData), action, params);
      magicItems = result.magicItems;
      message = {
        equip: `${result.name} is now worn or held.`,
        unequip: `${result.name} is put away.`,
        attune: `${character.name} is now attuned to ${result.name}.`,
        unattune: `Attunement to ${result.name} ended.`,
        useCharges: `Used ${params.count || 1} charge${Number(params.count) > 1 ? 's' : ''} of ${result.name}.`,
        restoreCharges: `Restored charges of ${result.name}.`,
        consume: `${result.name} used up.`,
        remove: `${result.name} removed.`
      }[action];
    }
    const nextSheet = withHpMax(character, { ...sheetData, magicItems });
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return { message, magicItems: buildView(character, nextSheet, is_admin) };
  })();
}

// Item side effects of a vitals action: a Long Rest counts as the dawn when
// items regain their charges.
function magicItemEffectsOfVitals(sheetData, action) {
  if (action !== 'longRest') return { magicItems: rules.readMagicItems(sheetData), regained: [] };
  return rules.regainChargesOnLongRest(sheetData);
}

function catalogDescription(text) {
  const plain = String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  const first = plain.split(/\n{2,}/)[0].trim();
  return first.length > 300 ? `${first.slice(0, 297).trimEnd()}...` : first;
}

// Adds magic items of the chosen rarities to the shop catalog at Dungeon
// Master's Guide prices, so the weekly restock can offer them. Items the
// catalog already has — under any name the shop uses, e.g. "+1 Morningstar"
// for Weapon +1 or "Potion of Superior Healing" — are left as they are.
// Artifacts, items without a price and spell scrolls (the catalog has its
// own) are skipped.
function importMagicItemsToCatalog({ rarities } = {}) {
  const wanted = Array.isArray(rarities) && rarities.length ? rarities : ['Common', 'Uncommon', 'Rare'];
  for (const rarity of wanted) {
    if (!rules.MAGIC_ITEM_PRICE_GP[rarity]) throw new Error(`Unknown rarity "${rarity}".`);
  }
  const insert = db.prepare(`
    INSERT OR IGNORE INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock)
    VALUES (?, ?, 'magic', ?, ?, ?, 1, ?)
  `);
  return db.transaction(() => {
    const added = [];
    const existing = [];
    const keyOf = (item, variant) => `${item.name}|${variant ? variant.label : ''}`;
    const inCatalog = new Map();
    for (const row of db.prepare('SELECT name FROM catalog').all()) {
      const match = rules.matchMagicItem(row.name);
      if (match && !inCatalog.has(keyOf(match.item, match.variant))) inCatalog.set(keyOf(match.item, match.variant), row.name);
    }
    for (const item of Object.values(rules.getMagicItemCatalog())) {
      if (item.name === 'Spell Scroll') continue;
      const rows = item.variants.length
        ? item.variants.map(variant => ({ name: variant.name, rarity: variant.rarity, priceGp: variant.priceGp, key: keyOf(item, variant) }))
        : [{ name: item.name, rarity: item.rarity, priceGp: item.priceGp, key: keyOf(item, null) }];
      for (const row of rows) {
        if (!wanted.includes(row.rarity) || !row.priceGp) continue;
        if (inCatalog.has(row.key)) {
          existing.push({ name: row.name, as: inCatalog.get(row.key) });
          continue;
        }
        const result = insert.run(
          row.name, item.kind, Math.round(row.priceGp * 100), catalogDescription(item.description),
          rules.MAGIC_ITEM_MIN_PARTY_LEVEL[row.rarity], item.consumable ? 2 : 1
        );
        if (result.changes) added.push(row.name);
        else existing.push({ name: row.name, as: row.name });
      }
    }
    return { added, skipped: existing.length, existing };
  })();
}

module.exports = {
  getCharacterMagicItems,
  changeCharacterMagicItems,
  magicItemEffectsOfVitals,
  importMagicItemsToCatalog
};
