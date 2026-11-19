// rules/spells.js — The spell catalog: rules/content/spells.md normalized into
// level, school, components, ritual and concentration flags, and class lists.

const { loadContent } = require('./content');
const { ALL_CLASSES } = require('./classes');

const CLASS_NAMES = Object.keys(ALL_CLASSES);
// Subclasses that cast from another class's list.
const SUBCLASS_SPELL_LISTS = { 'Eldritch Knight': 'Wizard', 'Arcane Trickster': 'Wizard', 'Warrior of the Mystic Arts': 'Sorcerer' };

// Class lists that spells.md doesn't carry. The Artificer list of Eberron: Forge
// of the Artificer isn't in the book export, so this is the Tasha's Cauldron list
// (spells missing from spells.md are skipped): check it against the book.
const EXTRA_CLASS_SPELLS = {
  Artificer: [
    'Acid Splash', 'Booming Blade', 'Create Bonfire', 'Dancing Lights', 'Fire Bolt', 'Frostbite', 'Green-Flame Blade', 'Guidance', 'Light',
    'Lightning Lure', 'Mage Hand', 'Magic Stone', 'Mending', 'Message', 'Poison Spray', 'Prestidigitation', 'Ray of Frost', 'Resistance',
    'Shocking Grasp', 'Spare the Dying', 'Sword Burst', 'Thorn Whip', 'Thunderclap',
    'Absorb Elements', 'Alarm', 'Catapult', 'Cure Wounds', 'Detect Magic', 'Disguise Self', 'Expeditious Retreat', 'Faerie Fire', 'False Life',
    'Feather Fall', 'Grease', 'Identify', 'Jump', 'Longstrider', 'Purify Food and Drink', 'Sanctuary', 'Snare', "Tasha's Caustic Brew",
    'Aid', 'Alter Self', 'Arcane Lock', 'Blur', 'Continual Flame', 'Darkvision', 'Enhance Ability', 'Enlarge/Reduce', 'Heat Metal',
    'Homunculus Servant', 'Invisibility', 'Lesser Restoration', 'Levitate', 'Magic Mouth', 'Magic Weapon', 'Protection from Poison',
    'Pyrotechnics', 'Rope Trick', 'See Invisibility', 'Skywrite', 'Spider Climb', 'Web',
    'Blink', 'Catnap', 'Create Food and Water', 'Dispel Magic', 'Elemental Weapon', 'Flame Arrows', 'Fly', 'Glyph of Warding', 'Haste',
    'Intellect Fortress', 'Protection from Energy', 'Revivify', 'Tiny Servant', 'Water Breathing', 'Water Walk',
    'Arcane Eye', 'Elemental Bane', 'Fabricate', 'Freedom of Movement', "Leomund's Secret Chest", "Mordenkainen's Faithful Hound",
    "Mordenkainen's Private Sanctum", "Otiluke's Resilient Sphere", 'Stone Shape', 'Stoneskin', 'Summon Construct',
    'Animate Objects', "Bigby's Hand", 'Creation', 'Greater Restoration', 'Skill Empowerment', 'Transmute Rock', 'Wall of Stone'
  ]
};

function parseLevel(text) {
  if (/cantrip/i.test(text)) return 0;
  const match = String(text).match(/(\d)/);
  return match ? Number(match[1]) : null;
}

// "Bard, Druid, Warlo, Psion," → known classes (exact or unambiguous prefix),
// plus anything unrecognized (e.g. playtest classes) kept separately.
function parseClasses(text) {
  const classes = [];
  const other = [];
  for (const raw of String(text || '').split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const exact = CLASS_NAMES.find(name => name.toLowerCase() === token.toLowerCase());
    const byPrefix = token.length >= 4
      ? CLASS_NAMES.filter(name => name.toLowerCase().startsWith(token.toLowerCase()))
      : [];
    const match = exact || (byPrefix.length === 1 ? byPrefix[0] : null);
    if (match) {
      if (!classes.includes(match)) classes.push(match);
    } else if (!other.includes(token)) {
      other.push(token);
    }
  }
  return { classes, other };
}

function parseComponents(text) {
  const value = String(text || '');
  const material = value.match(/\bM\s*\((.*)\)\s*$/);
  const cost = material && material[1].match(/worth ([\d,]+)\+?\s*GP/i);
  return {
    text: value,
    verbal: /\bV\b/.test(value),
    somatic: /\bS\b/.test(value),
    material: /\bM\b/.test(value),
    materialText: material ? material[1] : '',
    materialCostGp: cost ? Number(cost[1].replace(/,/g, '')) : 0,
    materialConsumed: Boolean(material && /consume/i.test(material[1]))
  };
}

// Pulls a "**Label**. text" paragraph out of the description.
function extractParagraph(description, label) {
  const pattern = new RegExp(`(?:^|\\n)\\*\\*${label}\\*\\*\\.\\s*([^\\n]+)`);
  const match = description.match(pattern);
  if (!match) return { description, text: '' };
  return { description: description.replace(match[0], '').trim(), text: match[1].trim() };
}

function normalizeSpell(entry) {
  const fields = entry.fields || {};
  const { classes, other } = parseClasses(fields.classes);
  for (const [className, names] of Object.entries(EXTRA_CLASS_SPELLS)) {
    if (names.includes(entry.name) && !classes.includes(className)) classes.push(className);
  }
  const higher = extractParagraph(entry.description || '', 'Using a Higher-Level Spell Slot');
  const upgrade = extractParagraph(higher.description, 'Cantrip Upgrade');
  const castingTime = fields.castingTime || '';
  const duration = fields.duration || '';
  return {
    name: entry.name,
    level: parseLevel(fields.level),
    school: fields.school || '',
    castingTime,
    ritual: /\britual\b/i.test(castingTime),
    reaction: /^reaction/i.test(castingTime),
    bonusAction: /^bonus action/i.test(castingTime),
    range: fields.range || '',
    components: parseComponents(fields.components),
    duration,
    concentration: /^concentration/i.test(duration),
    classes,
    otherClasses: other,
    description: upgrade.description,
    higherLevels: higher.text,
    cantripUpgrade: upgrade.text,
    summaryOnly: Boolean(entry.fromFallback || entry.descriptionFromFallback)
  };
}

let catalogCache = null;

// name → spell. Pass { content } to build from parsed entries (tests).
function getSpellCatalog({ content, refresh = false } = {}) {
  if (content) {
    return Object.fromEntries(Object.values(content).map(entry => [entry.name, normalizeSpell(entry)]));
  }
  if (!catalogCache || refresh) catalogCache = getSpellCatalog({ content: loadContent('spells') });
  return catalogCache;
}

function findSpell(name, catalog = getSpellCatalog()) {
  if (catalog[name]) return catalog[name];
  const needle = String(name || '').trim().toLowerCase();
  return Object.values(catalog).find(spell => spell.name.toLowerCase() === needle) || null;
}

// Which class list a caster uses (Eldritch Knights and Arcane Tricksters use Wizard).
function spellListName(className, subclassName) {
  return SUBCLASS_SPELL_LISTS[subclassName] || className;
}

function getClassSpellList(listName, catalog = getSpellCatalog()) {
  return Object.values(catalog)
    .filter(spell => spell.classes.includes(listName))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

// Problems worth showing to the DM (unknown levels, odd class names, missing text).
function catalogReport(catalog = getSpellCatalog()) {
  const spells = Object.values(catalog);
  const unknownClasses = {};
  spells.forEach(spell => spell.otherClasses.forEach(name => {
    unknownClasses[name] = (unknownClasses[name] || 0) + 1;
  }));
  return {
    total: spells.length,
    byLevel: spells.reduce((counts, spell) => ({ ...counts, [spell.level]: (counts[spell.level] || 0) + 1 }), {}),
    byClass: Object.fromEntries(CLASS_NAMES.map(name => [name, spells.filter(spell => spell.classes.includes(name)).length])),
    unknownLevel: spells.filter(spell => spell.level === null).map(spell => spell.name),
    noClasses: spells.filter(spell => spell.classes.length === 0).map(spell => spell.name),
    unknownClasses,
    summaryOnly: spells.filter(spell => spell.summaryOnly).map(spell => spell.name)
  };
}

module.exports = {
  SUBCLASS_SPELL_LISTS,
  getSpellCatalog,
  findSpell,
  spellListName,
  getClassSpellList,
  catalogReport,
  normalizeSpell
};
