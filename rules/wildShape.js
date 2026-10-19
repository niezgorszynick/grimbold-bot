// rules/wildShape.js — Druid Wild Shape (2024 PHB): the beasts from
// rules/content/beasts.md, which forms a druid may learn at their level, and
// the combined stat block while transformed.
//
// While in a form the druid keeps their Hit Points, Hit Point Dice, INT, WIS
// and CHA, class features, languages and feats, and their skill and saving
// throw proficiencies (with their own Proficiency Bonus). Everything else
// (AC, speed, STR, DEX, CON, senses, attacks) comes from the beast.
//
// Stored: sheetData.wildShape.known (learned form names) and the vitals key
// wildShapeForm (the form the druid is in now, or null).
//
// Circle of the Stars: Starry Form spends a Wild Shape use too, but keeps the
// druid's own statistics and adds a constellation (vitals key starryForm).
// Cosmic Omen (level 6) is rolled after each Long Rest (vitals key cosmicOmen).

const { loadContent } = require('./content');
const { SKILLS, abilityModifier, proficiencyBonus } = require('./util');
const { effectiveAbilityScore } = require('./magicItems');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const BEAST_ABILITIES = ['str', 'dex', 'con'];
const SECTION_KEYS = { Traits: 'traits', Actions: 'actions', 'Bonus actions': 'bonusActions', 'Bonus Actions': 'bonusActions', Reactions: 'reactions' };

const dashes = text => String(text || '').replace(/[–—−]/g, '-');
const plain = text => String(text || '').replace(/\*/g, '').trim();
const toNumber = text => {
  const match = dashes(text).match(/[+-]?\d+/);
  return match ? Number(match[0]) : null;
};

function parseCr(text) {
  const match = String(text || '').match(/^\s*(\d+)(?:\/(\d+))?/);
  if (!match) return null;
  return match[2] ? Number(match[1]) / Number(match[2]) : Number(match[1]);
}

function formatCr(cr) {
  return { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[cr] || String(cr);
}

// "1d4 - 1" → "1d4-1"
const formulaOf = text => dashes(text).replace(/\s+/g, '');

// The damage rolls in an attack's Hit text. Damage after "plus" adds to the
// main roll; "or ..." is an alternative (Bloodied targets, a charge) and
// "extra ..." a rider (charging); both get their own roll.
function parseDamage(hitText) {
  const text = dashes(hitText);
  const pattern = /(\d+)(?:\s*\(([^)]+)\))?\s+([A-Z][a-z]+) damage/g;
  const main = [];
  const others = [];
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    const between = text.slice(last, match.index);
    last = pattern.lastIndex;
    const term = { formula: match[2] ? formulaOf(match[2]) : match[1], type: match[3], average: Number(match[1]) };
    if (!/^\d+d\d+([+-]\d+)?$/.test(term.formula) && !/^\d+$/.test(term.formula)) continue;
    if (!main.length) main.push(term);
    else if (/\bor\b/.test(between)) others.push({ ...term, kind: 'or' });
    else if (/\bextra\b/.test(between)) others.push({ ...term, kind: 'extra' });
    else if (/\bplus\b/.test(between) && !others.length) main.push(term);
    else others.push({ ...term, kind: /\bplus\b/.test(between) ? 'plus' : 'extra' });
  }
  if (!main.length) return null;
  return {
    formula: main.map(term => term.formula).join('+'),
    type: main.map(term => term.type).join(' + '),
    text: main.map(term => (term.formula === String(term.average) ? `${term.average} ${term.type}` : `${term.average} (${term.formula}) ${term.type}`)).join(' plus '),
    others: others.map(term => ({ formula: term.formula, type: term.type, kind: term.kind }))
  };
}

// "**Bite**. *Melee Attack Roll*: +4, reach 5 ft. *Hit*: 5 (1d6 + 2) Piercing damage."
function parseFeature(name, rawText) {
  const text = plain(rawText);
  const feature = { name, text };
  const attack = dashes(rawText).match(/(Melee|Ranged)(?: or Ranged)? Attack Roll\*?:\s*([+-]\d+)/);
  if (!attack) return feature;
  const hit = rawText.split(/\*?Hit\*?:\s*/)[1] || '';
  const reach = dashes(text).match(/\b(reach \d+ (?:ft\.|feet)|range [\d/]+ (?:ft\.|feet))/);
  return {
    ...feature,
    attack: {
      kind: attack[1].toLowerCase(),
      bonus: Number(attack[2]),
      reach: reach ? reach[1].replace('feet', 'ft.') : '',
      damage: parseDamage(hit)
    }
  };
}

function parseFeatures(sectionText) {
  const features = [];
  for (const line of String(sectionText || '').split('\n')) {
    if (!line.trim() || /^\*\*(Habitat|Source)\*\*:/.test(line)) continue;
    const start = line.match(/^\*\*(.+?)\*\*\.\s*(.*)$/);
    if (start) features.push({ name: start[1].trim(), raw: start[2] });
    else if (features.length) features[features.length - 1].raw += `\n${line}`;
  }
  return features.map(item => parseFeature(item.name, item.raw));
}

// One beasts.md entry → a stat block. The fields and the ability table are in
// the entry's description; traits and actions in its ### sections.
function parseBeast(entry) {
  const text = dashes(entry.description);
  const field = name => {
    const match = text.match(new RegExp(`^-\\s+\\*\\*${name}\\*\\*:\\s*(.+)$`, 'mi'));
    if (match) return match[1].trim();
    // Fields right under the heading (no type line before them) are parsed as fields.
    const key = name.toLowerCase().replace(/\s+(.)/g, (_, char) => char.toUpperCase());
    return dashes((entry.fields || {})[key] || '').trim();
  };
  const typeLine = (text.match(/^\*([^*\n]+)\*\s*$/m) || [])[1] || '';
  const abilities = {};
  const saves = {};
  for (const ability of ABILITIES) {
    const row = text.match(new RegExp(`^\\|\\s*\\*\\*${ability}\\*\\*\\s*\\|\\s*(\\d+)\\s*\\|[^|]*\\|\\s*([+-]?\\s*\\d+)\\s*\\|`, 'mi'));
    if (!row) continue;
    abilities[ability] = Number(row[1]);
    saves[ability] = Number(row[2].replace(/\s+/g, ''));
  }
  const skills = {};
  for (const part of field('Skills').split(',')) {
    const match = part.trim().match(/^(.+?)\s+([+-]\d+)$/);
    if (match && SKILLS[match[1]]) skills[match[1]] = Number(match[2]);
  }
  const speed = field('Speed');
  const sizeMatch = typeLine.match(/^(Tiny|Small|Medium|Large|Huge|Gargantuan)/);
  const beast = {
    name: entry.name,
    typeLine: typeLine.trim(),
    size: sizeMatch ? sizeMatch[1] : '',
    armorClass: toNumber(field('Armor Class')),
    hitPoints: field('Hit Points'),
    speed,
    fly: /\bfly\b/i.test(speed),
    swim: /\bswim\b/i.test(speed),
    abilities,
    saves,
    skills,
    senses: field('Senses'),
    cr: parseCr(field('Challenge')),
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: []
  };
  for (const [section, body] of Object.entries(entry.sections || {})) {
    const key = SECTION_KEYS[section];
    if (key) beast[key] = parseFeatures(body);
  }
  return beast;
}

let cache = null;
let cacheSource = null;

// { name: beast } for every complete entry in beasts.md ({} without the file).
function loadBeasts() {
  const entries = loadContent('beasts');
  if (cache && cacheSource === entries) return cache;
  cache = {};
  for (const entry of Object.values(entries)) {
    const beast = parseBeast(entry);
    if (beast.cr === null || beast.armorClass === null || BEAST_ABILITIES.some(ability => !beast.abilities[ability])) continue;
    cache[beast.name] = beast;
  }
  cacheSource = entries;
  return cache;
}

function getBeast(name) {
  const beasts = loadBeasts();
  return Object.hasOwn(beasts, name) ? beasts[name] : null;
}

// classRows: [{ className, subclassName, level }]. null for non-druids and level 1.
function wildShapeRules(classRows) {
  const druid = (classRows || []).find(row => row.className === 'Druid');
  if (!druid || druid.level < 2) return null;
  const level = druid.level;
  const moon = druid.subclassName === 'Circle of the Moon' && level >= 3;
  const baseCr = level >= 8 ? 1 : level >= 4 ? 0.5 : 0.25;
  return {
    druidLevel: level,
    moon,
    knownLimit: level >= 8 ? 8 : level >= 4 ? 6 : 4,
    // Circle Forms: up to druid level ÷ 3.
    maxCr: moon ? Math.max(baseCr, Math.floor(level / 3)) : baseCr,
    canFly: level >= 8,
    tempHp: moon ? 3 * level : level,
    hours: Math.floor(level / 2)
  };
}

// Why this beast can't be learned now, or null if it can.
function formProblem(beast, status) {
  if (!beast) return 'There is no such beast in the list.';
  if (beast.cr > status.maxCr) return `${beast.name} is CR ${formatCr(beast.cr)}; your limit is CR ${formatCr(status.maxCr)}.`;
  if (beast.fly && !status.canFly) return `${beast.name} has a Fly Speed; flying forms come at Druid level 8.`;
  return null;
}

function knownForms(sheetData) {
  const known = ((sheetData || {}).wildShape || {}).known;
  return Array.isArray(known) ? known.filter(name => typeof name === 'string') : [];
}

// Next sheetData with a form learned or forgotten.
function changeKnownForms(sheetData, status, { learn, forget }) {
  if (!status) throw new Error('Only a Druid of level 2 or higher has Wild Shape.');
  let known = knownForms(sheetData);
  if (forget) {
    if (!known.includes(forget)) throw new Error(`${forget} is not one of your forms.`);
    if ((sheetData || {}).wildShapeForm === forget) throw new Error(`Revert from ${forget} form before forgetting it.`);
    known = known.filter(name => name !== forget);
  }
  if (learn) {
    const beast = getBeast(learn);
    const problem = formProblem(beast, status);
    if (problem) throw new Error(problem);
    if (known.includes(beast.name)) throw new Error(`You already know ${beast.name}.`);
    if (known.length >= status.knownLimit) throw new Error(`You know ${status.knownLimit} forms already; forget one first.`);
    known = [...known, beast.name];
  }
  return { ...sheetData, wildShape: { ...((sheetData || {}).wildShape || {}), known } };
}

// The druid in beast form. character: { classes, sheetData }; initiative is
// the druid's own initiative total (with DEX swapped for the beast's below).
function wildShapeBlock(beast, { classes, sheetData, status, initiative = null }) {
  const totalLevel = classes.reduce((sum, row) => sum + row.level, 0);
  const pb = proficiencyBonus(Math.max(1, totalLevel));
  const own = ability => effectiveAbilityScore(sheetData, ability);
  const scores = Object.fromEntries(ABILITIES.map(ability => [ability, BEAST_ABILITIES.includes(ability) ? beast.abilities[ability] : own(ability)]));
  const mods = Object.fromEntries(ABILITIES.map(ability => [ability, abilityModifier(scores[ability])]));
  const saveProfs = Array.isArray(sheetData.savingProficiencies) ? sheetData.savingProficiencies : [];
  const skillProfs = Array.isArray(sheetData.skillProficiencies) ? sheetData.skillProficiencies : [];
  const expertise = Array.isArray(sheetData.expertise) ? sheetData.expertise : [];

  // The better of the beast's bonus and the druid's proficiency on the new score.
  const saves = Object.fromEntries(ABILITIES.map(ability => {
    const yours = mods[ability] + (saveProfs.includes(ability) ? pb : 0);
    return [ability, BEAST_ABILITIES.includes(ability) ? Math.max(yours, beast.saves[ability] ?? mods[ability]) : yours];
  }));
  const skills = Object.fromEntries(Object.entries(SKILLS).map(([skill, ability]) => {
    const yours = mods[ability] + (skillProfs.includes(skill) ? pb : 0) + (expertise.includes(skill) ? pb : 0);
    return [skill, Math.max(yours, beast.skills[skill] ?? -99)];
  }));
  const wisMod = mods.wis;
  const armorClass = status && status.moon ? Math.max(beast.armorClass, 13 + wisMod) : beast.armorClass;
  const ownDex = abilityModifier(own('dex'));
  return {
    name: beast.name,
    typeLine: beast.typeLine,
    cr: formatCr(beast.cr),
    armorClass,
    armorClassNote: status && status.moon && armorClass > beast.armorClass ? `Circle Forms: 13 + WIS (${beast.armorClass} for the beast)` : null,
    speed: beast.speed,
    // Passive Perception is worked out above (with the druid's own WIS).
    senses: beast.senses.replace(/,?\s*Passive Perception \d+/i, '').replace(/^,\s*/, '').trim(),
    scores,
    mods,
    saves,
    skills,
    proficientSkills: Object.keys(skills).filter(skill => skillProfs.includes(skill) || Object.hasOwn(beast.skills, skill)),
    passivePerception: 10 + skills.Perception,
    initiative: initiative === null ? mods.dex : initiative - ownDex + mods.dex,
    traits: beast.traits,
    actions: beast.actions,
    bonusActions: beast.bonusActions,
    reactions: beast.reactions,
    // Rollable attacks, in order: their index is the roll id (beast:<index>:hit).
    attacks: beast.actions.filter(item => item.attack && item.attack.damage).map(item => ({
      name: item.name,
      attackBonus: item.attack.bonus,
      reach: item.attack.reach,
      damage: item.attack.damage
    }))
  };
}

// ─── Circle of the Stars ─────────────────────────────────────────────────────

const CONSTELLATIONS = ['Archer', 'Chalice', 'Dragon'];

// null unless a Circle of the Stars druid of level 3+.
function starryFormRules(classRows) {
  const druid = (classRows || []).find(row => row.className === 'Druid' && row.subclassName === 'Circle of the Stars');
  if (!druid || druid.level < 3) return null;
  const level = druid.level;
  return {
    druidLevel: level,
    dice: level >= 10 ? '2d8' : '1d8',
    // Twinkling Constellations: switch at the start of each turn; Dragon flies.
    canSwitch: level >= 10,
    dragonFlies: level >= 10,
    // Full of Stars.
    resistance: level >= 14,
    cosmicOmen: level >= 6
  };
}

// What each constellation does for this druid. wisMod: Wisdom modifier;
// spellAttack: the Druid spell attack bonus.
function constellations(status, { wisMod, spellAttack }) {
  const bonus = wisMod ? (wisMod > 0 ? '+' + wisMod : String(wisMod)) : '';
  const formula = status.dice + bonus;
  return [
    {
      name: 'Archer',
      text: 'When you take this form, and as a Bonus Action on later turns, make a ranged spell attack at a creature within 60 ft.: ' + formula + ' Radiant damage on a hit.',
      attack: { name: 'Luminous Arrow', attackBonus: spellAttack, damage: { formula, type: 'Radiant' } }
    },
    {
      name: 'Chalice',
      text: 'When you cast a spell with a spell slot that restores Hit Points, you or another creature within 30 ft. also regains ' + formula + ' HP.',
      healing: formula
    },
    {
      name: 'Dragon',
      text: 'On Intelligence and Wisdom checks, and Constitution saves to keep Concentration, treat a d20 roll of 9 or lower as a 10.' +
        (status.dragonFlies ? ' You have a Fly Speed of 20 ft. and can hover.' : '')
    }
  ];
}

module.exports = {
  CONSTELLATIONS,
  starryFormRules,
  constellations,
  parseBeast,
  parseFeature,
  parseCr,
  loadBeasts,
  getBeast,
  wildShapeRules,
  formProblem,
  knownForms,
  changeKnownForms,
  wildShapeBlock,
  formatCr
};
