// rules/levelUp.js — Guided level-ups: what a character can choose for their
// next level, applying it to the sheet, and reverting it if XP is reduced.
//
// Character state passed in:
//   { classes: [{ className, subclassName, level }] (starting class first),
//     earnedLevel, species, sheetData }
// Each applied level is recorded in sheetData.levelHistory with everything it
// changed, so it can be undone exactly.

const { ABILITIES, SKILL_NAMES, abilityModifier } = require('./util');
const { getClass, ALL_CLASSES } = require('./classes');
const { DND_CLASSES_AND_SUBCLASSES } = require('./subclasses');
const {
  ORIGIN_FEATS, GENERAL_FEATS, GENERAL_FEAT_LEVEL, EPIC_BOONS, EPIC_BOON_LEVEL_REQUIREMENT, featName, featGrants
} = require('./feats');
const { TOOL_CATEGORIES } = require('./equipment');
const { planLevelUp } = require('./progression');
const { calculateMaxHp, formatHitDicePool, getHitDicePool } = require('./hitPoints');
const { getSpellSlots, getSpellsKnown, spellcastingFor } = require('./spellcasting');
const { MULTICLASS_PROFICIENCIES } = require('./multiclass');

const STANDARD_SCORE_CAP = 20;
const EPIC_BOON_SCORE_CAP = 30;

function readScores(sheetData) {
  const abilities = (sheetData && sheetData.abilities) || {};
  return Object.fromEntries(ABILITIES.map(ability => {
    const value = abilities[ability];
    const score = value && typeof value === 'object' ? (value.score ?? value.total) : value;
    return [ability, Number.isInteger(score) ? score : 10];
  }));
}

function writeScores(sheetData, scores) {
  return Object.fromEntries(ABILITIES.map(ability => [
    ability,
    { score: scores[ability], modifier: abilityModifier(scores[ability]) }
  ]));
}

// Every feat the character has: Origin feats plus feats taken at level-ups.
function collectCharacterFeats(sheetData) {
  const data = sheetData || {};
  const origin = Array.isArray(data.originFeats) ? data.originFeats : [];
  const history = Array.isArray(data.levelHistory) ? data.levelHistory : [];
  return [...origin, ...history.filter(entry => entry.feat).map(entry => entry.feat)];
}

function appliedLevel(classes) {
  return classes.reduce((sum, row) => sum + row.level, 0);
}

function hasSpellcasting(classes) {
  return classes.some(row => spellcastingFor(row.className, row.subclassName));
}

function armorTrainingOf(classes, sheetData) {
  const training = new Set((sheetData && sheetData.armorTraining) || []);
  classes.forEach((row, index) => {
    const classData = getClass(row.className);
    if (!classData) return;
    const list = index === 0 ? classData.armorTraining : ((MULTICLASS_PROFICIENCIES[row.className] || {}).armor || []);
    list.forEach(item => training.add(item));
  });
  collectCharacterFeats(sheetData).forEach(feat => (featGrants(feat).armorTraining || []).forEach(item => training.add(item)));
  return training;
}

// Returns null when the character qualifies, otherwise the reason they do not.
function featIneligibility(name, { classes, sheetData, scores, totalLevel }) {
  const owned = collectCharacterFeats(sheetData).map(featName);
  const origin = ORIGIN_FEATS[name];
  const general = GENERAL_FEATS[name];
  const boon = EPIC_BOONS[name];
  if (!origin && !general && !boon) return 'Unknown feat.';
  const repeatable = (origin && origin.repeatable) || (general && general.repeatable);
  if (owned.includes(name) && !repeatable) return 'Already taken.';
  if (boon && totalLevel < EPIC_BOON_LEVEL_REQUIREMENT) return `Requires level ${EPIC_BOON_LEVEL_REQUIREMENT}.`;
  if (general && totalLevel < GENERAL_FEAT_LEVEL) return `Requires level ${GENERAL_FEAT_LEVEL}.`;
  const prerequisite = (general && general.prerequisite) || {};
  if (prerequisite.scores && !prerequisite.scores.some(ability => scores[ability] >= 13)) {
    return `Requires ${prerequisite.scores.map(a => a.toUpperCase()).join(' or ')} 13+.`;
  }
  if (prerequisite.spellcasting && !hasSpellcasting(classes)) return 'Requires the Spellcasting or Pact Magic feature.';
  if (prerequisite.training && !armorTrainingOf(classes, sheetData).has(prerequisite.training)) {
    return `Requires ${prerequisite.training} training.`;
  }
  return null;
}

function listFeats(context, { allowBoons }) {
  const names = [
    ...Object.keys(GENERAL_FEATS),
    ...Object.keys(ORIGIN_FEATS),
    ...(allowBoons ? Object.keys(EPIC_BOONS) : [])
  ];
  return names.map(name => {
    const general = GENERAL_FEATS[name];
    const kind = EPIC_BOONS[name] ? 'epicBoon' : ORIGIN_FEATS[name] ? 'origin' : 'general';
    const abilityIncrease = EPIC_BOONS[name] ? 'any' : general ? general.abilityIncrease : null;
    return { name, kind, abilityIncrease, unavailable: featIneligibility(name, context) };
  });
}

// Everything the player can choose for their next level.
function getLevelUpOptions(state) {
  const { classes, earnedLevel, species, sheetData } = state;
  const total = appliedLevel(classes);
  const pendingLevels = Math.max(0, earnedLevel - total);
  if (pendingLevels === 0) return { pendingLevels: 0, currentLevel: total, options: [], unavailable: [] };

  const scores = readScores(sheetData);
  const feats = collectCharacterFeats(sheetData);
  const options = [];
  const unavailable = [];
  for (const className of Object.keys(ALL_CLASSES)) {
    let plan;
    try {
      plan = planLevelUp({ classes, scores, newClass: className, species, feats });
    } catch (error) {
      unavailable.push({ className, reason: error.message });
      continue;
    }
    const nextContext = { classes: plan.classes, sheetData, scores, totalLevel: plan.totalLevel };
    const needsImprovement = plan.choices.includes('abilityScoreImprovementOrFeat') || plan.choices.includes('epicBoon');
    options.push({
      className,
      classLevel: plan.classLevel,
      isNewClass: plan.isNewClass,
      totalLevel: plan.totalLevel,
      proficiencyBonus: plan.proficiencyBonus,
      hpGain: plan.hpGain,
      features: plan.features,
      choices: plan.choices,
      spells: plan.spells,
      spellSlots: plan.spellSlots,
      subclassOptions: plan.choices.includes('subclass') ? DND_CLASSES_AND_SUBCLASSES[className] : null,
      multiclassProficiencies: plan.multiclassProficiencies,
      classSkillOptions: getClass(className).skillChoices.options === 'any' ? SKILL_NAMES : getClass(className).skillChoices.options,
      feats: needsImprovement ? listFeats(nextContext, { allowBoons: plan.choices.includes('epicBoon') }) : null
    });
  }
  return { pendingLevels, currentLevel: total, scores, knownSkills: sheetData.skillProficiencies || [], options, unavailable };
}

function pickList(label, picks, count, allowed) {
  const values = Array.isArray(picks) ? picks : [];
  if (values.length !== count) throw new Error(`Choose exactly ${count} ${label}.`);
  if (new Set(values).size !== values.length) throw new Error(`${label} choices must be different.`);
  const invalid = values.find(value => !allowed.includes(value));
  if (invalid !== undefined) throw new Error(`"${invalid}" is not a valid choice for ${label}.`);
  return values;
}

// improvement: { type: 'asi', increases: { str: 2 } | { str: 1, dex: 1 } }
//            | { type: 'feat', name, ability, ...origin feat choices }
// Returns { increases, feat, addedSkills, addedSaves, addedTools }.
function resolveImprovement(improvement, context, { allowBoons }) {
  const request = improvement && typeof improvement === 'object' ? improvement : {};
  const { scores } = context;
  const result = { increases: {}, feat: null, addedSkills: [], addedSaves: [], addedTools: [] };

  if (request.type === 'asi') {
    const increases = request.increases && typeof request.increases === 'object' ? request.increases : {};
    const entries = Object.entries(increases).filter(([, value]) => value);
    const values = entries.map(([, value]) => value).sort().join(',');
    if (entries.some(([ability]) => !ABILITIES.includes(ability)) || !['2', '1,1'].includes(values)) {
      throw new Error('Ability Score Improvement is +2 to one ability or +1 to two abilities.');
    }
    for (const [ability, value] of entries) {
      if (scores[ability] + value > STANDARD_SCORE_CAP) {
        throw new Error(`${ability.toUpperCase()} cannot go above ${STANDARD_SCORE_CAP}.`);
      }
    }
    result.increases = Object.fromEntries(entries);
    result.feat = { name: 'Ability Score Improvement', increases: result.increases };
    return result;
  }

  if (request.type !== 'feat') throw new Error('Choose an Ability Score Improvement or a feat.');
  const name = request.name;
  if (EPIC_BOONS[name] && !allowBoons) throw new Error('Epic Boons can only be taken with the Epic Boon feature.');
  const reason = featIneligibility(name, context);
  if (reason) throw new Error(`${name || 'That feat'}: ${reason}`);

  const general = GENERAL_FEATS[name];
  const isBoon = Boolean(EPIC_BOONS[name]);
  const allowedIncrease = isBoon ? ABILITIES : general && general.abilityIncrease === 'any' ? ABILITIES : general ? general.abilityIncrease : null;
  const feat = { name };
  if (allowedIncrease) {
    if (!allowedIncrease.includes(request.ability)) {
      throw new Error(`Choose which ability ${name} increases: ${allowedIncrease.map(a => a.toUpperCase()).join(', ')}.`);
    }
    const cap = isBoon ? EPIC_BOON_SCORE_CAP : STANDARD_SCORE_CAP;
    if (scores[request.ability] + 1 > cap) throw new Error(`${request.ability.toUpperCase()} cannot go above ${cap}.`);
    result.increases = { [request.ability]: 1 };
    feat.ability = request.ability;
  }

  const grants = featGrants(name);
  const proficientSkills = new Set(context.sheetData.skillProficiencies || []);
  const proficientTools = new Set(context.sheetData.toolProficiencies || []);
  if (grants.saveFromIncrease) {
    if ((context.sheetData.savingProficiencies || []).includes(request.ability)) {
      throw new Error(`You already have ${request.ability.toUpperCase()} saving throw proficiency; choose another ability for ${name}.`);
    }
    result.addedSaves = [request.ability];
  }
  if (grants.skillChoices) {
    const skills = pickList(`skill for ${name}`, request.skills, grants.skillChoices, SKILL_NAMES.filter(skill => !proficientSkills.has(skill)));
    result.addedSkills = skills;
    feat.skills = skills;
  }
  // Origin feats taken at a level-up use the same choices as at creation.
  if (ORIGIN_FEATS[name]) {
    const origin = ORIGIN_FEATS[name];
    if (origin.grants.spells) {
      if (!origin.spellLists.includes(request.spellList)) throw new Error(`Choose a spell list for ${name}.`);
      const owned = collectCharacterFeats(context.sheetData).filter(item => featName(item) === name);
      if (owned.some(item => item.spellList === request.spellList)) throw new Error(`${name} needs a different spell list each time.`);
      if (!['int', 'wis', 'cha'].includes(request.spellAbility)) throw new Error(`Choose a spellcasting ability for ${name}.`);
      feat.spellList = request.spellList;
      feat.spellAbility = request.spellAbility;
    }
    if (origin.grants.toolChoices) {
      const { count, category } = origin.grants.toolChoices;
      feat.tools = pickList(`tools for ${name}`, request.picks, count, TOOL_CATEGORIES[category].filter(tool => !proficientTools.has(tool)));
      result.addedTools = feat.tools;
    }
    if (origin.grants.skillOrToolChoices) {
      const allowed = [...SKILL_NAMES.filter(s => !proficientSkills.has(s)), ...TOOL_CATEGORIES.any.filter(t => !proficientTools.has(t))];
      const picks = pickList(`skills or tools for ${name}`, request.picks, origin.grants.skillOrToolChoices, allowed);
      result.addedSkills = picks.filter(pick => SKILL_NAMES.includes(pick));
      result.addedTools = picks.filter(pick => !SKILL_NAMES.includes(pick));
      feat.picks = picks;
    }
  }
  result.feat = feat;
  return result;
}

function hpMaxFor(classes, sheetData, species) {
  return calculateMaxHp({
    classes,
    constitution: readScores(sheetData).con,
    species,
    feats: collectCharacterFeats(sheetData)
  }).max;
}

// Applies one level. request: { className, subclass, improvement, multiclassSkills, multiclassTools }.
// Returns { classes, sheetData, entry }.
function applyLevelUp(state, request) {
  const { classes, earnedLevel, species } = state;
  const sheetData = state.sheetData || {};
  const body = request && typeof request === 'object' ? request : {};
  if (appliedLevel(classes) >= earnedLevel) throw new Error('No level-up available yet.');

  const scores = readScores(sheetData);
  const plan = planLevelUp({ classes, scores, newClass: body.className, species, feats: collectCharacterFeats(sheetData) });
  const entry = {
    level: plan.totalLevel,
    className: plan.className,
    classLevel: plan.classLevel,
    features: plan.features,
    increases: {},
    addedSkills: [],
    addedSaves: [],
    addedTools: [],
    spells: { cantripsGained: plan.spells.cantripsGained, preparedGained: plan.spells.preparedGained }
  };

  let nextClasses = plan.classes;
  if (plan.choices.includes('subclass')) {
    const options = DND_CLASSES_AND_SUBCLASSES[plan.className] || [];
    if (!options.includes(body.subclass)) throw new Error(`Choose a ${plan.className} subclass.`);
    entry.subclass = body.subclass;
    nextClasses = nextClasses.map(row => (row.className === plan.className ? { ...row, subclassName: body.subclass } : row));
    // Subclasses like Eldritch Knight grant spellcasting, so recount with the subclass.
    const after = getSpellsKnown(plan.className, body.subclass, plan.classLevel);
    const before = getSpellsKnown(plan.className, body.subclass, plan.classLevel - 1);
    entry.spells = {
      cantripsGained: after.cantrips - before.cantrips,
      preparedGained: after.prepared - before.prepared
    };
  }

  if (plan.multiclassProficiencies) {
    const gains = plan.multiclassProficiencies;
    entry.addedArmor = gains.armor || [];
    entry.addedWeapons = gains.weapons || [];
    entry.addedTools.push(...(gains.tools || []));
    if (gains.skillChoices) {
      const known = new Set(sheetData.skillProficiencies || []);
      const pool = gains.skillChoices.options === 'class' ? getClass(plan.className).skillChoices.options : SKILL_NAMES;
      entry.addedSkills.push(...pickList(`${plan.className} skill`, body.multiclassSkills, gains.skillChoices.count, pool.filter(s => !known.has(s))));
    }
    if (gains.toolChoices) {
      const known = new Set(sheetData.toolProficiencies || []);
      entry.addedTools.push(...pickList(`${plan.className} tool`, body.multiclassTools, gains.toolChoices.count,
        TOOL_CATEGORIES[gains.toolChoices.category].filter(t => !known.has(t))));
    }
  }

  const needsImprovement = plan.choices.includes('abilityScoreImprovementOrFeat') || plan.choices.includes('epicBoon');
  if (needsImprovement) {
    const resolved = resolveImprovement(body.improvement, {
      classes: nextClasses, sheetData, scores, totalLevel: plan.totalLevel
    }, { allowBoons: plan.choices.includes('epicBoon') });
    entry.increases = resolved.increases;
    entry.feat = resolved.feat;
    entry.addedSkills.push(...resolved.addedSkills);
    entry.addedSaves.push(...resolved.addedSaves);
    entry.addedTools.push(...resolved.addedTools);
    entry.addedArmor = [...(entry.addedArmor || []), ...((featGrants(resolved.feat).armorTraining) || [])];
    entry.addedWeapons = [...(entry.addedWeapons || []), ...((featGrants(resolved.feat).weaponProficiencies) || [])];
  }

  const nextScores = { ...scores };
  Object.entries(entry.increases).forEach(([ability, value]) => { nextScores[ability] += value; });
  const union = (list, added) => [...new Set([...(list || []), ...(added || [])])];
  const pending = sheetData.pendingChoices || {};
  const nextSheet = {
    ...sheetData,
    abilities: writeScores(sheetData, nextScores),
    skillProficiencies: union(sheetData.skillProficiencies, entry.addedSkills),
    savingProficiencies: union(sheetData.savingProficiencies, entry.addedSaves),
    toolProficiencies: union(sheetData.toolProficiencies, entry.addedTools),
    armorTraining: union(sheetData.armorTraining, entry.addedArmor),
    weaponProficiencies: union(sheetData.weaponProficiencies, entry.addedWeapons),
    classFeatures: [
      ...(sheetData.classFeatures || []),
      ...entry.features
        .filter(feature => feature !== `${plan.className} Subclass`)
        .map(feature => ({ name: feature, level: plan.classLevel, source: plan.className, gainedAt: plan.totalLevel }))
    ],
    pendingChoices: {
      ...pending,
      cantrips: (pending.cantrips || 0) + Math.max(0, entry.spells.cantripsGained),
      preparedSpells: (pending.preparedSpells || 0) + Math.max(0, entry.spells.preparedGained)
    },
    levelHistory: [...(sheetData.levelHistory || []), entry]
  };

  // Current HP rises by however much the maximum rose (CON or Tough can add retroactively).
  const before = hpMaxFor(classes, sheetData, species);
  const after = hpMaxFor(nextClasses, nextSheet, species);
  entry.hpGain = after - before;
  if (Number.isInteger(nextSheet.hpCurrent)) nextSheet.hpCurrent += Math.max(0, entry.hpGain);
  nextSheet.hitDice = formatHitDicePool(getHitDicePool(nextClasses));
  nextSheet.spellSlots = getSpellSlots(nextClasses);

  return { classes: nextClasses, sheetData: nextSheet, entry };
}

// Undoes the most recent recorded level. Returns null when there is no history.
function revertLastLevel(state) {
  const sheetData = state.sheetData || {};
  const history = sheetData.levelHistory || [];
  if (history.length === 0) return null;
  const entry = history[history.length - 1];

  const classes = state.classes
    .map(row => (row.className === entry.className
      ? { ...row, level: row.level - 1, subclassName: entry.subclass ? null : row.subclassName }
      : row))
    .filter(row => row.level > 0);

  const scores = readScores(sheetData);
  Object.entries(entry.increases || {}).forEach(([ability, value]) => { scores[ability] -= value; });
  const without = (list, removed) => (list || []).filter(item => !(removed || []).includes(item));
  const pending = sheetData.pendingChoices || {};
  const spells = entry.spells || {};
  return {
    classes,
    entry,
    sheetData: {
      ...sheetData,
      abilities: writeScores(sheetData, scores),
      skillProficiencies: without(sheetData.skillProficiencies, entry.addedSkills),
      savingProficiencies: without(sheetData.savingProficiencies, entry.addedSaves),
      toolProficiencies: without(sheetData.toolProficiencies, entry.addedTools),
      armorTraining: without(sheetData.armorTraining, entry.addedArmor),
      weaponProficiencies: without(sheetData.weaponProficiencies, entry.addedWeapons),
      classFeatures: (sheetData.classFeatures || []).filter(feature => feature.gainedAt !== entry.level),
      pendingChoices: {
        ...pending,
        cantrips: Math.max(0, (pending.cantrips || 0) - Math.max(0, spells.cantripsGained || 0)),
        preparedSpells: Math.max(0, (pending.preparedSpells || 0) - Math.max(0, spells.preparedGained || 0))
      },
      hitDice: formatHitDicePool(getHitDicePool(classes)),
      spellSlots: getSpellSlots(classes),
      levelHistory: history.slice(0, -1)
    }
  };
}

module.exports = {
  collectCharacterFeats,
  getLevelUpOptions,
  applyLevelUp,
  revertLastLevel
};
