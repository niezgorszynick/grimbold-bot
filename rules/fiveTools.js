// rules/fiveTools.js — Monsters in 5etools' JSON format (a book's bestiary
// file or a homebrew collection) turned into the statblocks rules/monsters.js
// uses, so imported creatures work in the Monsters tab, encounters and dice.
//
// Covered: size, type, alignment, AC, HP, speed, initiative, scores, saves,
// skills, defenses, senses, languages, CR / XP (with lair XP), gear, traits,
// actions, bonus actions, reactions, legendary (and mythic) actions,
// spellcasting, habitat and treasure; 5etools' inline tags ({@atk mw},
// {@hit 5}, {@damage 2d6 + 3}, {@dc 13}, {@actSave dex}, …) become the text
// the book prints. A "_copy" entry is the creature it copies with its changes
// (_mod: appendArr, prependArr, insertArr, replaceArr, removeArr, replaceTxt);
// one whose original isn't loaded is skipped and reported.

const { SKILLS, abilityModifier } = require('./util');

const SIZES = { F: 'Fine', D: 'Diminutive', T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan', C: 'Colossal', V: 'Varies' };
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const CREATURE_TYPES = ['Aberration', 'Beast', 'Celestial', 'Construct', 'Dragon', 'Elemental', 'Fey', 'Fiend', 'Giant', 'Humanoid', 'Monstrosity', 'Ooze', 'Plant', 'Undead'];
const XP_BY_CR = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
  21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000
};
// Book codes 5etools uses, for the source shown on a statblock.
const SOURCE_NAMES = {
  MM: 'Monster Manual (2014)', XMM: 'Monster Manual (2024)', MPMM: 'Mordenkainen Presents: Monsters of the Multiverse',
  VGM: "Volo's Guide to Monsters", MTF: "Mordenkainen's Tome of Foes", FTD: "Fizban's Treasury of Dragons",
  BGG: "Bigby Presents: Glory of the Giants", BMT: 'The Book of Many Things', TCE: "Tasha's Cauldron of Everything",
  XGE: "Xanathar's Guide to Everything", PHB: "Player's Handbook (2014)", XPHB: "Player's Handbook (2024)",
  DMG: "Dungeon Master's Guide (2014)", XDMG: "Dungeon Master's Guide (2024)", ToA: 'Tomb of Annihilation',
  CoS: 'Curse of Strahd', SKT: "Storm King's Thunder", PotA: 'Princes of the Apocalypse', OotA: 'Out of the Abyss',
  WDH: 'Waterdeep: Dragon Heist', WDMM: 'Waterdeep: Dungeon of the Mad Mage', BGDIA: "Baldur's Gate: Descent into Avernus",
  IDRotF: 'Icewind Dale: Rime of the Frostmaiden', WBtW: 'The Wild Beyond the Witchlight', CRCotN: 'Critical Role: Call of the Netherdeep',
  JttRC: 'Journeys through the Radiant Citadel', SatO: 'Sigil and the Outlands', PaBTSO: 'Phandelver and Below: The Shattered Obelisk',
  VEoR: 'Vecna: Eve of Ruin', QftIS: 'Quests from the Infinite Staircase', LMoP: 'Lost Mine of Phandelver', HotDQ: 'Hoard of the Dragon Queen',
  RoT: 'The Rise of Tiamat', GoS: 'Ghosts of Saltmarsh', EGW: "Explorer's Guide to Wildemount", MOT: 'Mythic Odysseys of Theros',
  VRGR: "Van Richten's Guide to Ravenloft", FTD2: "Fizban's Treasury of Dragons", ERLW: 'Eberron: Rising from the Last War'
};

const capitalize = text => String(text || '').replace(/^\w/, char => char.toUpperCase());
const titleCase = text => String(text || '').replace(/\b\w/g, char => char.toUpperCase());
const signed = n => (n >= 0 ? `+${n}` : `${n}`);

function crValue(text) {
  const value = String(text || '').trim();
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}
const crText = cr => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[cr] || String(cr));
function proficiencyForCr(cr) {
  if (cr === null || cr < 5) return 2;
  return Math.min(9, 2 + Math.ceil((cr - 4) / 4));
}

// ─── 5etools' inline tags ──────────────────────────────────────────────────
const ATTACK_NAMES = {
  mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', 'mw,rw': 'Melee or Ranged Weapon Attack:',
  ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:', 'ms,rs': 'Melee or Ranged Spell Attack:',
  m: 'Melee Attack Roll:', r: 'Ranged Attack Roll:', 'm,r': 'Melee or Ranged Attack Roll:'
};
const ORDINALS = ['', 'First', 'Second', 'Third'];

function renderTag(tag, body) {
  const parts = body.split('|');
  const first = parts[0].trim();
  switch (tag) {
    case 'atk': case 'atkr': return ATTACK_NAMES[first.replace(/\s+/g, '')] || 'Attack:';
    case 'hit': return signed(Number(first) || 0);
    case 'h': return 'Hit: ';
    case 'm': return 'Miss: ';
    case 'hom': return 'Hit or Miss: ';
    case 'dc': return `DC ${first}`;
    case 'actSave': return `${ABILITY_NAMES[first] || capitalize(first)} Saving Throw:`;
    case 'actSaveFail': return first ? `${ORDINALS[Number(first)] || ''} Failure:`.trim() : 'Failure:';
    case 'actSaveSuccess': return 'Success:';
    case 'actSaveSuccessOrFail': return 'Failure or Success:';
    case 'actTrigger': return 'Trigger:';
    case 'actResponse': return 'Response:';
    case 'recharge': return first ? `(Recharge ${first}–6)` : '(Recharge 6)';
    case 'chance': return `${first} percent`;
    case 'damage': case 'dice': case 'd20': case 'autodice': return parts[1] && tag !== 'damage' ? parts[1] : first;
    case 'spell': case 'item': case 'condition': case 'status': case 'creature': case 'skill': case 'sense': case 'action':
    case 'hazard': case 'disease': case 'variantrule': case 'quickref': case 'filter': case 'book': case 'adventure':
    case 'classFeature': case 'class': case 'feat': case 'race': case 'background': case 'deity': case 'object': case 'trap':
    case 'table': case 'language': case 'vehicle': case 'reward': case 'optfeature': case 'psionic': case 'cult': case 'boon':
    case 'card': case 'deck': case 'charoption': case 'recipe': case 'itemProperty': case 'itemMastery': case 'link':
      return (parts[2] || parts[0]).trim();
    default:
      // {@b bold}, {@i italic}, {@note …} and anything new: the text.
      return (parts[2] && !['b', 'bold', 'i', 'italic', 'u', 'note', 'tip'].includes(tag) ? parts[2] : first).trim();
  }
}

function untag(text) {
  let out = String(text === undefined || text === null ? '' : text);
  let before;
  do {
    before = out;
    out = out.replace(/\{@(\w+)\s*([^{}]*)\}/g, (_, tag, body) => renderTag(tag, body));
  } while (out !== before);
  return out.replace(/[ \t]+/g, ' ').replace(/ ([,.;:])/g, '$1').trim();
}

// Entries (strings, lists, named sub-entries, tables) as plain text with line breaks.
function entriesText(entries) {
  const lines = [];
  const walk = entry => {
    if (entry === null || entry === undefined) return;
    if (typeof entry === 'string' || typeof entry === 'number') { lines.push(untag(entry)); return; }
    if (Array.isArray(entry)) { entry.forEach(walk); return; }
    if (entry.type === 'list') {
      (entry.items || []).forEach(item => {
        if (typeof item === 'string') lines.push(`• ${untag(item)}`);
        else if (item.name) lines.push(`${untag(item.name)}. ${entriesText(item.entry !== undefined ? [item.entry] : item.entries || [])}`);
        else walk(item);
      });
      return;
    }
    if (entry.type === 'table') {
      if (entry.caption) lines.push(untag(entry.caption));
      (entry.rows || []).forEach(row => lines.push((Array.isArray(row) ? row : row.row || []).map(cell => (typeof cell === 'object' ? entriesText([cell]) : untag(cell))).join(' — ')));
      return;
    }
    if (entry.name && (entry.entries || entry.entry !== undefined)) {
      lines.push(`${untag(entry.name)}. ${entriesText(entry.entries || [entry.entry])}`);
      return;
    }
    if (entry.entries) { walk(entry.entries); return; }
    if (entry.entry !== undefined) walk(entry.entry);
  };
  walk(entries);
  return lines.filter(Boolean).join('\n');
}

// A trait or action: its text, and what the dice need (attack bonus, save).
function featureOf(raw) {
  const rawText = JSON.stringify(raw.entries || raw.entry || '');
  const text = entriesText(raw.entries || (raw.entry !== undefined ? [raw.entry] : []));
  const feature = { name: untag(raw.name || ''), text, sub: false };
  const attack = rawText.match(/\{@atkr? ([^}]+)\}/);
  const hit = rawText.match(/\{@hit (-?\d+)\}/);
  if (attack && hit) {
    const reach = text.match(/\b(reach \d+ ft\.|range [\d/]+ ft\.)/);
    feature.attack = { kind: /^(r|rw|rs)$/.test(attack[1].trim()) ? 'ranged' : 'melee', bonus: Number(hit[1]), reach: reach ? reach[1] : '', damage: null };
  }
  const dc = rawText.match(/\{@dc (\d+)\}/);
  const saveAbility = rawText.match(/\{@actSave (\w+)\}/) || text.match(/DC \d+ (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i);
  if (dc && saveAbility) {
    const ability = ABILITY_NAMES[saveAbility[1]] || capitalize(saveAbility[1].toLowerCase());
    feature.save = { ability, dc: Number(dc[1]) };
  }
  return feature;
}

// "At will: Mage Hand\n1/day each: Fly" from a spellcasting block.
function spellcastingFeature(block) {
  const lines = [];
  if (block.headerEntries) lines.push(entriesText(block.headerEntries));
  const list = spells => spells.map(spell => untag(typeof spell === 'string' ? spell : spell.entry || '')).join(', ');
  if (block.constant) lines.push(`Constant: ${list(block.constant)}`);
  if (block.will) lines.push(`At will: ${list(block.will)}`);
  for (const key of ['daily', 'rest', 'weekly', 'monthly', 'yearly', 'restLong']) {
    if (!block[key]) continue;
    const period = { daily: 'day', rest: 'rest', weekly: 'week', monthly: 'month', yearly: 'year', restLong: 'long rest' }[key];
    for (const [count, spells] of Object.entries(block[key])) {
      lines.push(`${count.replace('e', '')}/${period}${count.endsWith('e') ? ' each' : ''}: ${list(spells)}`);
    }
  }
  if (block.spells) {
    for (const [level, data] of Object.entries(block.spells)) {
      const label = level === '0' ? 'Cantrips (at will)' : `Level ${level}${data.slots ? ` (${data.slots} slot${data.slots === 1 ? '' : 's'})` : ''}`;
      lines.push(`${label}: ${list(data.spells || [])}`);
    }
  }
  if (block.footerEntries) lines.push(entriesText(block.footerEntries));
  return { name: untag(block.name || 'Spellcasting'), text: lines.filter(Boolean).join('\n'), sub: false };
}

// ─── The parts of a statblock ──────────────────────────────────────────────
function typeOf(raw) {
  const type = raw.type;
  const base = typeof type === 'string' ? type : type && typeof type.type === 'string' ? type.type
    : type && type.type && type.type.choose ? type.type.choose.join(' or ') : 'creature';
  const tags = type && Array.isArray(type.tags)
    ? type.tags.map(tag => (typeof tag === 'string' ? tag : [tag.prefix, tag.tag].filter(Boolean).join(' '))).filter(Boolean)
    : [];
  const swarm = type && type.swarmSize;
  let typeText = titleCase(base);
  if (swarm) typeText = `Swarm of ${SIZES[swarm] || swarm} ${titleCase(base)}s`;
  if (tags.length) typeText += ` (${tags.map(titleCase).join(', ')})`;
  const main = CREATURE_TYPES.find(name => new RegExp(`\\b${name.slice(0, 7)}`, 'i').test(base)) || 'Other';
  return { typeText, type: main, swarm: Boolean(swarm) };
}

const ALIGNMENT_WORDS = { L: 'Lawful', N: 'Neutral', C: 'Chaotic', G: 'Good', E: 'Evil', U: 'Unaligned', A: 'Any alignment', NX: 'Neutral', NY: 'Neutral' };
function alignmentOf(alignment) {
  if (!alignment) return '';
  if (!Array.isArray(alignment)) return alignment.special ? untag(alignment.special) : '';
  if (alignment.some(part => typeof part === 'object')) {
    return alignment.map(part => (typeof part === 'object' ? `${alignmentOf(part.alignment || [])}${part.chance ? ` (${part.chance}%)` : ''}${part.note ? ` ${part.note}` : ''}`.trim() : ALIGNMENT_WORDS[part] || part)).join(' or ');
  }
  const codes = alignment.join('');
  if (alignment.length >= 5) return alignment.includes('G') && !alignment.includes('E') ? 'Any non-evil alignment' : alignment.includes('E') && !alignment.includes('G') ? 'Any non-good alignment' : 'Any alignment';
  if (codes === 'NXNY' || codes === 'N') return 'Neutral';
  if (alignment.length === 4 && codes.includes('L') === false && alignment.includes('C')) return 'Any chaotic alignment';
  if (alignment.length === 4 && alignment.includes('L') && !alignment.includes('C')) return 'Any lawful alignment';
  return alignment.map(code => ALIGNMENT_WORDS[code] || code).join(' ');
}

function armorOf(ac) {
  const list = Array.isArray(ac) ? ac : ac !== undefined ? [ac] : [];
  let value = null;
  const parts = list.map(entry => {
    if (typeof entry === 'number') { if (value === null) value = entry; return String(entry); }
    if (entry && entry.special) return untag(entry.special);
    if (entry && Number.isInteger(entry.ac)) {
      if (value === null) value = entry.ac;
      const from = entry.from ? ` (${entry.from.map(untag).join(', ')})` : '';
      return `${entry.ac}${from}${entry.condition ? ` ${untag(entry.condition)}` : ''}`;
    }
    return '';
  }).filter(Boolean);
  return { armorClass: value, armorClassText: parts.join(', ') || '—' };
}

function speedOf(speed) {
  if (!speed) return '';
  if (typeof speed === 'number') return `${speed} ft.`;
  const one = (label, value) => {
    if (value === undefined || value === null || value === false) return null;
    if (value === true) return label === 'Walk' ? null : `${label} equal to its walking speed`;
    const number = typeof value === 'object' ? value.number : value;
    const condition = typeof value === 'object' && value.condition ? ` ${untag(value.condition)}` : '';
    return `${label === 'Walk' ? '' : `${label} `}${number} ft.${condition}`;
  };
  const parts = [one('Walk', speed.walk), one('Burrow', speed.burrow), one('Climb', speed.climb), one('Fly', speed.fly), one('Swim', speed.swim)].filter(Boolean);
  if (speed.canHover && !parts.some(part => /hover/i.test(part))) {
    const index = parts.findIndex(part => part.startsWith('Fly'));
    if (index >= 0) parts[index] += ' (hover)';
  }
  if (speed.choose) parts.push(`${speed.choose.from.map(titleCase).join(' or ')} ${speed.choose.amount} ft.${speed.choose.note ? ` ${speed.choose.note}` : ''}`);
  return parts.join(', ');
}

// Resistances, immunities, vulnerabilities and condition immunities.
function defenseText(list, key) {
  if (!Array.isArray(list)) return '';
  return list.map(entry => {
    if (typeof entry === 'string') return capitalize(untag(entry));
    if (entry.special) return untag(entry.special);
    const inner = defenseText(entry[key] || entry.conditionImmune || [], key);
    return [entry.preNote, inner, entry.note].filter(Boolean).map(untag).join(' ');
  }).filter(Boolean).join(', ');
}

function challengeOf(raw) {
  const cr = raw.cr;
  const base = typeof cr === 'object' && cr !== null ? cr.cr : cr;
  const value = base === undefined || base === null ? null : crValue(base);
  const lair = typeof cr === 'object' && cr !== null ? (cr.lair ? crValue(cr.lair) : null) : null;
  const xp = typeof cr === 'object' && cr !== null && Number.isInteger(cr.xp) ? cr.xp : (value === null ? 0 : XP_BY_CR[value] ?? 0);
  const lairXp = typeof cr === 'object' && cr !== null && Number.isInteger(cr.xpLair) ? cr.xpLair : (lair !== null ? XP_BY_CR[lair] ?? null : null);
  return { cr: value, xp, lairXp, pb: proficiencyForCr(value) };
}

function sourceName(code, meta) {
  const homebrew = meta && Array.isArray(meta.sources) ? meta.sources.find(source => source.json === code) : null;
  if (homebrew) return homebrew.full || homebrew.abbreviation || code;
  return SOURCE_NAMES[code] || code || 'Unknown source';
}

// ─── One creature ──────────────────────────────────────────────────────────
// raw: a 5etools monster (already _copy-resolved). meta: the file's _meta
// (homebrew source names). Returns a statblock, or throws if it isn't one.
function convertMonster(raw, meta) {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('no name');
  const abilities = {};
  ABILITIES.forEach(ability => { if (Number.isInteger(raw[ability])) abilities[ability] = raw[ability]; });
  if (Object.keys(abilities).length < 6) throw new Error('no ability scores');
  const challenge = challengeOf(raw);
  const pb = challenge.pb;
  const mod = ability => abilityModifier(abilities[ability]);
  const saves = Object.fromEntries(ABILITIES.map(ability => {
    const given = raw.save && raw.save[ability];
    return [ability, given !== undefined ? Number(String(given).replace(/\s+/g, '')) || mod(ability) : mod(ability)];
  }));
  const skills = {};
  for (const [name, bonus] of Object.entries(raw.skill || {})) {
    const skill = Object.keys(SKILLS).find(key => key.toLowerCase() === name.toLowerCase());
    const value = Number(String(bonus).replace(/\s+/g, ''));
    if (skill && Number.isFinite(value)) skills[skill] = value;
  }
  const initiative = typeof raw.initiative === 'number' ? raw.initiative
    : raw.initiative && typeof raw.initiative === 'object' ? mod('dex') + pb * (Number(raw.initiative.proficiency) || 0) + (Number(raw.initiative.initiative) || 0)
      : mod('dex');
  const { typeText, type, swarm } = typeOf(raw);
  const sizes = (Array.isArray(raw.size) ? raw.size : [raw.size]).filter(Boolean).map(code => SIZES[code] || code);
  const size = sizes.join(' or ');
  const alignment = alignmentOf(raw.alignment);
  const hp = raw.hp || {};
  const hitPoints = Number.isInteger(hp.average) ? hp.average : null;
  const hitPointsText = hp.special ? untag(hp.special) : `${hitPoints ?? '—'}${hp.formula ? ` (${untag(hp.formula)})` : ''}`;
  const armor = armorOf(raw.ac);
  const senses = [...(raw.senses || []).map(sense => capitalize(untag(sense))), Number.isInteger(raw.passive) ? `Passive Perception ${raw.passive}` : null].filter(Boolean).join(', ');
  const damageImmune = defenseText(raw.immune, 'immune');
  const conditionImmune = defenseText(raw.conditionImmune, 'conditionImmune');
  const sections = { traits: [], actions: [], bonusActions: [], reactions: [], legendaryActions: [] };
  (raw.trait || []).forEach(entry => sections.traits.push(featureOf(entry)));
  (raw.action || []).forEach(entry => sections.actions.push(featureOf(entry)));
  (raw.bonus || []).forEach(entry => sections.bonusActions.push(featureOf(entry)));
  (raw.reaction || []).forEach(entry => sections.reactions.push(featureOf(entry)));
  (raw.legendary || []).forEach(entry => sections.legendaryActions.push(featureOf(entry)));
  (raw.mythic || []).forEach(entry => sections.legendaryActions.push({ ...featureOf(entry), name: `Mythic: ${untag(entry.name || '')}` }));
  (raw.spellcasting || []).forEach(block => {
    const target = { action: 'actions', bonus: 'bonusActions', reaction: 'reactions', legendary: 'legendaryActions' }[block.displayAs] || 'traits';
    sections[target].push(spellcastingFeature(block));
  });
  const shortName = raw.shortName && typeof raw.shortName === 'string' ? raw.shortName : `the ${raw.name.toLowerCase()}`;
  let legendaryIntro = '';
  if (sections.legendaryActions.length) {
    const uses = Number.isInteger(raw.legendaryActions) ? raw.legendaryActions : 3;
    legendaryIntro = raw.legendaryHeader
      ? entriesText(raw.legendaryHeader)
      : `Legendary Action Uses: ${uses}${Number.isInteger(raw.legendaryActionsLair) ? ` (${raw.legendaryActionsLair} in Lair)` : ''}. Immediately after another creature's turn, ${shortName} can expend a use to take one of the following actions. ${capitalize(shortName)} regains all expended uses at the start of each of its turns.`;
  }
  const source = sourceName(raw.source, meta);
  return {
    name: raw.name.trim(),
    typeLine: `${size} ${typeText}${alignment ? `, ${alignment}` : ''}`.trim(),
    size,
    type,
    swarm,
    typeText,
    alignment,
    summon: challenge.cr === null,
    armorClassText: armor.armorClassText,
    armorClass: armor.armorClass,
    hitPointsText,
    hitPoints,
    hitDice: hp.formula ? untag(hp.formula).replace(/\s+/g, '') : null,
    speed: speedOf(raw.speed),
    initiative,
    abilities,
    saves,
    skillsText: Object.entries(skills).map(([skill, bonus]) => `${skill} ${signed(bonus)}`).join(', '),
    skills,
    vulnerabilities: defenseText(raw.vulnerable, 'vulnerable'),
    resistances: defenseText(raw.resist, 'resist'),
    immunities: [damageImmune, conditionImmune].filter(Boolean).join('; '),
    gear: (raw.gear || []).map(item => (typeof item === 'string' ? untag(item) : `${untag(item.item || '')}${item.quantity > 1 ? ` (${item.quantity})` : ''}`)).join(', '),
    senses,
    languages: (raw.languages || []).map(untag).join(', ') || 'None',
    challengeText: challenge.cr === null ? '—' : `${crText(challenge.cr)} (XP ${challenge.xp}; PB +${pb})`,
    ...challenge,
    crText: challenge.cr === null ? '—' : crText(challenge.cr),
    ...sections,
    legendaryIntro,
    lore: '',
    habitat: (raw.environment || []).map(titleCase).join(', '),
    treasure: (raw.treasure || []).map(titleCase).join(', '),
    source: `${source}${raw.page ? `, p. ${raw.page}` : ''}`,
    sourceCode: raw.source || '',
    sourceName: source
  };
}

// ─── _copy ─────────────────────────────────────────────────────────────────
function replaceText(value, from, to, flags) {
  // "The lurker" → "The elder lurker": a match that starts with a capital keeps it.
  if (typeof value === 'string') {
    return value.replace(new RegExp(from, flags || 'g'), match => (/^[A-Z]/.test(match) ? to.replace(/^[a-z]/, char => char.toUpperCase()) : to));
  }
  if (Array.isArray(value)) return value.map(item => replaceText(item, from, to, flags));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'name' ? item : replaceText(item, from, to, flags)]));
  return value;
}

function applyMod(target, key, mod) {
  const ops = Array.isArray(mod) ? mod : [mod];
  for (const op of ops) {
    if (typeof op === 'string' && op === 'remove') { delete target[key]; continue; }
    if (!op || typeof op !== 'object') continue;
    const list = Array.isArray(target[key]) ? [...target[key]] : [];
    const items = op.items === undefined ? [] : (Array.isArray(op.items) ? op.items : [op.items]);
    const matches = (entry, name) => entry && (entry.name === name || entry === name);
    switch (op.mode) {
      case 'appendArr': target[key] = [...list, ...items]; break;
      case 'prependArr': target[key] = [...items, ...list]; break;
      case 'insertArr': list.splice(Number(op.index) || 0, 0, ...items); target[key] = list; break;
      case 'replaceArr': {
        // replace: an entry's name, or { index }.
        const index = op.replace && typeof op.replace === 'object'
          ? Number(op.replace.index)
          : list.findIndex(entry => matches(entry, op.replace));
        if (index >= 0) list.splice(index, 1, ...items);
        target[key] = list;
        break;
      }
      case 'removeArr': {
        const names = Array.isArray(op.names) ? op.names : op.names !== undefined ? [op.names] : [];
        target[key] = list.filter(entry => !names.some(name => matches(entry, name)) && !(op.items && [].concat(op.items).includes(entry)));
        break;
      }
      case 'replaceTxt': {
        const replace = value => replaceText(value, op.replace, op.with, op.flags);
        if (key === '*') {
          ['trait', 'action', 'bonus', 'reaction', 'legendary', 'mythic', 'spellcasting'].forEach(field => { if (target[field]) target[field] = replace(target[field]); });
        } else if (target[key]) target[key] = replace(target[key]);
        break;
      }
      case 'setProp': target[op.prop] = op.value; break;
      default: break;
    }
  }
}

// raw entries of every loaded file, looked up by "name|source" (lower case).
function resolveCopy(raw, lookup, seen = new Set()) {
  if (!raw._copy) return raw;
  const key = `${String(raw._copy.name || '').toLowerCase()}|${String(raw._copy.source || '').toLowerCase()}`;
  if (seen.has(key)) throw new Error('copies itself');
  const original = lookup.get(key);
  if (!original) throw new Error(`copies ${raw._copy.name} (${raw._copy.source}), which isn't loaded`);
  const base = JSON.parse(JSON.stringify(resolveCopy(original, lookup, new Set([...seen, key]))));
  const { _copy, ...own } = raw;
  const merged = { ...base, ...own };
  for (const [field, mod] of Object.entries(_copy._mod || {})) applyMod(merged, field, mod);
  delete merged._copy;
  return merged;
}

// files: [{ id, data: { monster: [...], _meta } }] in load order. Returns
// { monsters: [{ fileId, monster }], skipped: [{ fileId, name, reason }] }.
function convertFiveToolsFiles(files) {
  const lookup = new Map();
  files.forEach(file => (file.data.monster || []).forEach(raw => {
    if (raw && raw.name) lookup.set(`${raw.name.toLowerCase()}|${String(raw.source || '').toLowerCase()}`, raw);
  }));
  const monsters = [];
  const skipped = [];
  for (const file of files) {
    for (const raw of file.data.monster || []) {
      try {
        monsters.push({ fileId: file.id, monster: convertMonster(resolveCopy(raw, lookup), file.data._meta) });
      } catch (error) {
        skipped.push({ fileId: file.id, name: raw && raw.name ? String(raw.name) : '(no name)', reason: error.message });
      }
    }
  }
  return { monsters, skipped };
}

module.exports = { FIVETOOLS_SOURCE_NAMES: SOURCE_NAMES, fiveToolsUntag: untag, convertFiveToolsMonster: convertMonster, convertFiveToolsFiles };
