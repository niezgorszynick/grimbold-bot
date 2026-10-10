// rules/creation.js — Validates a character creation request and builds the
// starting character (2024 PHB order: class, origin, abilities, alignment/details).
//
// Every player choice is validated here so the HTTP layer stays thin. Throws an
// Error with a player-facing message on the first invalid choice.

const { ABILITIES, SKILL_NAMES, proficiencyBonus, findCanonical } = require('./util');
const { DND_SPECIES_DATA, DND_SPECIES, SPECIES_OPTIONS, sizeOptions } = require('./species');
const { DND_CLASSES_AND_SUBCLASSES } = require('./subclasses');
const { ALL_CLASSES } = require('./classes');
const { BACKGROUNDS } = require('./backgrounds');
const {
  ORIGIN_FEATS, ORIGIN_FEAT_NAMES, FIGHTING_STYLE_NAMES, featGrants, hasFightingStyleFeature
} = require('./feats');
const { TOOL_CATEGORIES, STANDARD_LANGUAGES, STARTING_LANGUAGE_CHOICES } = require('./equipment');
const { generateAbilityScores } = require('./abilities');
const { calculateMaxHp, getHitDicePool, formatHitDicePool } = require('./hitPoints');
const { getSpellSlots } = require('./spellcasting');
const { planStartingLevels } = require('./progression');
const { calculateArmorClass } = require('./armor');

// House rule: characters start at level 3.
const STARTING_LEVEL = 3;
const SPELL_ABILITIES = ['int', 'wis', 'cha'];

function validateCharacterOptions(species, className, subclass) {
  const canonicalSpecies = findCanonical(DND_SPECIES, species);
  if (!canonicalSpecies) {
    throw new Error(`Invalid species "${species}". Please select a canonical D&D 2024 species.`);
  }
  const canonicalClass = findCanonical(Object.keys(DND_CLASSES_AND_SUBCLASSES), className);
  if (!canonicalClass) {
    throw new Error(`Invalid class "${className}". Please select a canonical D&D 2024 class.`);
  }
  let canonicalSubclass = '';
  if (subclass && subclass.trim() !== '') {
    canonicalSubclass = findCanonical(DND_CLASSES_AND_SUBCLASSES[canonicalClass], subclass);
    if (!canonicalSubclass) {
      throw new Error(`Invalid subclass "${subclass}" for 2024 ${canonicalClass}.`);
    }
  }
  return { canonicalSpecies, canonicalClass, canonicalSubclass };
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function categoryOptions(category) {
  return [].concat(category).flatMap(key => TOOL_CATEGORIES[key] || []);
}

// Picks exactly `count` distinct values from `allowed`.
function pickFrom(label, picks, count, allowed) {
  const values = asList(picks);
  if (values.length !== count) throw new Error(`Choose exactly ${count} ${label}.`);
  if (new Set(values).size !== values.length) throw new Error(`${label} choices must be different.`);
  const invalid = values.find(value => !allowed.includes(value));
  if (invalid !== undefined) throw new Error(`"${invalid}" is not a valid choice for ${label}.`);
  return values;
}

// Tracks proficiencies so duplicates across sources are rejected.
function createProficiencyTracker() {
  const skills = new Map();
  const tools = new Map();
  return {
    skills,
    tools,
    addSkills(list, source, { allowDuplicates = false } = {}) {
      for (const skill of list) {
        if (skills.has(skill) && !allowDuplicates) {
          throw new Error(`You already have ${skill} from your ${skills.get(skill)}; choose a different skill.`);
        }
        if (!skills.has(skill)) skills.set(skill, source);
      }
    },
    addTools(list, source, { allowDuplicates = true } = {}) {
      for (const tool of list) {
        if (tools.has(tool) && !allowDuplicates) {
          throw new Error(`You already have ${tool} from your ${tools.get(tool)}; choose a different tool.`);
        }
        if (!tools.has(tool)) tools.set(tool, source);
      }
    }
  };
}

// Resolves one origin feat plus the player's choices for it.
function resolveOriginFeat(feat, choices, source, proficiencies) {
  const data = ORIGIN_FEATS[feat.name];
  if (!data) throw new Error(`"${feat.name}" is not an Origin feat.`);
  const resolved = { name: feat.name, source };
  const featChoices = choices && typeof choices === 'object' ? choices : {};

  if (data.grants.spells) {
    const spellList = feat.spellList || featChoices.spellList;
    if (!data.spellLists.includes(spellList)) {
      throw new Error(`Choose a spell list for ${feat.name}: ${data.spellLists.join(', ')}.`);
    }
    if (!SPELL_ABILITIES.includes(featChoices.spellAbility)) {
      throw new Error(`Choose Intelligence, Wisdom or Charisma as the spellcasting ability for ${feat.name}.`);
    }
    resolved.spellList = spellList;
    resolved.spellAbility = featChoices.spellAbility;
  }
  if (data.grants.toolChoices) {
    const { count, category } = data.grants.toolChoices;
    const tools = pickFrom(`tools for ${feat.name}`, featChoices.picks, count, categoryOptions(category));
    proficiencies.addTools(tools, `${feat.name} feat`, { allowDuplicates: false });
    resolved.tools = tools;
  }
  if (data.grants.skillOrToolChoices) {
    const allowed = [...SKILL_NAMES, ...TOOL_CATEGORIES.any];
    const picks = pickFrom(`skills or tools for ${feat.name}`, featChoices.picks, data.grants.skillOrToolChoices, allowed);
    const skills = picks.filter(pick => SKILL_NAMES.includes(pick));
    const tools = picks.filter(pick => !SKILL_NAMES.includes(pick));
    proficiencies.addSkills(skills, `${feat.name} feat`);
    proficiencies.addTools(tools, `${feat.name} feat`, { allowDuplicates: false });
    resolved.skills = skills;
    resolved.tools = tools;
  }
  return resolved;
}

// Turns an equipment package into inventory rows, resolving choice items.
function resolvePackage(pack, { toolChoice, equipmentChoices, source }) {
  return pack.items.map(item => {
    let name = item.name;
    if (item.fromToolChoice) {
      name = toolChoice || item.name;
    } else if (item.choose) {
      const chosen = equipmentChoices[item.choose];
      if (!categoryOptions(item.choose).includes(chosen)) {
        throw new Error(`Choose which ${item.name} your ${source} equipment includes.`);
      }
      name = chosen;
    }
    return { name, quantity: item.quantity, source };
  });
}

function mergeInventory(rows) {
  const merged = new Map();
  for (const row of rows) {
    const existing = merged.get(row.name);
    if (existing) existing.quantity += row.quantity;
    else merged.set(row.name, { ...row });
  }
  return [...merged.values()];
}

function formatInventory(inventory, gold) {
  const lines = inventory.map(item => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name));
  if (gold > 0) lines.push(`${gold} GP`);
  return lines.join('\n');
}

function buildStartingCharacter(input) {
  const request = input && typeof input === 'object' ? input : {};
  const name = typeof request.name === 'string' ? request.name.trim() : '';
  if (!name) throw new Error('Character name is required.');
  if (name.length > 100) throw new Error('Character name must be 100 characters or fewer.');

  // 1. Class
  const { canonicalSpecies: species, canonicalClass: className, canonicalSubclass: subclass } =
    validateCharacterOptions(request.species, request.className, request.subclass);
  if (!subclass) throw new Error(`Characters start at level ${STARTING_LEVEL}; choose a ${className} subclass.`);
  const classData = ALL_CLASSES[className];

  // 2. Origin: background
  const background = findCanonical(Object.keys(BACKGROUNDS), request.background);
  if (!background) throw new Error('Select a valid D&D 2024 background.');
  const backgroundData = BACKGROUNDS[background];

  // 2. Origin: species
  const speciesData = DND_SPECIES_DATA[species];
  const sizes = sizeOptions(species);
  const size = sizes.length === 1 ? sizes[0] : request.size;
  if (!sizes.includes(size)) throw new Error(`Choose a size for your ${species}: ${sizes.join(' or ')}.`);
  const speciesOptionRule = SPECIES_OPTIONS[species];
  let speciesOption = null;
  let speciesSpellAbility = null;
  if (speciesOptionRule) {
    if (!speciesOptionRule.options.includes(request.speciesOption)) {
      throw new Error(`Choose your ${speciesOptionRule.label}.`);
    }
    speciesOption = request.speciesOption;
    if (speciesOptionRule.spellAbilityChoice) {
      if (!SPELL_ABILITIES.includes(request.speciesSpellAbility)) {
        throw new Error(`Choose Intelligence, Wisdom or Charisma as the spellcasting ability for your ${speciesOptionRule.label}.`);
      }
      speciesSpellAbility = request.speciesSpellAbility;
    }
  }

  // 3. Ability scores (background bonus applies to every method)
  const abilities = generateAbilityScores({
    method: request.generationMethod,
    baseScores: request.baseScores,
    background,
    bonuses: request.backgroundBonuses
  });

  // Proficiencies: fixed grants first, then the player's picks.
  const proficiencies = createProficiencyTracker();
  proficiencies.addSkills(backgroundData.skillProficiencies, `${background} background`);
  proficiencies.addSkills(speciesData.skillProficiencies || [], `${species} traits`);

  let speciesSkills = [];
  if (speciesData.skillChoiceCount) {
    speciesSkills = pickFrom(
      `${species} skill`,
      request.speciesSkills,
      speciesData.skillChoiceCount,
      speciesData.skillChoiceOptions || SKILL_NAMES
    );
    proficiencies.addSkills(speciesSkills, `${species} traits`);
  }

  const classSkillOptions = classData.skillChoices.options === 'any' ? SKILL_NAMES : classData.skillChoices.options;
  const classSkills = pickFrom(`${className} skills`, request.classSkills, classData.skillChoices.count, classSkillOptions);
  proficiencies.addSkills(classSkills, `${className} class`);

  // Tools
  let backgroundTool = backgroundData.toolProficiency;
  if (typeof backgroundTool === 'object') {
    backgroundTool = pickFrom('background tool', [request.backgroundTool], 1, categoryOptions(backgroundTool.choose))[0];
  }
  proficiencies.addTools([backgroundTool], `${background} background`);
  proficiencies.addTools(classData.toolProficiencies.fixed || [], `${className} class`);
  let classTools = [];
  if (classData.toolProficiencies.choose) {
    const { count, category } = classData.toolProficiencies.choose;
    classTools = pickFrom(`${className} tools`, request.classTools, count, categoryOptions(category));
    proficiencies.addTools(classTools, `${className} class`, { allowDuplicates: false });
  }

  // Origin feats: the background's, plus one of choice for Humans (Versatile).
  const feats = [resolveOriginFeat(
    backgroundData.originFeat,
    request.originFeatChoices,
    `${background} background`,
    proficiencies
  )];
  if (species === 'Human') {
    const versatile = request.versatileFeat || {};
    const featName = findCanonical(ORIGIN_FEAT_NAMES, versatile.name);
    if (!featName) throw new Error('Humans gain an Origin feat of their choice (Versatile); choose one.');
    const duplicate = feats.find(feat => feat.name === featName);
    if (duplicate && !ORIGIN_FEATS[featName].repeatable) {
      throw new Error(`You already have ${featName} from your background; choose a different Origin feat.`);
    }
    const resolved = resolveOriginFeat({ name: featName }, versatile, 'Human (Versatile)', proficiencies);
    if (duplicate && resolved.spellList && resolved.spellList === duplicate.spellList) {
      throw new Error('Taking Magic Initiate twice requires a different spell list each time.');
    }
    feats.push(resolved);
  }

  // Fighters, Paladins and Rangers have the Fighting Style feature by level 3.
  const fightingStyles = [];
  if (hasFightingStyleFeature([{ className, level: STARTING_LEVEL }])) {
    if (!FIGHTING_STYLE_NAMES.includes(request.fightingStyle)) {
      throw new Error(`Choose a Fighting Style for your ${className}.`);
    }
    fightingStyles.push({ name: request.fightingStyle, source: className });
  }

  // Languages: Common plus two standard languages.
  const languages = pickFrom(
    'languages',
    request.languages,
    STARTING_LANGUAGE_CHOICES,
    STANDARD_LANGUAGES.filter(language => language !== 'Common')
  );

  // Starting equipment: class package and background package (or gold).
  const classOption = request.classEquipment;
  const backgroundOption = request.backgroundEquipment;
  if (!classData.startingEquipment[classOption]) {
    throw new Error(`Choose ${className} starting equipment: ${Object.keys(classData.startingEquipment).join(', ')}.`);
  }
  if (!backgroundData.equipmentOptions[backgroundOption]) {
    throw new Error('Choose background equipment A or 50 GP (B).');
  }
  const equipmentChoices = request.equipmentChoices && typeof request.equipmentChoices === 'object'
    ? request.equipmentChoices
    : {};
  const classPack = classData.startingEquipment[classOption];
  const backgroundPack = backgroundData.equipmentOptions[backgroundOption];
  const inventory = mergeInventory([
    ...resolvePackage(classPack, { toolChoice: classTools[0], equipmentChoices, source: 'class' }),
    ...resolvePackage(backgroundPack, { toolChoice: backgroundTool, equipmentChoices, source: 'background' })
  ]);
  const goldGp = classPack.gp + backgroundPack.gp;

  // Level 1 → STARTING_LEVEL progression.
  const { classes, steps } = planStartingLevels({
    className,
    subclassName: subclass,
    targetLevel: STARTING_LEVEL,
    scores: abilities.scores,
    species,
    feats
  });
  const hp = calculateMaxHp({ classes, constitution: abilities.scores.con, species, feats });
  const profBonus = proficiencyBonus(STARTING_LEVEL);
  const initiative = abilities.modifiers.dex + (feats.some(feat => feat.name === 'Alert') ? profBonus : 0);
  const armor = calculateArmorClass({
    itemNames: inventory.map(item => item.name),
    modifiers: abilities.modifiers,
    armorTraining: classData.armorTraining,
    classNames: [className],
    armoredBonus: fightingStyles.reduce((sum, style) => sum + (featGrants(style).armoredAcBonus || 0), 0)
  });

  const classFeatures = steps.flatMap(step =>
    step.features
      .filter(feature => feature !== `${className} Subclass`)
      .map(feature => ({ name: feature, level: step.classLevel, source: className }))
  );

  const sheetData = {
    generationMethod: abilities.method,
    baseScores: abilities.baseScores,
    backgroundBonuses: abilities.bonuses,
    abilities: Object.fromEntries(ABILITIES.map(ability => [
      ability,
      { score: abilities.scores[ability], modifier: abilities.modifiers[ability] }
    ])),
    background,
    size,
    speciesOption,
    speciesSpellAbility,
    // Copies, so a sheet never shares arrays with the rules data.
    savingProficiencies: [...classData.savingThrows],
    skillProficiencies: [...proficiencies.skills.keys()],
    classSkillChoices: classSkills,
    speciesSkillChoices: speciesSkills,
    toolProficiencies: [...proficiencies.tools.keys()],
    weaponProficiencies: [...classData.weaponProficiencies],
    armorTraining: [...classData.armorTraining],
    languages: ['Common', ...languages],
    originFeats: feats,
    fightingStyles,
    classFeatures,
    armorClass: armor.ac,
    armorClassSource: armor.source,
    initiative: `${initiative >= 0 ? '+' : ''}${initiative}`,
    speed: `${speciesData.speed} ft.`,
    hpMax: hp.max,
    hpCurrent: hp.max,
    hpTemp: 0,
    hpBreakdown: hp.breakdown,
    hitDice: formatHitDicePool(getHitDicePool(classes)),
    hitDiceSpent: {},
    spellSlots: getSpellSlots(classes),
    pendingChoices: {
      cantrips: steps.reduce((sum, step) => sum + step.spells.cantripsGained, 0),
      preparedSpells: steps.reduce((sum, step) => sum + step.spells.preparedGained, 0)
    },
    startingEquipment: { class: classOption, background: backgroundOption },
    inventory,
    equipmentText: formatInventory(inventory, goldGp),
    attacks: [],
    features: ''
  };

  return {
    name,
    species,
    className,
    subclass,
    level: STARTING_LEVEL,
    goldGp,
    classes,
    sheetData
  };
}

module.exports = { STARTING_LEVEL, validateCharacterOptions, buildStartingCharacter };
