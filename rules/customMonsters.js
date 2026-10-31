// rules/customMonsters.js — A DM's own statblocks for one adventure (homebrew,
// or a catalog monster changed for this adventure only). They are edited as a
// "draft" of plain fields, and turned into the same statblock shape
// rules/monsters.js gives, so encounters, the statblock view and the dice
// treat them like any monster.
//
// Draft: { name, size, type, alignment, armorClass, armorNote, hitPoints,
// hitDice, speed, initiative, str…cha, saves ("Con +3, Wis +2"), skills
// ("Perception +5"), vulnerabilities, resistances, immunities, senses,
// languages, cr ("1/2"), traits, actions, bonusActions, reactions,
// legendaryActions (each: one entry per paragraph, "Name. What it does."),
// legendaryIntro, lore }.

const { SKILLS, abilityModifier } = require('./util');
const { parseCr, formatCr } = require('./wildShape');
const { CREATURE_TYPES, XP_BY_CR } = require('./monsters');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_BY_NAME = {
  str: 'str', strength: 'str', dex: 'dex', dexterity: 'dex', con: 'con', constitution: 'con',
  int: 'int', intelligence: 'int', wis: 'wis', wisdom: 'wis', cha: 'cha', charisma: 'cha'
};
const SECTIONS = ['traits', 'actions', 'bonusActions', 'reactions', 'legendaryActions'];
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const LIMITS = { name: 100, short: 200, entries: 8000, lore: 4000 };

const signed = n => (n >= 0 ? `+${n}` : `${n}`);
const text = (value, max = LIMITS.short) => String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
const dashes = value => String(value || '').replace(/[–—−]/g, '-');

function intIn(value, min, max, label, fallback = null) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const number = Number(dashes(value));
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return number;
}

// "Con +3, Wis +2" → { con: 3, wis: 2 }
function bonusList(value, keyOf) {
  const out = {};
  for (const part of dashes(value).split(/[,;]/)) {
    const match = part.trim().match(/^(.+?)\s*([+-]\s*\d+)$/);
    if (!match) continue;
    const key = keyOf(match[1].trim());
    if (key) out[key] = Number(match[2].replace(/\s+/g, ''));
  }
  return out;
}

const SAVE_NAMES = { Strength: 'Strength', Dexterity: 'Dexterity', Constitution: 'Constitution', Intelligence: 'Intelligence', Wisdom: 'Wisdom', Charisma: 'Charisma' };

// One paragraph "Name. What it does." → an entry the dice can read.
function entryOf(paragraph) {
  const clean = paragraph.replace(/\*\*/g, '').replace(/^\*|\*$/g, '').trim();
  const match = clean.match(/^([^.\n]{1,120}?)\.\s+([\s\S]+)$/);
  const name = match ? match[1].replace(/\*/g, '').trim() : clean.split('\n')[0].slice(0, 60);
  const body = match ? match[2].trim() : clean;
  const entry = { name, text: body.replace(/\*/g, ''), sub: /^\d+:/.test(name) };
  const attack = dashes(body).match(/(Melee|Ranged)(?: or Ranged)?(?: Weapon| Spell)? Attack(?: Roll)?\*?:\s*([+-]\d+)/i);
  if (attack) {
    const reach = body.match(/\b(reach \d+ (?:ft\.|feet)|range [\d/]+ (?:ft\.|feet))/i);
    entry.attack = { kind: attack[1].toLowerCase(), bonus: Number(attack[2]), reach: reach ? reach[1] : '', damage: null };
  }
  const save = body.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw\*?:\s*DC (\d+)/i)
    || (() => { const other = body.match(/DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i); return other ? [other[0], other[2], other[1]] : null; })();
  if (save) entry.save = { ability: SAVE_NAMES[save[1][0].toUpperCase() + save[1].slice(1).toLowerCase()], dc: Number(save[2]) };
  return entry;
}

function entriesOf(value) {
  return text(value, LIMITS.entries).split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map(entryOf);
}

// A draft → a statblock (throws with a message a DM can act on).
function customMonsterFromDraft(draft, { id = null, basedOn = null } = {}) {
  const name = text(draft.name, LIMITS.name);
  if (!name) throw new Error('Give the creature a name.');
  const abilities = {};
  for (const ability of ABILITIES) abilities[ability] = intIn(draft[ability], 1, 30, ability.toUpperCase(), 10);
  const crText = text(draft.cr, 10) || '0';
  const cr = parseCr(dashes(crText));
  if (cr === null || (XP_BY_CR[cr] === undefined)) throw new Error('CR must be one of 0, 1/8, 1/4, 1/2 or 1–30.');
  const pb = cr < 5 ? 2 : Math.min(9, 2 + Math.ceil((cr - 4) / 4));
  const armorClass = intIn(draft.armorClass, 0, 40, 'AC', 10);
  const hitPoints = intIn(draft.hitPoints, 1, 5000, 'HP');
  if (hitPoints === null) throw new Error('Give the creature its HP.');
  const hitDice = text(draft.hitDice, 40).replace(/\s+/g, ' ');
  const savesGiven = bonusList(draft.saves, key => ABILITY_BY_NAME[key.toLowerCase()]);
  const skills = bonusList(draft.skills, key => Object.keys(SKILLS).find(skill => skill.toLowerCase() === key.toLowerCase()));
  const size = SIZES.find(entry => entry.toLowerCase() === text(draft.size, 20).toLowerCase()) || text(draft.size, 40) || 'Medium';
  const typeText = text(draft.type, 60) || 'Monstrosity';
  const alignment = text(draft.alignment, 60);
  const initiative = intIn(draft.initiative, -10, 30, 'Initiative', abilityModifier(abilities.dex));
  const monster = {
    name,
    typeLine: `${size} ${typeText}${alignment ? `, ${alignment}` : ''}`,
    size,
    type: CREATURE_TYPES.find(type => new RegExp(`\\b${type.slice(0, 7)}`, 'i').test(typeText)) || 'Other',
    swarm: /swarm/i.test(typeText),
    typeText,
    alignment,
    summon: false,
    armorClassText: `${armorClass}${text(draft.armorNote, 80) ? ` (${text(draft.armorNote, 80)})` : ''}`,
    armorClass,
    hitPointsText: `${hitPoints}${hitDice ? ` (${hitDice})` : ''}`,
    hitPoints,
    hitDice: hitDice ? hitDice.replace(/\s+/g, '') : null,
    speed: text(draft.speed, 80) || '30 ft.',
    initiative,
    abilities,
    saves: Object.fromEntries(ABILITIES.map(ability => [ability, savesGiven[ability] ?? abilityModifier(abilities[ability])])),
    skillsText: Object.entries(skills).map(([skill, bonus]) => `${skill} ${signed(bonus)}`).join(', '),
    skills,
    vulnerabilities: text(draft.vulnerabilities),
    resistances: text(draft.resistances),
    immunities: text(draft.immunities),
    gear: '',
    senses: text(draft.senses),
    languages: text(draft.languages) || 'None',
    challengeText: `${formatCr(cr)} (XP ${XP_BY_CR[cr]}; PB +${pb})`,
    cr,
    xp: XP_BY_CR[cr],
    lairXp: null,
    pb,
    crText: formatCr(cr),
    legendaryIntro: text(draft.legendaryIntro, 600),
    lore: text(draft.lore, LIMITS.lore),
    habitat: '',
    treasure: '',
    source: basedOn ? `Homebrew for this adventure, based on ${basedOn}` : 'Homebrew for this adventure',
    sourceCode: 'Homebrew',
    sourceName: 'Homebrew',
    custom: true,
    customId: id,
    basedOn
  };
  for (const section of SECTIONS) monster[section] = entriesOf(draft[section]);
  return monster;
}

// A statblock (catalog or custom) → a draft to edit.
function draftFromMonster(monster) {
  const savesText = ABILITIES
    .filter(ability => monster.saves && monster.saves[ability] !== undefined && monster.saves[ability] !== abilityModifier(monster.abilities[ability] || 10))
    .map(ability => `${ability[0].toUpperCase()}${ability.slice(1)} ${signed(monster.saves[ability])}`).join(', ');
  const armorNote = (String(monster.armorClassText || '').match(/^\d+\s*\((.*)\)$/) || [])[1] || '';
  const hitDice = (String(monster.hitPointsText || '').match(/\(([^)]+)\)/) || [])[1] || '';
  const draft = {
    name: monster.name,
    size: monster.size || 'Medium',
    type: monster.typeText || monster.type || '',
    alignment: monster.alignment || '',
    armorClass: monster.armorClass ?? 10,
    armorNote,
    hitPoints: monster.hitPoints ?? 1,
    hitDice,
    speed: monster.speed || '30 ft.',
    initiative: monster.initiative ?? abilityModifier((monster.abilities || {}).dex || 10),
    saves: savesText,
    skills: monster.skillsText || '',
    vulnerabilities: monster.vulnerabilities || '',
    resistances: monster.resistances || '',
    immunities: monster.immunities || '',
    senses: monster.senses || '',
    languages: monster.languages || '',
    cr: monster.crText && monster.crText !== '—' ? monster.crText : '0',
    legendaryIntro: monster.legendaryIntro || '',
    lore: monster.lore || ''
  };
  for (const ability of ABILITIES) draft[ability] = (monster.abilities || {})[ability] || 10;
  for (const section of SECTIONS) draft[section] = (monster[section] || []).map(entry => `${entry.name}. ${entry.text}`).join('\n\n');
  return draft;
}

module.exports = { customMonsterFromDraft, draftFromMonster, CUSTOM_MONSTER_SECTIONS: SECTIONS };
