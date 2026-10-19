// rules/monsters.js — The monster catalog: every statblock in
// rules/content/monsters.md (Monster Manual 2024, gitignored like beasts.md),
// for DMs to browse by creature type and CR and to base Notable NPCs on.
//
// The file uses the beasts.md format (see rules/content/README.md), plus
// ### Legendary actions, a lore ### Description and a Habitat / Treasure /
// Source footer. The export has a few spellings to cope with: "XP 1 100",
// "(25 XP; PB +2)", "0 (PB +2)", "XP 10 000, or 11 500 in Lair", and summons
// with "None" for CR and formulas for AC and HP.

const { loadContent } = require('./content');
const { SKILLS } = require('./util');
const { parseFeature, parseCr, formatCr } = require('./wildShape');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const CREATURE_TYPES = ['Aberration', 'Beast', 'Celestial', 'Construct', 'Dragon', 'Elemental', 'Fey', 'Fiend', 'Giant', 'Humanoid', 'Monstrosity', 'Ooze', 'Plant', 'Undead'];
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const SECTION_KEYS = { Traits: 'traits', Actions: 'actions', 'Bonus actions': 'bonusActions', 'Bonus Actions': 'bonusActions', Reactions: 'reactions', 'Legendary actions': 'legendaryActions', 'Legendary Actions': 'legendaryActions' };

// 2024 XP by Challenge Rating (used when the statblock gives none).
const XP_BY_CR = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
  21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000
};

// Dashes and the narrow/no-break spaces in numbers ("5 900") → plain ones.
const dashes = text => String(text || '').replace(/[–—−]/g, '-').replace(/[    ]/g, ' ');
// Markdown links, HTML tags and emphasis → plain text (line breaks kept).
const cleanText = text => String(text || '').replace(/[    ]/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/\*/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .trim();
const number = text => {
  const match = dashes(text).replace(/(\d)[ ,](?=\d{3}\b)/g, '$1').match(/[+-]?\d+/);
  return match ? Number(match[0]) : null;
};
// "1 100" / "10,000" → 1100 / 10000.
const xpNumber = text => Number(String(text).replace(/[\s,]/g, ''));

// "13 (XP 10 000, or 11 500 in Lair; PB +5)" → { cr, xp, lairXp, pb }.
function parseChallenge(text) {
  const value = dashes(text);
  const cr = /^\s*none/i.test(value) ? null : parseCr(value);
  const xp = value.match(/XP\s*(\d[\d ,]*\d|\d)/i) || value.match(/(\d[\d ,]*\d|\d)\s*XP/i);
  const lair = value.match(/or\s+(\d[\d ,]*\d|\d)\s+in lair/i);
  const pb = value.match(/PB\s*\+\s*(\d+)/i);
  return {
    cr,
    xp: xp ? xpNumber(xp[1]) : (cr === null ? 0 : XP_BY_CR[cr] ?? 0),
    lairXp: lair ? xpNumber(lair[1]) : null,
    pb: pb ? Number(pb[1]) : null
  };
}

// "Large Aberration, Lawful Evil" → size, creature type, the type as written, alignment.
function parseTypeLine(line) {
  const [kind, ...rest] = String(line || '').split(',');
  // "Medium swarm of Tiny Beasts": Medium, a swarm of Beasts.
  const head = kind.split(/\bswarm of\b/i)[0];
  const typeText = kind.replace(new RegExp(`^\\s*(?:(?:${SIZES.join('|')}|Smaller)(?:\\s+or\\s+|\\s+))+`), '').trim();
  // "Monstrosities", "Fiends (Demon)": the type word, not the tag in brackets.
  const words = typeText.replace(/\([^)]*\)/g, '');
  return {
    size: SIZES.filter(size => new RegExp(`\\b${size}\\b`).test(head)).join(' or ') + (/\bor smaller\b/i.test(head) ? ' or smaller' : ''),
    type: CREATURE_TYPES.find(name => new RegExp(`\\b${name.slice(0, 7)}`, 'i').test(words)) || 'Other',
    swarm: /\bswarm of\b/i.test(kind),
    typeText,
    alignment: rest.join(',').trim()
  };
}

// A ### section → its opening text (Legendary Action Uses: ...) and entries.
// Entries are "**<em>Name</em>**. text"; "  1: Paralyzing Ray" style names are
// sub-entries of the entry before them (Eye Rays).
function parseSection(body) {
  let intro = '';
  const items = [];
  for (const line of String(body || '').split('\n')) {
    if (/^\*\*(Habitat|Treasure|Source)\*\*:/.test(line)) continue;
    const start = line.match(/^\*\*(.+?)\*\*\.\s*(.*)$/);
    if (start) items.push({ name: start[1].replace(/<[^>]+>/g, ''), raw: start[2] });
    else if (items.length) items[items.length - 1].raw += `\n${line}`;
    else intro += `${line}\n`;
  }
  return {
    intro: cleanText(intro),
    entries: items.map(item => {
      const parsed = parseFeature(item.name.trim(), item.raw);
      const save = dashes(item.raw).match(/\*?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw\*?:\s*DC (\d+)/);
      return {
        name: cleanText(item.name),
        text: cleanText(item.raw),
        sub: /^\s*\d+:/.test(item.name),
        ...(parsed.attack ? { attack: parsed.attack } : {}),
        ...(save ? { save: { ability: save[1], dc: Number(save[2]) } } : {})
      };
    })
  };
}

const FOOTER = /^\*\*(Habitat|Treasure|Source)\*\*:\s*(.*)$/;

// One monsters.md entry → a statblock, or null if it isn't one.
function parseMonster(entry) {
  const description = dashes(entry.description);
  const all = [entry.description, ...Object.values(entry.sections || {})].join('\n');
  const field = name => {
    const match = description.match(new RegExp(`^-\\s+\\*\\*${name}\\*\\*:\\s*(.+)$`, 'mi'));
    return match ? match[1].trim() : '';
  };
  const typeLine = (description.match(/^\*([^*\n]+)\*\s*$/m) || [])[1] || '';
  const abilities = {};
  const saves = {};
  for (const ability of ABILITIES) {
    const row = description.match(new RegExp(`^\\|\\s*\\*\\*${ability}\\*\\*\\s*\\|\\s*(\\d+)\\s*\\|[^|]*\\|\\s*([+-]?\\s*\\d+)\\s*\\|`, 'mi'));
    if (!row) continue;
    abilities[ability] = Number(row[1]);
    saves[ability] = Number(row[2].replace(/\s+/g, ''));
  }
  const challengeText = field('Challenge');
  if (!challengeText || !typeLine) return null;
  const skills = {};
  for (const part of field('Skills').split(',')) {
    const match = part.trim().match(/^(.+?)\s+([+-]\d+)$/);
    if (match && SKILLS[match[1]]) skills[match[1]] = Number(match[2]);
  }
  const hitPointsText = field('Hit Points');
  const hpDice = hitPointsText.match(/^\s*\d+\s*\(([^)]+d[^)]+)\)/);
  const footer = {};
  for (const line of all.split('\n')) {
    const match = line.match(FOOTER);
    if (match) footer[match[1].toLowerCase()] = cleanText(match[2]);
  }
  // Lore: the description without the type line, fields, table and footer.
  const lore = cleanText(entry.description.split('\n')
    .filter(line => !/^\s*(\*[^*]+\*\s*$|-\s+\*\*|\||\*\*(Habitat|Treasure|Source)\*\*:)/.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n'));
  const challenge = parseChallenge(challengeText);
  const initiative = field('Initiative');
  const monster = {
    name: entry.name,
    typeLine: typeLine.trim(),
    ...parseTypeLine(typeLine),
    summon: challenge.cr === null,
    armorClassText: cleanText(field('Armor Class')),
    armorClass: /^\s*\d+\s*(\(|$)/.test(field('Armor Class')) ? number(field('Armor Class')) : null,
    hitPointsText: cleanText(hitPointsText),
    hitPoints: /^\s*\d+\s*(\(|$)/.test(hitPointsText) ? number(hitPointsText) : null,
    hitDice: hpDice ? dashes(hpDice[1]).replace(/\s+/g, '') : null,
    speed: cleanText(field('Speed')),
    initiative: initiative ? number(initiative) : null,
    abilities,
    saves,
    skillsText: cleanText(field('Skills')),
    skills,
    vulnerabilities: cleanText(field('Vulnerabilities')),
    resistances: cleanText(field('Resistances')),
    immunities: cleanText(field('Immunities')),
    gear: cleanText(field('Gear')),
    senses: cleanText(field('Senses')),
    languages: cleanText(field('Languages')),
    challengeText: cleanText(challengeText),
    ...challenge,
    crText: challenge.cr === null ? '—' : formatCr(challenge.cr),
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    legendaryIntro: '',
    lore,
    habitat: footer.habitat || '',
    treasure: footer.treasure || '',
    source: footer.source || ''
  };
  for (const [section, body] of Object.entries(entry.sections || {})) {
    const key = SECTION_KEYS[section];
    if (!key) continue;
    const parsed = parseSection(body);
    monster[key] = parsed.entries;
    if (key === 'legendaryActions') monster.legendaryIntro = parsed.intro;
  }
  return monster;
}

let cache = null;
let cacheSource = null;

// { name: monster } for every statblock in monsters.md ({} without the file).
function loadMonsters() {
  const entries = loadContent('monsters');
  if (cache && cacheSource === entries) return cache;
  cache = {};
  for (const entry of Object.values(entries)) {
    const monster = parseMonster(entry);
    if (monster) cache[monster.name] = monster;
  }
  cacheSource = entries;
  return cache;
}

function getMonster(name) {
  const monsters = loadMonsters();
  return Object.hasOwn(monsters, String(name)) ? monsters[name] : null;
}

// The catalog's rows: what the browse table shows, sorted by name.
function listMonsters() {
  return Object.values(loadMonsters())
    .map(monster => ({
      name: monster.name,
      size: monster.size,
      type: monster.type,
      typeText: monster.typeText,
      swarm: monster.swarm,
      summon: monster.summon,
      cr: monster.cr,
      crText: monster.crText,
      xp: monster.xp,
      armorClass: monster.armorClass,
      hitPoints: monster.hitPoints,
      habitat: monster.habitat
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { CREATURE_TYPES, XP_BY_CR, parseMonster, parseChallenge, loadMonsters, getMonster, listMonsters };
