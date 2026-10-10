// rules/magicItems.js — The magic item catalog from rules/content/magic_items.md
// (rarity and its variants, attunement, charges and price), the magic items a
// character owns (sheetData.magicItems), and the effects of the items with
// simple always-on numbers: ability scores, AC, saving throws and spell bonuses.

const { loadContent } = require('./content');
const { ALL_CLASSES } = require('./classes');
const { ARMOR } = require('./armor');

const CLASS_NAMES = Object.keys(ALL_CLASSES);
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'];
// Magic Item Price by rarity (Dungeon Master's Guide 2024), in GP. Potions,
// scrolls and ammunition are consumables and cost half.
const PRICE_GP = { Common: 100, Uncommon: 400, Rare: 4000, 'Very Rare': 40000, Legendary: 200000 };
const ATTUNEMENT_LIMIT = 3;

// Items whose rarity is "Rarity Varies" (or split oddly in the source):
// [variant label, rarity, effects]. Labels follow the item's own table.
const VARIANT_TABLES = {
  'Belt of Giant Strength': [
    ['Hill', 'Rare', { setScores: { str: 21 } }], ['Frost', 'Very Rare', { setScores: { str: 23 } }],
    ['Stone', 'Very Rare', { setScores: { str: 23 } }], ['Fire', 'Very Rare', { setScores: { str: 25 } }],
    ['Cloud', 'Legendary', { setScores: { str: 27 } }], ['Storm', 'Legendary', { setScores: { str: 29 } }]
  ],
  'Potion of Giant Strength': [
    ['Hill', 'Uncommon'], ['Frost', 'Rare'], ['Stone', 'Rare'], ['Fire', 'Rare'], ['Cloud', 'Very Rare'], ['Storm', 'Legendary']
  ],
  'Potions of Healing': [['Healing', 'Common'], ['Greater', 'Uncommon'], ['Superior', 'Rare'], ['Supreme', 'Very Rare']],
  'Figurine of Wondrous Power': [
    ['Bronze Griffon', 'Rare'], ['Ebony Fly', 'Rare'], ['Golden Lions', 'Rare'], ['Ivory Goats', 'Rare'],
    ['Marble Elephant', 'Rare'], ['Obsidian Steed', 'Very Rare'], ['Onyx Dog', 'Rare'], ['Serpentine Owl', 'Rare'],
    ['Silver Raven', 'Uncommon']
  ],
  'Ioun Stone': [
    ['Absorption', 'Very Rare'], ['Agility', 'Very Rare', { raiseScores: { dex: [2, 20] } }],
    ['Awareness', 'Rare'], ['Fortitude', 'Very Rare', { raiseScores: { con: [2, 20] } }],
    ['Greater Absorption', 'Legendary'], ['Insight', 'Very Rare', { raiseScores: { wis: [2, 20] } }],
    ['Intellect', 'Very Rare', { raiseScores: { int: [2, 20] } }], ['Leadership', 'Very Rare', { raiseScores: { cha: [2, 20] } }],
    ['Mastery', 'Legendary'], ['Protection', 'Rare', { ac: 1 }], ['Regeneration', 'Legendary'], ['Reserve', 'Rare'],
    ['Strength', 'Very Rare', { raiseScores: { str: [2, 20] } }], ['Sustenance', 'Rare']
  ],
  "Quaal's Feather Token": [
    ['Anchor', 'Uncommon'], ['Bird', 'Rare'], ['Fan', 'Uncommon'], ['Swan Boat', 'Rare'], ['Tree', 'Uncommon'], ['Whip', 'Rare']
  ],
  'Instrument of the Bards': [
    ['Anstruth Harp', 'Very Rare'], ['Canaith Mandolin', 'Rare'], ['Cli Lyre', 'Rare'], ['Doss Lute', 'Uncommon'],
    ['Fochlucan Bandore', 'Uncommon'], ['Mac-Fuirmidh Cittern', 'Uncommon'], ['Ollamh Harp', 'Legendary']
  ],
  'Horn of Valhalla': [['Silver', 'Rare'], ['Brass', 'Rare'], ['Bronze', 'Very Rare'], ['Iron', 'Legendary']],
  'Spell Scroll': [
    ['Cantrip', 'Common'], ['Level 1', 'Common'], ['Level 2', 'Uncommon'], ['Level 3', 'Uncommon'], ['Level 4', 'Rare'],
    ['Level 5', 'Rare'], ['Level 6', 'Very Rare'], ['Level 7', 'Very Rare'], ['Level 8', 'Very Rare'], ['Level 9', 'Legendary']
  ]
};

// Always-on numbers, applied while the item is worn or held (and attuned, if
// it needs attunement). setScores: "your Strength is 19"; raiseScores:
// [increase, maximum]; ac / saves / checks / spellAttack / spellDc: bonuses.
// Situational effects (e.g. against ranged attacks) are left to the table.
const ITEM_EFFECTS = {
  'Amulet of Health': { setScores: { con: 19 } },
  'Gauntlets of Ogre Power': { setScores: { str: 19 } },
  'Headband of Intellect': { setScores: { int: 19 } },
  'Thunderous Greatclub': { setScores: { str: 20 } },
  'Belt of Dwarvenkind': { raiseScores: { con: [2, 20] } },
  'Axe of the Dwarvish Lords': { raiseScores: { con: [2, 20] } },
  'Cloak of Protection': { ac: 1, saves: 1 },
  'Ring of Protection': { ac: 1, saves: 1 },
  'Bracers of Defense': { ac: 2, condition: 'only while you wear no armor and use no Shield' },
  'Scarab of Protection': { ac: 1 },
  'Robe of Stars': { saves: 1 },
  'Stone of Good Luck (Luckstone)': { saves: 1, checks: 1 },
  'Luck Blade': { saves: 1 },
  'Elven Chain': { ac: 1 },
  'Dwarven Plate': { ac: 2 },
  'Efreeti Chain': { ac: 3 },
  'Demon Armor': { ac: 1 },
  'Dragon Scale Mail': { ac: 1 },
  'Glamoured Studded Leather': { ac: 1 },
  'Shield of the Cavalier': { ac: 2 },
  'Staff of Power': { ac: 2, saves: 2, spellAttack: 2 },
  'Staff of the Magi': { spellAttack: 2 },
  'Staff of the Woodlands': { spellAttack: 2 },
  'Robe of the Archmagi': { spellAttack: 2, spellDc: 2 },
  'Talisman of Pure Good': { spellAttack: 2 },
  'Talisman of Ultimate Evil': { spellAttack: 2 }
};

// Effects of "+1, +2, or +3" items, by bonus.
const PLUS_EFFECTS = {
  Armor: bonus => ({ ac: bonus }),
  Shield: bonus => ({ ac: bonus }),
  'Rod of the Pact Keeper': bonus => ({ spellAttack: bonus, spellDc: bonus, spellClasses: ['Warlock'] }),
  'Wand of the War Mage': bonus => ({ spellAttack: bonus })
};

function stripMarkdown(text) {
  return String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
}

// "Armor (Any Light, Medium, or Heavy), Rare (+1), Very Rare (+2)" plus the
// Rarity field "Or Legendary (+3)" → kind, base item and the rarity pieces.
function parseTypeAndRarity(typeText, rarityText) {
  const pieceStart = /,\s*(?=(?:Common|Uncommon|Rare|Very Rare|Legendary)\s*\()/;
  const [head, ...pieces] = String(typeText || '').split(pieceStart);
  const rarityField = String(rarityText || '').replace(/^Or\s+/i, '').trim();
  const kindMatch = head.match(/^([^(]+?)\s*(?:\((.*)\))?\s*$/);
  const kind = kindMatch ? kindMatch[1].trim() : head.trim();
  const baseItem = kindMatch && kindMatch[2] ? kindMatch[2].trim() : '';
  if (!pieces.length) return { kind, baseItem, rarity: rarityField, splitVariants: [] };
  const splitVariants = [...pieces, rarityField].map(piece => {
    const match = piece.match(/^(Common|Uncommon|Rare|Very Rare|Legendary)\s*\((.+)\)$/);
    return match ? { rarity: match[1], label: match[2] } : null;
  }).filter(Boolean);
  return { kind, baseItem, rarity: 'Varies', splitVariants };
}

// "Requires Attunement by a Cleric, Druid, or Paladin" → who may attune.
function parseAttunement(text) {
  const value = String(text || '').trim();
  if (!/requires attunement/i.test(value)) return { required: false, by: null, classes: [], spellcaster: false, dwarf: false };
  const by = (value.match(/\bby an? (.+)$/i) || [])[1] || null;
  const classes = by ? CLASS_NAMES.filter(name => new RegExp(`\\b${name}\\b`, 'i').test(by)) : [];
  return {
    required: true,
    by,
    classes,
    spellcaster: Boolean(by && /spellcaster/i.test(by)),
    dwarf: Boolean(by && /\bdwarf\b/i.test(by))
  };
}

// "This wand has 7 charges ... regains 1d6 + 1 expended charges daily at dawn."
function parseCharges(description) {
  const text = stripMarkdown(description);
  const max = text.match(/\b(?:has|have|with|starts with)\s+(\d+)\s+charges?\b/i);
  if (!max) return null;
  const regain = text.match(/\bregains?\s+(all|its|\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s+(?:of its\s+)?expended charges?\s+daily at (dawn|dusk)/i);
  const amount = regain ? regain[1].replace(/\s+/g, ' ').toLowerCase() : null;
  return { max: Number(max[1]), regain: amount === 'its' ? 'all' : amount, at: regain ? regain[2].toLowerCase() : null };
}

function isConsumable(kind, baseItem, name) {
  return kind === 'Potion' || kind === 'Scroll' || /ammunition/i.test(baseItem) || /^Spell Scroll$/.test(name);
}

function priceGp(rarity, consumable) {
  const price = PRICE_GP[rarity];
  if (!price) return null;
  return consumable ? price / 2 : price;
}

function variantName(baseName, label) {
  if (/^\+\d$/.test(label)) return `${baseName} ${label}`;
  if (baseName === 'Potions of Healing') return label === 'Healing' ? 'Potion of Healing' : `Potion of Healing (${label})`;
  return `${baseName} (${label})`;
}

function normalizeMagicItem(entry) {
  const fields = entry.fields || {};
  const { kind, baseItem, rarity, splitVariants } = parseTypeAndRarity(fields.type, fields.rarity);
  // "Weapon, +1, +2, or +3" → "Weapon".
  const name = entry.name.replace(/,\s*\+1, \+2, or \+3$/, '');
  const description = String(entry.description || '')
    .split('\n').filter(line => !/^!\[[^\]]*\]\([^)]*\)\s*$/.test(line.trim())).join('\n').trim();
  const consumable = isConsumable(kind, baseItem, name);
  const table = VARIANT_TABLES[name];
  let variants = [];
  if (table) {
    variants = table.map(([label, variantRarity, effects]) => ({ label, rarity: variantRarity, effects: effects || null }));
  } else if (splitVariants.length) {
    variants = splitVariants.map(variant => {
      const bonus = Number((variant.label.match(/^\+(\d)$/) || [])[1]) || 0;
      const plus = bonus && (PLUS_EFFECTS[name] || (name === 'Armor' ? PLUS_EFFECTS.Armor : null));
      return { ...variant, effects: plus ? plus(bonus) : null };
    });
  }
  variants = variants.map(variant => ({
    ...variant,
    name: variantName(name, variant.label),
    priceGp: priceGp(variant.rarity, consumable)
  }));
  // Only some figurines (the Goat of Traveling) have charges of their own.
  const charges = name === 'Figurine of Wondrous Power' ? null : parseCharges(description);
  return {
    name,
    contentName: entry.name,
    kind,
    baseItem,
    rarity: variants.length ? 'Varies' : rarity,
    variants,
    attunement: parseAttunement(fields.attunement),
    consumable,
    charges,
    source: fields.source || '',
    priceGp: variants.length ? null : priceGp(rarity, consumable),
    effects: ITEM_EFFECTS[name] || null,
    description
  };
}

let catalogCache = null;
let catalogSource = null;

// All magic items by name. Empty when magic_items.md has not been provided.
function getMagicItemCatalog() {
  const entries = loadContent('magic_items');
  if (catalogCache && catalogSource === entries) return catalogCache;
  const catalog = {};
  for (const entry of Object.values(entries)) {
    const item = normalizeMagicItem(entry);
    catalog[item.name] = item;
  }
  catalogCache = catalog;
  catalogSource = entries;
  return catalog;
}

const AMMUNITION_WORDS = /^(arrows?|bolts?|bullets?|needles?|sling bullets?|crossbow bolts?)$/i;
// Other names the shop catalog uses for an item (lower case → item name).
const NAME_ALIASES = {
  'helm of comprehend languages': 'Helm of Comprehending Languages'
};
const isArmorName = text => Object.keys(ARMOR).some(armor => armor.toLowerCase() === text.toLowerCase()) ||
  /\b(armor|mail|plate|splint|breastplate|chain shirt|padded|leather|hide)\b/i.test(text);

// Finds the catalog item (and variant) for a name as written in the shop or
// by a DM: "Cloak of Protection", "Weapon +1", "+1 Longsword", "Longsword +2",
// "Potion of Greater Healing", "Belt of Hill Giant Strength", "Mithral Splint",
// "Hide Armor of Resistance (Psychic)", ...
function matchMagicItem(rawName, catalog = getMagicItemCatalog()) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  if (NAME_ALIASES[lower] && catalog[NAME_ALIASES[lower]]) return { item: catalog[NAME_ALIASES[lower]], variant: null };
  for (const item of Object.values(catalog)) {
    if (item.name.toLowerCase() === lower || item.contentName.toLowerCase() === lower) {
      return { item, variant: null };
    }
    const variant = item.variants.find(entry => entry.name.toLowerCase() === lower);
    if (variant) return { item, variant };
  }
  const byLabel = (itemName, label) => {
    const item = catalog[itemName];
    const variant = item && item.variants.find(entry => entry.label.toLowerCase() === String(label).toLowerCase());
    return variant ? { item, variant } : null;
  };
  const healing = lower.match(/^potion of (greater|superior|supreme) healing$/);
  if (healing) return byLabel('Potions of Healing', healing[1]);
  const giant = lower.match(/^(belt|potion) of (hill|frost|stone|fire|cloud|storm) giant strength$/);
  if (giant) return byLabel(giant[1] === 'belt' ? 'Belt of Giant Strength' : 'Potion of Giant Strength', giant[2]);
  // "Mithral Splint", "Adamantine Chain Mail" → Mithral / Adamantine Armor.
  const metal = name.match(/^(mithral|adamantine)\s+(.+)$/i);
  if (metal && isArmorName(metal[2])) {
    const item = catalog[`${metal[1][0].toUpperCase()}${metal[1].slice(1).toLowerCase()} Armor`];
    if (item) return { item, variant: null };
  }
  // "Hide Armor of Resistance (Psychic)" → Armor of Resistance.
  const kindOf = name.match(/^(.+?) of (resistance|vulnerability|invulnerability|gleaming)\b/i);
  if (kindOf && isArmorName(kindOf[1])) {
    const item = catalog[`Armor of ${kindOf[2][0].toUpperCase()}${kindOf[2].slice(1).toLowerCase()}`];
    if (item) return { item, variant: null };
  }
  const plus = name.match(/^\+([123])\s+(.+)$/) || name.match(/^(.+?),?\s+\+([123])$/);
  if (plus) {
    const [bonus, base] = /^\+/.test(name) ? [plus[1], plus[2]] : [plus[2], plus[1]];
    const direct = byLabel(base, `+${bonus}`);
    if (direct) return direct;
    const baseLower = base.toLowerCase();
    if (baseLower === 'shield') return byLabel('Shield', `+${bonus}`);
    if (Object.keys(ARMOR).some(armor => armor.toLowerCase() === baseLower) || /\barmor\b/.test(baseLower)) {
      return byLabel('Armor', `+${bonus}`);
    }
    if (AMMUNITION_WORDS.test(base)) return byLabel('Ammunition', `+${bonus}`);
    return byLabel('Weapon', `+${bonus}`);
  }
  return null;
}

// ─── A character's magic items ──────────────────────────────────────────────

function readMagicItems(sheetData) {
  const list = (sheetData || {}).magicItems;
  return Array.isArray(list) ? list.filter(entry => entry && typeof entry === 'object' && entry.uid && entry.name) : [];
}

function itemOf(entry, catalog = getMagicItemCatalog()) {
  const item = catalog[entry.name] || null;
  const variant = item && entry.variant ? item.variants.find(v => v.label === entry.variant) || null : null;
  return { item, variant };
}

// The rules name: "Weapon +1", "Potion of Healing (Greater)".
function catalogName(entry, catalog) {
  const { item, variant } = itemOf(entry, catalog);
  return variant ? variant.name : (item ? item.name : entry.name);
}

// What the sheet shows: the shop's own name when it had one ("+1 Morningstar").
function displayName(entry, catalog) {
  return entry.label || catalogName(entry, catalog);
}

function effectsOf(entry, catalog) {
  const { item, variant } = itemOf(entry, catalog);
  if (!item) return null;
  return (variant && variant.effects) || item.effects || null;
}

// Whether the item's effects apply: worn/held, and attuned when required.
function isActive(entry, catalog) {
  const { item } = itemOf(entry, catalog);
  if (!item || !entry.equipped) return false;
  return !item.attunement.required || Boolean(entry.attuned);
}

function newUid() {
  return `mi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// request: { name, variant, quantity, source }. Consumables stack.
function grantMagicItem(sheetData, request, catalog = getMagicItemCatalog()) {
  const body = request || {};
  const match = matchMagicItem(body.name, catalog);
  if (!match) throw new Error(`Unknown magic item "${body.name}".`);
  const { item } = match;
  let variant = match.variant;
  if (!variant && body.variant) {
    variant = item.variants.find(entry => entry.label.toLowerCase() === String(body.variant).toLowerCase()) || null;
    if (!variant) throw new Error(`${item.name} has no "${body.variant}" variant.`);
  }
  if (!variant && item.variants.length) {
    throw new Error(`Choose which ${item.name}: ${item.variants.map(entry => entry.label).join(', ')}.`);
  }
  const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 999) throw new Error('Invalid quantity.');
  // Keep a more specific name than the rules one, e.g. "+1 Morningstar".
  const rulesName = variant ? variant.name : item.name;
  const given = String(body.name).trim();
  const label = given.toLowerCase() === rulesName.toLowerCase() || given.toLowerCase() === item.name.toLowerCase() ? null : given;
  if (!item.consumable && quantity > 1) {
    const list = [...readMagicItems(sheetData)];
    for (let i = 0; i < quantity; i += 1) list.push(newEntry(item, variant, 1, body.source, label));
    return list;
  }
  const list = readMagicItems(sheetData).map(entry => ({ ...entry }));
  const stack = item.consumable && list.find(entry => entry.name === item.name &&
    (entry.variant || null) === (variant ? variant.label : null) && (entry.label || null) === label);
  if (stack) stack.quantity = (stack.quantity || 1) + quantity;
  else list.push(newEntry(item, variant, quantity, body.source, label));
  return list;
}

function newEntry(item, variant, quantity, source, label = null) {
  return {
    uid: newUid(),
    name: item.name,
    variant: variant ? variant.label : null,
    label,
    quantity,
    equipped: false,
    attuned: false,
    chargesUsed: 0,
    source: ['shop', 'dm', 'loot', 'creation'].includes(source) ? source : 'dm'
  };
}

function findEntry(list, uid) {
  const entry = list.find(item => item.uid === uid);
  if (!entry) throw new Error('This character does not have that magic item.');
  return entry;
}

// character: { classes, species, sheetData } (+ spellcaster: boolean).
function attunementIneligibility(item, character) {
  const rule = item.attunement;
  if (!rule.required) return `${item.name} does not require attunement.`;
  const classNames = (character.classes || []).map(row => row.className);
  if (rule.classes.length && !rule.classes.some(name => classNames.includes(name))) {
    return `Only a ${rule.classes.join(', ').replace(/, ([^,]*)$/, ' or $1')} can attune to ${item.name}.`;
  }
  if (rule.spellcaster && !character.spellcaster) return `Only a spellcaster can attune to ${item.name}.`;
  if (rule.dwarf) {
    const isDwarf = /dwarf/i.test(String(character.species || ''));
    const hasBelt = readMagicItems(character.sheetData).some(entry => entry.name === 'Belt of Dwarvenkind' && entry.attuned);
    if (!isDwarf && !hasBelt) return `Only a Dwarf or a creature attuned to a Belt of Dwarvenkind can attune to ${item.name}.`;
  }
  return null;
}

// action: equip | unequip | attune | unattune | useCharges | restoreCharges | consume | remove
function changeMagicItem(character, action, params = {}, catalog = getMagicItemCatalog()) {
  const sheetData = character.sheetData || {};
  const list = readMagicItems(sheetData).map(entry => ({ ...entry }));
  const entry = findEntry(list, params.uid);
  const { item } = itemOf(entry, catalog);
  const name = displayName(entry, catalog);
  const events = [];

  if (action === 'equip' || action === 'unequip') {
    entry.equipped = action === 'equip';
  } else if (action === 'attune') {
    if (!item) throw new Error(`${name} is not in the magic item list.`);
    if (entry.attuned) throw new Error(`You are already attuned to ${name}.`);
    const reason = attunementIneligibility(item, character);
    if (reason) throw new Error(reason);
    const attuned = list.filter(other => other.attuned).length;
    if (attuned >= ATTUNEMENT_LIMIT) {
      throw new Error(`You can be attuned to no more than ${ATTUNEMENT_LIMIT} magic items at a time. End an attunement first.`);
    }
    entry.attuned = true;
    entry.equipped = true;
  } else if (action === 'unattune') {
    entry.attuned = false;
  } else if (action === 'useCharges') {
    if (!item || !item.charges) throw new Error(`${name} has no charges.`);
    const count = params.count === undefined ? 1 : Number(params.count);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('Invalid number of charges.');
    if (item.attunement.required && !entry.attuned) throw new Error(`Attune to ${name} before using its charges.`);
    const left = item.charges.max - (entry.chargesUsed || 0);
    if (count > left) throw new Error(`${name} has only ${left} charge${left === 1 ? '' : 's'} left.`);
    entry.chargesUsed = (entry.chargesUsed || 0) + count;
    if (entry.chargesUsed === item.charges.max) events.push('lastCharge');
  } else if (action === 'restoreCharges') {
    if (!item || !item.charges) throw new Error(`${name} has no charges.`);
    const count = params.count === undefined ? item.charges.max : Number(params.count);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('Invalid number of charges.');
    entry.chargesUsed = Math.max(0, (entry.chargesUsed || 0) - count);
  } else if (action === 'consume') {
    entry.quantity = (entry.quantity || 1) - 1;
    events.push('consumed');
  } else if (action === 'remove') {
    entry.quantity = 0;
  } else {
    throw new Error('Unknown magic item action.');
  }
  return { magicItems: list.filter(other => (other.quantity ?? 1) > 0), events, name };
}

function rollDice(expression, rng = Math.random) {
  const match = String(expression).match(/^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/);
  if (!match) return Number(expression) || 0;
  let total = 0;
  for (let i = 0; i < Number(match[1]); i += 1) total += 1 + Math.floor(rng() * Number(match[2]));
  if (match[3]) total += (match[3] === '+' ? 1 : -1) * Number(match[4]);
  return total;
}

// "Regains ... daily at dawn" happens with the Long Rest.
function regainChargesOnLongRest(sheetData, { rng = Math.random, catalog = getMagicItemCatalog() } = {}) {
  const regained = [];
  const magicItems = readMagicItems(sheetData).map(entry => {
    const { item } = itemOf(entry, catalog);
    if (!item || !item.charges || !item.charges.regain || !entry.chargesUsed) return entry;
    const amount = item.charges.regain === 'all' ? entry.chargesUsed : Math.max(0, rollDice(item.charges.regain, rng));
    const restored = Math.min(entry.chargesUsed, amount);
    regained.push({ uid: entry.uid, name: displayName(entry, catalog), restored, roll: item.charges.regain });
    return { ...entry, chargesUsed: entry.chargesUsed - restored };
  });
  return { magicItems, regained };
}

function baseScore(sheetData, ability) {
  const value = ((sheetData || {}).abilities || {})[ability];
  const score = value && typeof value === 'object' ? (value.score ?? value.total) : value;
  return Number.isInteger(score) ? score : 10;
}

// Ability scores, AC and other bonuses from active magic items.
function magicItemEffects(sheetData, catalog = getMagicItemCatalog()) {
  const scores = Object.fromEntries(ABILITIES.map(ability => [ability, baseScore(sheetData, ability)]));
  const changes = {};
  const totals = { ac: 0, saves: 0, checks: 0, spellAttack: 0, spellDc: 0 };
  const classBonuses = {};
  const notes = [];
  const active = readMagicItems(sheetData).filter(entry => isActive(entry, catalog));
  const effectsList = active.map(entry => ({ entry, effects: effectsOf(entry, catalog), name: displayName(entry, catalog) }))
    .filter(row => row.effects);

  for (const { effects, name } of effectsList) {
    for (const [ability, [increase, max]] of Object.entries(effects.raiseScores || {})) {
      const next = Math.max(scores[ability], Math.min(max, scores[ability] + increase));
      if (next !== scores[ability]) changes[ability] = { from: changes[ability] ? changes[ability].from : scores[ability], to: next, items: [...((changes[ability] || {}).items || []), name] };
      scores[ability] = next;
    }
  }
  for (const { effects, name } of effectsList) {
    for (const [ability, value] of Object.entries(effects.setScores || {})) {
      if (value > scores[ability]) {
        changes[ability] = { from: changes[ability] ? changes[ability].from : scores[ability], to: value, items: [name] };
        scores[ability] = value;
      }
    }
    if (effects.spellClasses) {
      for (const className of effects.spellClasses) {
        const bonus = classBonuses[className] || { spellAttack: 0, spellDc: 0 };
        bonus.spellAttack += effects.spellAttack || 0;
        bonus.spellDc += effects.spellDc || 0;
        classBonuses[className] = bonus;
      }
    } else {
      totals.spellAttack += effects.spellAttack || 0;
      totals.spellDc += effects.spellDc || 0;
    }
    totals.ac += effects.ac || 0;
    totals.saves += effects.saves || 0;
    totals.checks += effects.checks || 0;
    if (effects.condition) notes.push(`${name}: ${effects.condition}.`);
  }
  return { scores, changes, ...totals, classBonuses, notes };
}

function effectiveAbilityScore(sheetData, ability) {
  return magicItemEffects(sheetData).scores[ability];
}

module.exports = {
  MAGIC_ITEM_RARITIES: RARITIES,
  MAGIC_ITEM_PRICE_GP: PRICE_GP,
  ATTUNEMENT_LIMIT,
  normalizeMagicItem,
  getMagicItemCatalog,
  matchMagicItem,
  readMagicItems,
  magicItemDisplayName: displayName,
  magicItemCatalogName: catalogName,
  grantMagicItem,
  attunementIneligibility,
  changeMagicItem,
  regainChargesOnLongRest,
  magicItemEffects,
  effectiveAbilityScore,
  rollDice
};
