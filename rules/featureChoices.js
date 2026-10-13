// rules/featureChoices.js — Class and subclass features that grant
// proficiencies or ask for a choice (2024 PHB): Divine Order, Primal Order,
// Expertise, Thieves' Cant, Deft Explorer, Scholar, Primal Knowledge, and the
// level 3 subclass proficiencies (College of Lore, College of Valor, ...).
//
// Each feature is one pick, identified by `${source}:${level}:${name}` (e.g.
// "Rogue:1:Expertise"). Creation, level-ups and the sheet's "missing choices"
// card all use applyFeatureChoices, which records every pick and what it
// added in sheetData.featureChoices so a level-up can be undone exactly.
//
// Kinds:
//   option    — pick one of `options`; each option grants weapons, armor, cantrips
//   skills    — gain proficiency in `count` skills from `options`
//   expertise — Expertise in `count` skills you're proficient in (from `options` if set)
//   languages — learn `count` languages
//   tools     — gain proficiency in `count` tools from a TOOL_CATEGORIES category
//   grant     — no choice: fixed skills, tools, languages, weapons, armor

const { SKILL_NAMES, ABILITIES, abilityModifier } = require('./util');
const { getClass } = require('./classes');
const { TOOL_CATEGORIES, STANDARD_LANGUAGES, RARE_LANGUAGES } = require('./equipment');

const ALL_LANGUAGES = [...STANDARD_LANGUAGES, ...RARE_LANGUAGES];
const classSkills = className => {
  const options = getClass(className).skillChoices.options;
  return options === 'any' ? SKILL_NAMES : options;
};

// className → level → features.
const CLASS_FEATURES = {
  Bard: {
    2: [{ name: 'Expertise', kind: 'expertise', count: 2 }],
    9: [{ name: 'Expertise', kind: 'expertise', count: 2 }]
  },
  Cleric: {
    1: [{
      name: 'Divine Order',
      kind: 'option',
      options: {
        Protector: { weapons: ['Martial weapons'], armor: ['Heavy armor'], text: 'Martial weapons and Heavy armor training.' },
        Thaumaturge: { cantrips: 1, checkBonus: { skills: ['Arcana', 'Religion'], ability: 'wis' }, text: 'One extra cantrip, and your Wisdom modifier (min +1) on Arcana and Religion checks.' }
      }
    }]
  },
  Druid: {
    1: [
      { name: 'Druidic', kind: 'grant', languages: ['Druidic'] },
      {
        name: 'Primal Order',
        kind: 'option',
        options: {
          Magician: { cantrips: 1, checkBonus: { skills: ['Arcana', 'Nature'], ability: 'wis' }, text: 'One extra cantrip, and your Wisdom modifier (min +1) on Arcana and Nature checks.' },
          Warden: { weapons: ['Martial weapons'], armor: ['Medium armor'], text: 'Martial weapons and Medium armor training.' }
        }
      }
    ]
  },
  Barbarian: {
    3: [{ name: 'Primal Knowledge', kind: 'skills', count: 1, options: () => classSkills('Barbarian') }]
  },
  Ranger: {
    2: [
      { name: 'Deft Explorer (Expertise)', kind: 'expertise', count: 1 },
      { name: 'Deft Explorer (Languages)', kind: 'languages', count: 2 }
    ],
    9: [{ name: 'Expertise', kind: 'expertise', count: 2 }]
  },
  Rogue: {
    1: [
      { name: 'Expertise', kind: 'expertise', count: 2 },
      { name: "Thieves' Cant", kind: 'grant', languages: ["Thieves' Cant"] },
      { name: "Thieves' Cant (Language)", kind: 'languages', count: 1 }
    ],
    6: [{ name: 'Expertise', kind: 'expertise', count: 2 }]
  },
  Wizard: {
    2: [{ name: 'Scholar', kind: 'expertise', count: 1, options: ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Religion'] }]
  }
};

// subclassName → level → features.
const SUBCLASS_FEATURES = {
  'College of Lore': { 3: [{ name: 'Bonus Proficiencies', kind: 'skills', count: 3, options: () => SKILL_NAMES }] },
  'College of Valor': { 3: [{ name: 'Martial Training', kind: 'grant', weapons: ['Martial weapons'], armor: ['Medium armor', 'Shields'] }] },
  'Battle Master': {
    3: [
      { name: 'Student of War (Tool)', kind: 'tools', count: 1, category: 'artisan' },
      { name: 'Student of War (Skill)', kind: 'skills', count: 1, options: () => classSkills('Fighter') }
    ]
  },
  'Warrior of Mercy': { 3: [{ name: 'Implements of Mercy', kind: 'grant', skills: ['Insight', 'Medicine'], tools: ['Herbalism Kit'] }] },
  'Fey Wanderer': {
    3: [{
      name: 'Otherworldly Glamour', kind: 'skills', count: 1, options: () => ['Deception', 'Performance', 'Persuasion'],
      checkBonus: { ability: 'wis', checks: ['cha'] }
    }]
  },
  Assassin: { 3: [{ name: "Assassin's Tools", kind: 'grant', tools: ['Disguise Kit', "Poisoner's Kit"] }] },
  Armorer: { 3: [{ name: 'Tools of the Trade', kind: 'grant', armor: ['Heavy armor'], tools: ["Smith's Tools"] }] },
  'Battle Smith': { 3: [{ name: 'Tools of the Trade', kind: 'grant', weapons: ['Martial weapons'], tools: ["Smith's Tools"] }] },
  Alchemist: { 3: [{ name: 'Tools of the Trade', kind: 'grant', tools: ["Alchemist's Supplies"] }] },
  Artillerist: { 3: [{ name: 'Tools of the Trade', kind: 'grant', tools: ["Woodcarver's Tools"] }] },
  Cartographer: { 3: [{ name: 'Tools of the Trade', kind: 'grant', tools: ["Cartographer's Tools"] }] }
};

// A feature as the client sees it: plain data, options resolved to lists.
function describe(feature, source, level) {
  const id = `${source}:${level}:${feature.name}`;
  const options = typeof feature.options === 'function' ? feature.options() : feature.options;
  return {
    id,
    name: feature.name,
    source,
    level,
    kind: feature.kind,
    count: feature.count || null,
    options: feature.kind === 'option'
      ? Object.entries(options).map(([name, grants]) => ({ name, text: grants.text }))
      : feature.kind === 'tools' ? TOOL_CATEGORIES[feature.category]
        : feature.kind === 'languages' ? ALL_LANGUAGES
          : options || (feature.kind === 'expertise' ? SKILL_NAMES : null),
    grants: feature.kind === 'grant'
      ? { skills: feature.skills || [], tools: feature.tools || [], languages: feature.languages || [], weapons: feature.weapons || [], armor: feature.armor || [] }
      : null
  };
}

// The features gained at exactly this class level (the subclass's too, when it has one).
function featuresAtLevel(className, subclassName, classLevel) {
  const fromClass = ((CLASS_FEATURES[className] || {})[classLevel] || []).map(feature => describe(feature, className, classLevel));
  const fromSubclass = subclassName
    ? ((SUBCLASS_FEATURES[subclassName] || {})[classLevel] || []).map(feature => describe(feature, subclassName, classLevel))
    : [];
  return [...fromClass, ...fromSubclass];
}

// Every feature a character with these classes has, up to their levels.
// classes: [{ className, subclassName, level }]
function featuresForClasses(classes) {
  return classes.flatMap(row => {
    const list = [];
    for (let level = 1; level <= row.level; level += 1) list.push(...featuresAtLevel(row.className, row.subclassName, level));
    return list;
  });
}

function rawFeature(id) {
  const [source, level, ...rest] = id.split(':');
  const name = rest.join(':');
  const table = CLASS_FEATURES[source] || SUBCLASS_FEATURES[source] || {};
  return (table[Number(level)] || []).find(feature => feature.name === name) || null;
}

// The features in `features` this sheet hasn't chosen yet.
function missingFeatureChoices(features, sheetData) {
  const chosen = (sheetData && sheetData.featureChoices) || {};
  return features.filter(feature => !Object.hasOwn(chosen, feature.id));
}

function pickList(label, picks, count, allowed) {
  const values = Array.isArray(picks) ? picks : (picks ? [picks] : []);
  if (values.length !== count) throw new Error(`${label}: choose ${count}.`);
  if (new Set(values).size !== values.length) throw new Error(`${label}: choose different ones.`);
  const invalid = values.find(value => !allowed.includes(value));
  if (invalid !== undefined) throw new Error(`${label}: "${invalid}" is not a valid choice.`);
  return values;
}

const union = (list, added) => [...new Set([...(list || []), ...(added || [])])];

// Applies the player's picks for `features` to the sheet.
// picks: { [feature id]: option name | [skills | languages | tools] }
// Returns { sheetData, added } — added lists everything granted, for level history.
function applyFeatureChoices(sheetData, features, picks) {
  const choices = picks && typeof picks === 'object' ? picks : {};
  let sheet = { ...sheetData, featureChoices: { ...(sheetData.featureChoices || {}) } };
  const total = { skills: [], expertise: [], tools: [], languages: [], weapons: [], armor: [], cantrips: 0, ids: [] };
  // Skill proficiencies first, so Expertise can use a skill gained at the same time.
  const ordered = [...features].sort((a, b) => (a.kind === 'expertise') - (b.kind === 'expertise'));

  for (const feature of ordered) {
    const raw = rawFeature(feature.id);
    if (!raw) throw new Error(`Unknown feature ${feature.id}.`);
    const label = `${feature.name} (${feature.source} ${feature.level})`;
    const added = { skills: [], expertise: [], tools: [], languages: [], weapons: [], armor: [], cantrips: 0 };
    let value = null;
    const skills = new Set(sheet.skillProficiencies || []);
    const expertise = new Set(sheet.expertise || []);
    const tools = new Set(sheet.toolProficiencies || []);
    const languages = new Set(sheet.languages || []);

    if (feature.kind === 'option') {
      value = choices[feature.id];
      const option = raw.options[value];
      if (!option) throw new Error(`${label}: choose ${Object.keys(raw.options).join(' or ')}.`);
      added.weapons = option.weapons || [];
      added.armor = option.armor || [];
      added.cantrips = option.cantrips || 0;
    } else if (feature.kind === 'skills') {
      value = pickList(label, choices[feature.id], feature.count, feature.options.filter(skill => !skills.has(skill)));
      added.skills = value;
    } else if (feature.kind === 'expertise') {
      const picked = Array.isArray(choices[feature.id]) ? choices[feature.id] : [];
      const unskilled = picked.find(skill => SKILL_NAMES.includes(skill) && !skills.has(skill));
      if (unskilled) throw new Error(`${label}: Expertise needs a skill you're proficient in, and you aren't proficient in ${unskilled}.`);
      const already = picked.find(skill => expertise.has(skill));
      if (already) throw new Error(`${label}: you already have Expertise in ${already}.`);
      value = pickList(label, picked, feature.count, feature.options.filter(skill => skills.has(skill) && !expertise.has(skill)));
      added.expertise = value;
    } else if (feature.kind === 'languages') {
      value = pickList(label, choices[feature.id], feature.count, ALL_LANGUAGES.filter(language => !languages.has(language)));
      added.languages = value;
    } else if (feature.kind === 'tools') {
      value = pickList(label, choices[feature.id], feature.count, feature.options.filter(tool => !tools.has(tool)));
      added.tools = value;
    } else {
      added.skills = (raw.skills || []).filter(skill => !skills.has(skill));
      added.tools = (raw.tools || []).filter(tool => !tools.has(tool));
      added.languages = (raw.languages || []).filter(language => !languages.has(language));
      added.weapons = raw.weapons || [];
      added.armor = raw.armor || [];
    }

    // Weapons and armor may already be known; only record what's new, so an undo
    // never takes away training from another source.
    added.weapons = added.weapons.filter(item => !(sheet.weaponProficiencies || []).includes(item));
    added.armor = added.armor.filter(item => !(sheet.armorTraining || []).includes(item));
    sheet = {
      ...sheet,
      skillProficiencies: union(sheet.skillProficiencies, added.skills),
      expertise: union(sheet.expertise, added.expertise),
      toolProficiencies: union(sheet.toolProficiencies, added.tools),
      languages: union(sheet.languages, added.languages),
      weaponProficiencies: union(sheet.weaponProficiencies, added.weapons),
      armorTraining: union(sheet.armorTraining, added.armor)
    };
    if (added.cantrips) {
      const pending = sheet.pendingChoices || {};
      sheet.pendingChoices = { ...pending, cantrips: (pending.cantrips || 0) + added.cantrips };
    }
    sheet.featureChoices[feature.id] = { name: feature.name, source: feature.source, level: feature.level, value, added };
    for (const key of ['skills', 'expertise', 'tools', 'languages', 'weapons', 'armor']) total[key].push(...added[key]);
    total.cantrips += added.cantrips;
    total.ids.push(feature.id);
  }
  return { sheetData: sheet, added: total };
}

// Undoes the picks recorded under these ids (a reverted level-up).
function removeFeatureChoices(sheetData, ids) {
  const chosen = { ...(sheetData.featureChoices || {}) };
  const removed = { skills: [], expertise: [], tools: [], languages: [], weapons: [], armor: [], cantrips: 0 };
  for (const id of ids || []) {
    const entry = chosen[id];
    if (!entry) continue;
    for (const key of Object.keys(removed)) {
      if (key === 'cantrips') removed.cantrips += entry.added.cantrips || 0;
      else removed[key].push(...(entry.added[key] || []));
    }
    delete chosen[id];
  }
  const without = (list, gone) => (list || []).filter(item => !gone.includes(item));
  const pending = sheetData.pendingChoices || {};
  return {
    ...sheetData,
    featureChoices: chosen,
    skillProficiencies: without(sheetData.skillProficiencies, removed.skills),
    expertise: without(sheetData.expertise, removed.expertise),
    toolProficiencies: without(sheetData.toolProficiencies, removed.tools),
    languages: without(sheetData.languages, removed.languages),
    weaponProficiencies: without(sheetData.weaponProficiencies, removed.weapons),
    armorTraining: without(sheetData.armorTraining, removed.armor),
    pendingChoices: { ...pending, cantrips: Math.max(0, (pending.cantrips || 0) - removed.cantrips) }
  };
}

// Extra cantrips from choices such as Thaumaturge, for one class's spell list.
function extraCantrips(sheetData, className) {
  return Object.values((sheetData && sheetData.featureChoices) || {})
    .filter(entry => entry.source === className)
    .reduce((sum, entry) => sum + ((entry.added && entry.added.cantrips) || 0), 0);
}

// Check bonuses from feature choices: { skills: { Arcana: 3 }, checks: { cha: 2 } }.
// scoreOf(ability) gives the character's score.
function featureCheckBonuses(sheetData, scoreOf) {
  const result = { skills: {}, checks: {} };
  for (const [id, entry] of Object.entries((sheetData && sheetData.featureChoices) || {})) {
    const raw = rawFeature(id);
    if (!raw) continue;
    const bonus = raw.kind === 'option' ? (raw.options[entry.value] || {}).checkBonus : raw.checkBonus;
    if (!bonus) continue;
    const value = Math.max(1, abilityModifier(scoreOf(bonus.ability)));
    (bonus.skills || []).forEach(skill => { result.skills[skill] = Math.max(result.skills[skill] || 0, value); });
    (bonus.checks || []).filter(ability => ABILITIES.includes(ability)).forEach(ability => {
      result.checks[ability] = Math.max(result.checks[ability] || 0, value);
    });
  }
  return result;
}

module.exports = {
  CLASS_FEATURE_CHOICES: CLASS_FEATURES,
  SUBCLASS_FEATURE_CHOICES: SUBCLASS_FEATURES,
  featuresAtLevel,
  featuresForClasses,
  missingFeatureChoices,
  applyFeatureChoices,
  removeFeatureChoices,
  extraCantrips,
  featureCheckBonuses
};
