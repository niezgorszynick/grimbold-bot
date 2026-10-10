// rules/spellbook.js — Choosing, preparing and casting spells (2024 PHB).
//
// Spell sources a character can have:
//   class     — each class (or Eldritch Knight / Arcane Trickster subclass) with
//               Spellcasting or Pact Magic: cantrips and prepared spells within
//               the class tables; Wizards prepare from their spellbook.
//   feat      — Magic Initiate: two cantrips and one level 1 spell from its list,
//               the level 1 spell castable once per Long Rest without a slot.
//   species   — lineage/legacy spells, always prepared, unlocked by character
//               level, each castable once per Long Rest without a slot.
//
// When spells can change (campaign uses the strict 2024 rules):
//   Cleric, Druid, Wizard, Artificer — any changes after a Long Rest, until a
//     leveled spell is next cast.
//   Paladin, Ranger — one spell after a Long Rest.
//   Bard, Sorcerer, Warlock, Eldritch Knight, Arcane Trickster — one spell when
//     gaining a level in that class.
//   Cantrips — one when gaining a level in that class.
//   Magic Initiate — one spell when gaining any level.
// Filling empty slots (new spells from a level-up) is always allowed.
//
// State lives in sheet_data.spellcasting:
//   { classes: { Wizard: { cantrips, prepared, spellbook: [{ name, source }] } },
//     feats: { 'Magic Initiate (Wizard)': { cantrips, spells } },
//     changes: { Wizard: { rework, swaps, cantripSwaps } },
//     concentration: { spell, source } | null, freeCastsUsed: { key: count } }

const { atLevel, abilityModifier, proficiencyBonus } = require('./util');
const { getClass, SUBCLASS_SPELLCASTING } = require('./classes');
const { getSpellSlots } = require('./spellcasting');
const { getSpellCatalog, findSpell, spellListName } = require('./spells');
const { collectCharacterFeats, featName, featGrants } = require('./feats');
const {
  INVOCATIONS, INVOCATION_NAMES, invocationLimit, readInvocations, eligibleCantrips,
  invocationIneligibility, validateInvocations
} = require('./invocations');

// Key in spellcasting.changes for the Warlock's invocation replacements.
const INVOCATION_CHANGE_KEY = 'Eldritch Invocations';

const CHANGE_RULES = {
  Cleric: 'longRestAll', Druid: 'longRestAll', Wizard: 'longRestAll', Artificer: 'longRestAll',
  Paladin: 'longRestOne', Ranger: 'longRestOne',
  Bard: 'levelUpOne', Sorcerer: 'levelUpOne', Warlock: 'levelUpOne',
  'Eldritch Knight': 'levelUpOne', 'Arcane Trickster': 'levelUpOne'
};
const WIZARD_STARTING_SPELLBOOK = 6;
const WIZARD_SPELLS_PER_LEVEL = 2;
const COPY_COST_GP_PER_LEVEL = 50;

// Species spells: [character level, spell]; level 1 entries are cantrips.
const SPECIES_SPELLS = {
  Aasimar: { ability: 'cha', spells: [[1, 'Light']] },
  Tiefling: { ability: 'cha', spells: [[1, 'Thaumaturgy']] },
  'Elf:Drow': { spells: [[1, 'Dancing Lights'], [3, 'Faerie Fire'], [5, 'Darkness']] },
  'Elf:High Elf': { spells: [[1, 'Prestidigitation'], [3, 'Detect Magic'], [5, 'Misty Step']] },
  'Elf:Wood Elf': { spells: [[1, 'Druidcraft'], [3, 'Longstrider'], [5, 'Pass without Trace']] },
  'Gnome:Forest Gnome': { spells: [[1, 'Minor Illusion'], [1, 'Speak with Animals']], freeUses: 'proficiency' },
  'Gnome:Rock Gnome': { spells: [[1, 'Mending'], [1, 'Prestidigitation']] },
  'Tiefling:Abyssal': { spells: [[1, 'Poison Spray'], [3, 'Ray of Sickness'], [5, 'Hold Person']] },
  'Tiefling:Chthonic': { spells: [[1, 'Chill Touch'], [3, 'False Life'], [5, 'Ray of Enfeeblement']] },
  'Tiefling:Infernal': { spells: [[1, 'Fire Bolt'], [3, 'Hellish Rebuke'], [5, 'Darkness']] }
};

const emptyState = () => ({ classes: {}, feats: {}, changes: {}, concentration: null, freeCastsUsed: {} });

function readSpellcasting(sheetData) {
  const stored = (sheetData && sheetData.spellcasting) || {};
  return { ...emptyState(), ...stored };
}

function scoreOf(sheetData, ability) {
  const value = ((sheetData || {}).abilities || {})[ability];
  const score = value && typeof value === 'object' ? (value.score ?? value.total) : value;
  return Number.isInteger(score) ? score : 10;
}

// Highest spell level a class can prepare: its own table at its own level.
function maxSpellLevelFor(spellcasting, classLevel) {
  if (spellcasting.progression === 'pact') {
    const slots = getSpellSlots([{ className: 'Warlock', level: classLevel }]);
    return slots.pact ? slots.pact.slotLevel : 0;
  }
  const casterLevel = spellcasting.progression === 'full' ? classLevel
    : spellcasting.progression === 'half' ? Math.ceil(classLevel / 2)
      : classLevel >= 3 ? Math.ceil(classLevel / 3) : 0;
  return getSpellSlots([{ className: 'Wizard', level: casterLevel }]).slots.length;
}

// Every spell source the character has, with its limits.
// character: { classes: [{ className, subclassName, level }], species, sheetData, totalLevel }
function getSpellSources(character) {
  const { classes, sheetData = {} } = character;
  const totalLevel = character.totalLevel || classes.reduce((sum, row) => sum + row.level, 0);
  const pb = proficiencyBonus(Math.max(1, totalLevel));
  const sources = [];

  for (const row of classes) {
    const classData = getClass(row.className);
    const spellcasting = (classData && classData.spellcasting) || SUBCLASS_SPELLCASTING[row.subclassName];
    if (!spellcasting) continue;
    const ruleKey = classData && classData.spellcasting ? row.className : row.subclassName;
    const mod = abilityModifier(scoreOf(sheetData, spellcasting.ability));
    sources.push({
      kind: 'class',
      key: row.className,
      label: classData && classData.spellcasting ? row.className : `${row.className} (${row.subclassName})`,
      list: spellListName(row.className, row.subclassName),
      ability: spellcasting.ability,
      saveDc: 8 + pb + mod,
      attackBonus: pb + mod,
      cantripLimit: atLevel(spellcasting.cantrips, row.level),
      preparedLimit: atLevel(spellcasting.prepared, row.level),
      maxSpellLevel: maxSpellLevelFor(spellcasting, row.level),
      changeRule: CHANGE_RULES[ruleKey] || 'longRestAll',
      spellbook: row.className === 'Wizard'
        ? { freeLimit: WIZARD_STARTING_SPELLBOOK + WIZARD_SPELLS_PER_LEVEL * (row.level - 1) }
        : null,
      classLevel: row.level
    });
  }

  const castingNumbers = ability => {
    const mod = abilityModifier(scoreOf(sheetData, ability));
    return { ability, saveDc: 8 + pb + mod, attackBonus: pb + mod };
  };

  for (const feat of collectCharacterFeats(sheetData)) {
    const name = featName(feat);
    if (name === 'Magic Initiate' && feat.spellList) {
      sources.push({
        kind: 'feat',
        key: `Magic Initiate (${feat.spellList})`,
        label: `Magic Initiate (${feat.spellList})`,
        list: feat.spellList,
        ...castingNumbers(feat.spellAbility || 'int'),
        cantripLimit: 2,
        preparedLimit: 1,
        maxSpellLevel: 1,
        minSpellLevel: 1,
        changeRule: 'featLevelUp',
        freeUses: 1
      });
      continue;
    }
    // Fey-Touched, Shadow-Touched, Telepathic, Telekinetic, Ritual Caster.
    const spells = featGrants(feat).spells;
    if (!spells || sources.some(source => source.key === name)) continue;
    const choose = spells.choose || null;
    sources.push({
      kind: 'feat',
      key: name,
      label: name,
      list: 'any',
      filter: choose ? { schools: choose.schools || null, ritual: Boolean(choose.ritual) } : null,
      ...castingNumbers(feat.ability || 'int'),
      alwaysPrepared: [...(spells.cantrips || []), ...(spells.fixed || [])],
      cantripLimit: 0,
      preparedLimit: choose ? (choose.count === 'proficiency' ? pb : choose.count) : 0,
      maxSpellLevel: choose ? choose.level : 0,
      minSpellLevel: choose ? choose.level : 0,
      changeRule: 'never',
      freeEach: spells.freeEach || 0
    });
  }

  // Warlock invocations: spells cast without a slot, and the Book of Shadows.
  const invocations = readInvocations(sheetData);
  if (invocations.length) {
    const freeUsesBySpell = {};
    for (const entry of invocations) {
      Object.assign(freeUsesBySpell, (INVOCATIONS[entry.name] || {}).spells || {});
    }
    if (Object.keys(freeUsesBySpell).length) {
      sources.push({
        kind: 'invocation',
        key: 'Invocation Spells',
        label: 'Invocation Spells',
        ...castingNumbers('cha'),
        alwaysPrepared: Object.keys(freeUsesBySpell),
        freeUsesBySpell,
        slotless: true
      });
    }
    const tome = invocations.some(entry => entry.name === 'Pact of the Tome') && INVOCATIONS['Pact of the Tome'].tome;
    if (tome) {
      sources.push({
        kind: 'tome',
        key: 'Pact of the Tome',
        label: 'Pact of the Tome (Book of Shadows)',
        list: 'any',
        filter: { ritual: true },
        ...castingNumbers('cha'),
        cantripLimit: tome.cantrips,
        preparedLimit: tome.rituals,
        maxSpellLevel: 1,
        minSpellLevel: 1,
        changeRule: 'restAll'
      });
    }
  }

  const speciesKey = sheetData.speciesOption ? `${character.species}:${sheetData.speciesOption}` : null;
  for (const key of [character.species, speciesKey]) {
    const data = key && SPECIES_SPELLS[key];
    if (!data) continue;
    const ability = data.ability || sheetData.speciesSpellAbility || 'cha';
    const mod = abilityModifier(scoreOf(sheetData, ability));
    sources.push({
      kind: 'species',
      key,
      label: key.replace(':', ' — '),
      ability,
      saveDc: 8 + pb + mod,
      attackBonus: pb + mod,
      alwaysPrepared: data.spells.filter(([level]) => totalLevel >= level).map(([, spell]) => spell),
      freeUses: data.freeUses === 'proficiency' ? pb : 1
    });
  }
  return sources;
}

// What the player chose for a source (fixed spells excluded).
function chosenOf(state, source) {
  if (source.kind === 'class') {
    const entry = state.classes[source.key] || {};
    return { cantrips: entry.cantrips || [], prepared: entry.prepared || [], spellbook: entry.spellbook || [] };
  }
  if (source.kind === 'feat' || source.kind === 'tome') {
    const entry = state.feats[source.key] || {};
    return { cantrips: entry.cantrips || [], prepared: entry.spells || [], spellbook: [] };
  }
  return { cantrips: [], prepared: [], spellbook: [] };
}

// Everything a source lets the character cast: fixed spells plus choices.
function listOf(state, source) {
  const chosen = chosenOf(state, source);
  const catalog = getSpellCatalog();
  const always = source.alwaysPrepared || [];
  const isCantrip = name => (findSpell(name, catalog) || {}).level === 0;
  return {
    cantrips: [...always.filter(isCantrip), ...chosen.cantrips],
    prepared: [...always.filter(name => !isCantrip(name)), ...chosen.prepared],
    spellbook: chosen.spellbook
  };
}

// Uses of casting a spell from this source without a slot ('atWill' = unlimited).
function freeUsesFor(source, spellName) {
  if (source.freeUsesBySpell && source.freeUsesBySpell[spellName] !== undefined) return source.freeUsesBySpell[spellName];
  return source.freeEach || source.freeUses || 0;
}

function unique(list, label) {
  if (new Set(list).size !== list.length) throw new Error(`${label} contains the same spell twice.`);
}

// Checks a spell belongs to the source's list and fits its level range.
function requireSpell(name, source, { cantrip }, catalog) {
  const spell = findSpell(name, catalog);
  if (!spell) throw new Error(`Unknown spell "${name}".`);
  // 'any' means any class's spell list (feats, Pact of the Tome).
  if (source.list !== 'any' && !spell.classes.includes(source.list)) {
    throw new Error(`${spell.name} is not on the ${source.list} spell list.`);
  }
  if (cantrip && spell.level !== 0) throw new Error(`${spell.name} is not a cantrip.`);
  const filter = source.filter || {};
  if (!cantrip && filter.ritual && !spell.ritual) throw new Error(`${spell.name} doesn't have the Ritual tag.`);
  if (!cantrip && filter.schools && !filter.schools.includes(spell.school)) {
    throw new Error(`${spell.name} must be from the ${filter.schools.join(' or ')} school.`);
  }
  if (!cantrip) {
    if (spell.level === 0) throw new Error(`${spell.name} is a cantrip.`);
    if (spell.level > source.maxSpellLevel) {
      throw new Error(`${spell.name} is level ${spell.level}; ${source.label} can prepare up to level ${source.maxSpellLevel}.`);
    }
  }
  return spell.name;
}

// How many existing choices may be replaced right now.
function allowanceFor(state, source) {
  const changes = state.changes[source.key] || {};
  return {
    rework: Boolean(changes.rework),
    swaps: changes.swaps || 0,
    cantripSwaps: changes.cantripSwaps || 0
  };
}

// Applies a new choice of cantrips / prepared spells (and, for Wizards, new
// spellbook spells) for one source. Returns the next spellcasting state and,
// for copied spellbook spells, the gold cost in GP.
function chooseSpells(state, source, request, catalog = getSpellCatalog()) {
  if (source.kind === 'species' || source.kind === 'invocation') throw new Error(`${source.label} spells are fixed.`);
  if (!source.cantripLimit && !source.preparedLimit) throw new Error(`${source.label} has no spells to choose.`);
  const current = chosenOf(state, source);
  const body = request || {};
  const cantrips = Array.isArray(body.cantrips) ? body.cantrips.map(name => requireSpell(name, source, { cantrip: true }, catalog)) : current.cantrips;
  let prepared = Array.isArray(body.prepared) ? body.prepared.map(name => requireSpell(name, source, { cantrip: false }, catalog)) : current.prepared;
  unique(cantrips, 'Cantrips');
  unique(prepared, 'Prepared spells');
  if (source.minSpellLevel) {
    prepared.forEach(name => {
      if (findSpell(name, catalog).level !== source.minSpellLevel) throw new Error(`${name} must be a level ${source.minSpellLevel} spell.`);
    });
  }

  // Wizard spellbook: new spells are free up to the per-level allowance, then copied for gold.
  let spellbook = current.spellbook;
  let copyCostGp = 0;
  if (source.spellbook) {
    const additions = (Array.isArray(body.addToSpellbook) ? body.addToSpellbook : [])
      .map(name => requireSpell(name, source, { cantrip: false }, catalog));
    unique([...spellbook.map(entry => entry.name), ...additions], 'Spellbook');
    const freeUsed = spellbook.filter(entry => entry.source === 'level').length;
    let freeLeft = Math.max(0, source.spellbook.freeLimit - freeUsed);
    const copy = Boolean(body.copyAddedSpells);
    spellbook = [...spellbook, ...additions.map(name => {
      if (freeLeft > 0) {
        freeLeft -= 1;
        return { name, source: 'level' };
      }
      if (!copy) throw new Error(`No free spellbook spells left; ${name} must be copied (${COPY_COST_GP_PER_LEVEL} GP per spell level).`);
      copyCostGp += COPY_COST_GP_PER_LEVEL * findSpell(name, catalog).level;
      return { name, source: 'copied' };
    })];
    const inBook = new Set(spellbook.map(entry => entry.name));
    const missing = prepared.find(name => !inBook.has(name));
    if (missing) throw new Error(`${missing} is not in your spellbook.`);
  }

  if (cantrips.length > source.cantripLimit) {
    throw new Error(`${source.label} knows at most ${source.cantripLimit} cantrips.`);
  }
  if (prepared.length > source.preparedLimit) {
    throw new Error(`${source.label} can prepare at most ${source.preparedLimit} spells.`);
  }

  // Strict change rules: replacing or dropping existing choices needs an allowance.
  const allowance = allowanceFor(state, source);
  const removedCantrips = current.cantrips.filter(name => !cantrips.includes(name));
  const removedPrepared = current.prepared.filter(name => !prepared.includes(name));
  const overLimit = Math.max(0, current.prepared.length - source.preparedLimit);
  const changes = { ...(state.changes[source.key] || {}) };
  if (removedCantrips.length > allowance.cantripSwaps) {
    throw new Error(allowance.cantripSwaps
      ? `You can replace only ${allowance.cantripSwaps} cantrip(s) now.`
      : 'Cantrips can only be replaced when you gain a level in this class.');
  }
  if (removedCantrips.length) changes.cantripSwaps = allowance.cantripSwaps - removedCantrips.length;
  const removedCounted = Math.max(0, removedPrepared.length - overLimit);
  if (removedCounted > 0 && !allowance.rework) {
    if (removedCounted > allowance.swaps) {
      const when = {
        longRestAll: 'after a Long Rest',
        longRestOne: 'one spell after a Long Rest',
        levelUpOne: 'one spell when you gain a level in this class',
        featLevelUp: 'one spell when you gain a level',
        restAll: 'after a Short or Long Rest',
        never: 'never once chosen'
      }[source.changeRule];
      throw new Error(allowance.swaps
        ? `You can replace only ${allowance.swaps} spell(s) now.`
        : `${source.label} can change prepared spells ${when}.`);
    }
    changes.swaps = allowance.swaps - removedCounted;
  }

  const next = { ...state, changes: { ...state.changes, [source.key]: changes } };
  if (source.kind === 'class') {
    next.classes = { ...state.classes, [source.key]: { cantrips, prepared, ...(source.spellbook ? { spellbook } : {}) } };
  } else {
    next.feats = { ...state.feats, [source.key]: { cantrips, spells: prepared } };
  }
  return { state: next, copyCostGp };
}

// After a Long Rest: open the change windows and reset free casts.
function onLongRest(state, sources) {
  const changes = { ...state.changes };
  for (const source of sources) {
    if (source.changeRule === 'longRestAll' || source.changeRule === 'restAll') {
      changes[source.key] = { ...changes[source.key], rework: true };
    }
    if (source.changeRule === 'longRestOne') changes[source.key] = { ...changes[source.key], swaps: 1 };
  }
  return { ...state, changes, freeCastsUsed: {} };
}

// After a Short Rest: a new Book of Shadows (Pact of the Tome) may be conjured.
function onShortRest(state, sources) {
  const changes = { ...state.changes };
  for (const source of sources) {
    if (source.changeRule === 'restAll') changes[source.key] = { ...changes[source.key], rework: true };
  }
  return { ...state, changes };
}

// After gaining a level in className: one replacement where the class allows it,
// one cantrip replacement, one Magic Initiate replacement and, for Warlocks,
// one Eldritch Invocation replacement.
function onLevelUp(state, sources, className) {
  const changes = { ...state.changes };
  if (className === 'Warlock') {
    const entry = changes[INVOCATION_CHANGE_KEY] || {};
    changes[INVOCATION_CHANGE_KEY] = { ...entry, swaps: (entry.swaps || 0) + 1 };
  }
  for (const source of sources) {
    const entry = { ...changes[source.key] };
    if (source.kind === 'class' && source.key === className) {
      if (source.changeRule === 'levelUpOne') entry.swaps = (entry.swaps || 0) + 1;
      if (source.cantripLimit > 0) entry.cantripSwaps = (entry.cantripSwaps || 0) + 1;
    }
    if (source.changeRule === 'featLevelUp') {
      entry.swaps = (entry.swaps || 0) + 1;
      entry.cantripSwaps = (entry.cantripSwaps || 0) + 1;
    }
    changes[source.key] = entry;
  }
  return { ...state, changes };
}

// Trims choices that no longer fit after levels were removed.
function fitToLimits(state, sources, catalog = getSpellCatalog()) {
  const next = { ...state, classes: { ...state.classes }, feats: { ...state.feats } };
  for (const source of sources) {
    if (source.kind === 'species' || source.kind === 'invocation') continue;
    const current = chosenOf(next, source);
    const cantrips = current.cantrips.slice(0, source.cantripLimit);
    const prepared = current.prepared
      .filter(name => ((findSpell(name, catalog) || {}).level || 0) <= source.maxSpellLevel)
      .slice(0, source.preparedLimit);
    if (source.kind === 'class') next.classes[source.key] = { ...next.classes[source.key], cantrips, prepared };
    else next.feats[source.key] = { cantrips, spells: prepared };
  }
  for (const key of Object.keys(next.classes)) {
    if (!sources.some(source => source.kind === 'class' && source.key === key)) delete next.classes[key];
  }
  return next;
}

// Casting. how: { slotLevel } | { pact: true } | { free: true } | { ritual: true } (cantrips need none).
// Returns { state, slotChange: { level } | null, events }.
function castSpell(state, sources, { source: sourceKey, spell: spellName, slotLevel, pact, free, ritual }, catalog = getSpellCatalog()) {
  const source = sources.find(item => item.key === sourceKey);
  if (!source) throw new Error('Choose which of your spellcasting features casts this spell.');
  const spell = findSpell(spellName, catalog);
  if (!spell) throw new Error(`Unknown spell "${spellName}".`);
  const lists = listOf(state, source);
  const events = [];
  let slotChange = null;
  let nextState = { ...state };

  if (spell.level === 0) {
    if (!lists.cantrips.includes(spell.name)) throw new Error(`${spell.name} is not one of your ${source.label} cantrips.`);
  } else {
    const inBook = lists.spellbook.some(entry => entry.name === spell.name);
    const prepared = lists.prepared.includes(spell.name);
    if (ritual) {
      if (!spell.ritual) throw new Error(`${spell.name} doesn't have the Ritual tag.`);
      // Wizards can cast rituals straight from their spellbook (Ritual Adept).
      if (!prepared && !inBook) throw new Error(`${spell.name} must be prepared to cast it as a Ritual.`);
      events.push('ritual');
    } else {
      if (!prepared) throw new Error(`${spell.name} isn't prepared.`);
      if (source.slotless && !free) throw new Error(`${spell.name} from ${source.label} is cast without a spell slot.`);
      if (free) {
        const uses = freeUsesFor(source, spell.name);
        if (!uses) throw new Error(`${source.label} has no free castings of ${spell.name}.`);
        const key = `${source.key}:${spell.name}`;
        const used = state.freeCastsUsed[key] || 0;
        if (uses !== 'atWill' && used >= uses) throw new Error(`You've used the free casting of ${spell.name}; it returns after a Long Rest.`);
        if (uses !== 'atWill') nextState.freeCastsUsed = { ...state.freeCastsUsed, [key]: used + 1 };
        events.push(uses === 'atWill' ? 'atWill' : 'freeCast');
      } else if (pact) {
        slotChange = { level: 'pact' };
      } else {
        const level = Number(slotLevel);
        if (!Number.isInteger(level) || level < spell.level || level > 9) {
          throw new Error(`Cast ${spell.name} with a spell slot of level ${spell.level} or higher.`);
        }
        slotChange = { level };
      }
      // Casting a leveled spell closes a Long Rest change window.
      nextState.changes = Object.fromEntries(Object.entries(state.changes).map(([key, value]) => [key, { ...value, rework: false }]));
    }
  }

  if (spell.concentration) {
    if (state.concentration) events.push('concentrationReplaced');
    nextState.concentration = { spell: spell.name, source: source.key };
    events.push('concentrating');
  }
  return { state: nextState, slotChange, events, spell };
}

// Concentration after taking damage: DC max(10, half the damage) up to 30;
// dropping to 0 Hit Points ends it.
function concentrationAfterDamage(state, damage, { droppedToZero }) {
  if (!state.concentration || damage <= 0) return { state, check: null };
  if (droppedToZero) return { state: { ...state, concentration: null }, check: { ended: true, spell: state.concentration.spell } };
  return { state, check: { dc: Math.min(30, Math.max(10, Math.floor(damage / 2))), spell: state.concentration.spell } };
}

const CHANGE_RULE_TEXT = {
  longRestAll: 'Change any prepared spells after a Long Rest (until you next cast a leveled spell).',
  longRestOne: 'Replace one prepared spell after a Long Rest.',
  levelUpOne: 'Replace one spell when you gain a level in this class.',
  featLevelUp: 'Replace one spell when you gain a level.',
  restAll: 'Choose new Book of Shadows spells after a Short or Long Rest.',
  never: 'Chosen once; the choice is permanent.'
};

// Invocation choices for a Warlock: limit, current picks and what qualifies.
function invocationsView(character, state) {
  const { classes, sheetData = {} } = character;
  const limit = invocationLimit(classes);
  if (!limit) return null;
  const chosen = readInvocations(sheetData);
  return {
    limit,
    chosen,
    allowance: allowanceFor(state, { key: INVOCATION_CHANGE_KEY }),
    options: INVOCATION_NAMES.map(name => ({
      name,
      repeatable: Boolean(INVOCATIONS[name].repeatable),
      cantrip: INVOCATIONS[name].cantrip || null,
      originFeat: Boolean(INVOCATIONS[name].originFeat),
      requires: INVOCATIONS[name].requires || [],
      // Prerequisite invocations are checked against the list being edited, client side.
      unavailable: invocationIneligibility(name, { classes, sheetData, chosen: INVOCATION_NAMES })
    })),
    cantripOptions: { damage: eligibleCantrips('damage', sheetData), attack: eligibleCantrips('attack', sheetData) }
  };
}

// What the sheet shows for each spell source.
function buildSpellsView(character, state) {
  const sources = getSpellSources(character);
  return {
    concentration: state.concentration,
    invocations: invocationsView(character, state),
    sources: sources.map(source => {
      const lists = listOf(state, source);
      const chosen = chosenOf(state, source);
      const freeLeft = {};
      for (const name of [...lists.cantrips, ...lists.prepared]) {
        const uses = freeUsesFor(source, name);
        if (!uses) continue;
        freeLeft[name] = uses === 'atWill' ? 'atWill' : Math.max(0, uses - (state.freeCastsUsed[`${source.key}:${name}`] || 0));
      }
      return {
        ...source,
        changeRuleText: CHANGE_RULE_TEXT[source.changeRule] || '',
        cantrips: lists.cantrips,
        prepared: lists.prepared,
        chosenCantrips: chosen.cantrips,
        chosenPrepared: chosen.prepared,
        spellbook: source.spellbook ? lists.spellbook : null,
        spellbookFreeLeft: source.spellbook
          ? Math.max(0, source.spellbook.freeLimit - lists.spellbook.filter(entry => entry.source === 'level').length)
          : 0,
        allowance: allowanceFor(state, source),
        freeLeft
      };
    })
  };
}

// Applies a new invocation list (see rules/invocations.js) to the sheet,
// enforcing the one-replacement-per-Warlock-level rule, and keeps the skills
// and tools granted by Lessons of the First Ones in step.
function chooseInvocations(character, choices, { resolveFeat }) {
  const sheetData = character.sheetData || {};
  const state = readSpellcasting(sheetData);
  const { invocations, removedCount } = validateInvocations(choices, { classes: character.classes, sheetData, resolveFeat });
  const allowance = allowanceFor(state, { key: INVOCATION_CHANGE_KEY });
  if (removedCount > allowance.swaps) {
    throw new Error(allowance.swaps
      ? `You can replace only ${allowance.swaps} invocation(s) now.`
      : 'Invocations can only be replaced when you gain a Warlock level.');
  }
  const without = (list, removed) => (list || []).filter(item => !removed.includes(item));
  const union = (list, added) => [...new Set([...(list || []), ...added])];
  const previous = readInvocations(sheetData);
  const oldSkills = previous.flatMap(entry => entry.addedSkills || []);
  const oldTools = previous.flatMap(entry => entry.addedTools || []);
  const newSkills = invocations.flatMap(entry => entry.addedSkills || []);
  const newTools = invocations.flatMap(entry => entry.addedTools || []);
  const changes = { ...state.changes, [INVOCATION_CHANGE_KEY]: { ...(state.changes[INVOCATION_CHANGE_KEY] || {}), swaps: allowance.swaps - removedCount } };
  return {
    ...sheetData,
    invocations,
    skillProficiencies: union(without(sheetData.skillProficiencies, oldSkills), newSkills),
    toolProficiencies: union(without(sheetData.toolProficiencies, oldTools), newTools),
    spellcasting: { ...state, changes }
  };
}

module.exports = {
  CHANGE_RULES,
  INVOCATION_CHANGE_KEY,
  buildSpellsView,
  chooseInvocations,
  SPECIES_SPELLS,
  COPY_COST_GP_PER_LEVEL,
  readSpellcasting,
  getSpellSources,
  listOf,
  chosenOf,
  freeUsesFor,
  allowanceFor,
  chooseSpells,
  onLongRest,
  onShortRest,
  onLevelUp,
  fitToLimits,
  castSpell,
  concentrationAfterDamage
};
