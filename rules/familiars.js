// rules/familiars.js — Find Familiar (2024 PHB) on the character sheet: who
// has a familiar, which forms they may give it, and its stat block with what
// their feats and invocations add.
//
// A character has a familiar when they can cast Find Familiar: a prepared
// spell (or a Wizard's spellbook, for the ritual), Pact of the Chain,
// Familiar Friend (Arcana Unleashed), or a Druid's Wild Companion (level 2).
// The DM may also grant one to anyone (db/familiars.js keeps that).
//
// Forms: a CR 0 Beast from the monster catalog; Pact of the Chain adds the
// special forms (CHAIN_FORMS). The DM may allow any catalog statblock.
// The familiar is a Celestial, Fey or Fiend instead of a Beast (a Druid's
// Wild Companion is Fey) and can't attack, except with Pact of the Chain
// (its Reaction, when the warlock gives up an attack).
//
// Familiar Friend: +2 × character level HP. Elemental, Otherworldly and
// Soothing Familiar add their effects; Warlike Familiar its Intercept Attack
// (and the Battle Familiar spell, rules/bookFeats.js). Investment of the
// Chain Master: Fly or Swim 40 ft., Quick Attack, the warlock's save DC, and
// Necrotic or Radiant instead of weapon damage.

const { getMonster, listMonsters } = require('./monsters');
const { getSpellSources, listOf, readSpellcasting } = require('./spellbook');
const { collectCharacterFeats, featName } = require('./feats');
const { proficiencyBonus, abilityModifier } = require('./util');

const FAMILIAR_TYPES = ['Celestial', 'Fey', 'Fiend'];
// The forms the spell names; any other CR 0 Beast works too.
const NAMED_FORMS = ['Bat', 'Cat', 'Frog', 'Hawk', 'Lizard', 'Octopus', 'Owl', 'Rat', 'Raven', 'Spider', 'Weasel'];
const CHAIN_FORMS = ['Imp', 'Pseudodragon', 'Quasit', 'Skeleton', 'Slaad Tadpole', 'Sphinx of Wonder', 'Sprite', 'Venomous Snake'];
const ELEMENTAL_TYPES = ['Acid', 'Cold', 'Fire', 'Lightning', 'Thunder'];
const OTHERWORLDLY_TYPES = ['Necrotic', 'Poison', 'Psychic', 'Radiant', 'Thunder'];
const CHAIN_MASTER_MOVES = ['fly', 'swim'];
const FIND_FAMILIAR = 'Find Familiar';

const spellName = entry => (typeof entry === 'string' ? entry : entry && entry.name);

// The spell sources that let this character cast Find Familiar, best first:
// Familiar Friend (its chosen ability), then the rest as the sheet lists them.
function findFamiliarSources(character) {
  const sheetData = character.sheetData || {};
  const state = readSpellcasting(sheetData);
  let sources = [];
  try {
    sources = getSpellSources(character);
  } catch {
    return [];
  }
  const found = sources.filter(source => {
    const lists = listOf(state, source);
    // A Wizard casts it as a ritual straight from the spellbook.
    return [...lists.prepared, ...(lists.spellbook || [])].map(spellName).includes(FIND_FAMILIAR);
  });
  return found.sort((a, b) => (b.key === 'Familiar Friend') - (a.key === 'Familiar Friend'));
}

// What the character's familiar can be and gets. character: { classes,
// species, sheetData }; dmGranted: the DM gave them one. null when they have
// no way to have a familiar.
function familiarRules(character, { dmGranted = false } = {}) {
  const classes = character.classes || [];
  const sheetData = character.sheetData || {};
  const totalLevel = Math.max(1, classes.reduce((sum, row) => sum + row.level, 0));
  const pb = proficiencyBonus(totalLevel);
  const feats = new Set(collectCharacterFeats(sheetData).map(featName));
  const invocations = new Set((Array.isArray(sheetData.invocations) ? sheetData.invocations : []).map(entry => entry && entry.name).filter(Boolean));
  const druid = classes.find(row => row.className === 'Druid' && row.level >= 2);
  const warlock = classes.find(row => row.className === 'Warlock');
  const sources = findFamiliarSources(character);
  const chain = invocations.has('Pact of the Chain');
  const ways = [
    ...sources.map(source => source.key === 'Invocation Spells' ? 'Pact of the Chain' : source.label),
    druid ? 'Wild Companion (Druid)' : null,
    dmGranted ? 'granted by the DM' : null
  ].filter(Boolean);
  if (!ways.length) return null;

  // The spellcasting the familiar's features use (Energy Pulse's DC).
  const druidSource = druid ? (getSpellSourcesSafe(character).find(source => source.key === 'Druid') || null) : null;
  const caster = sources[0] || druidSource || null;
  const chainMaster = chain && invocations.has('Investment of the Chain Master');
  const warlockSource = chainMaster ? getSpellSourcesSafe(character).find(source => source.key === 'Warlock') : null;
  return {
    ways: [...new Set(ways)],
    totalLevel,
    proficiencyBonus: pb,
    chain,
    chainMaster,
    // Cast only through Wild Companion: the familiar is Fey and leaves at a Long Rest.
    wildCompanionOnly: Boolean(druid) && !sources.length && !dmGranted,
    friend: feats.has('Familiar Friend'),
    elemental: feats.has('Elemental Familiar'),
    otherworldly: feats.has('Otherworldly Familiar'),
    soothing: feats.has('Soothing Familiar'),
    warlike: feats.has('Warlike Familiar'),
    bonusHp: feats.has('Familiar Friend') ? 2 * totalLevel : 0,
    spellcasting: caster ? { label: caster.key === 'Invocation Spells' ? 'Pact of the Chain' : caster.label, ability: caster.ability, saveDc: caster.saveDc, attackBonus: caster.attackBonus } : null,
    warlockSaveDc: warlockSource ? warlockSource.saveDc : null,
    warlockLevel: warlock ? warlock.level : 0
  };
}

function getSpellSourcesSafe(character) {
  try {
    return getSpellSources(character);
  } catch {
    return [];
  }
}

// Why this statblock can't be the familiar's form, or null if it can.
function familiarFormProblem(name, status, { anyForm = false } = {}) {
  const monster = getMonster(name);
  if (!monster) return `There is no "${name}" in the monster list.`;
  if (anyForm) return null;
  if (CHAIN_FORMS.includes(monster.name)) {
    return status.chain ? null : `${monster.name} is a special form for Pact of the Chain warlocks.`;
  }
  if (monster.type !== 'Beast' || monster.cr !== 0) return `${monster.name} is not a Beast of Challenge Rating 0.`;
  return null;
}

// The forms to choose from: the named ones first, then other CR 0 Beasts,
// then the Pact of the Chain forms; with anyForm, every catalog statblock.
function familiarForms(status, { anyForm = false } = {}) {
  const row = (monster, group) => ({ name: monster.name, crText: monster.crText, type: monster.type, size: monster.size, group });
  const all = listMonsters();
  const beasts = all.filter(monster => monster.type === 'Beast' && monster.cr === 0 && !CHAIN_FORMS.includes(monster.name));
  const forms = [
    ...beasts.filter(monster => NAMED_FORMS.includes(monster.name)).map(monster => row(monster, 'Find Familiar')),
    ...beasts.filter(monster => !NAMED_FORMS.includes(monster.name)).map(monster => row(monster, 'Other CR 0 Beasts')),
    ...(status.chain || anyForm ? all.filter(monster => CHAIN_FORMS.includes(monster.name)).map(monster => row(monster, 'Pact of the Chain')) : [])
  ];
  if (anyForm) {
    const taken = new Set(forms.map(form => form.name));
    forms.push(...all.filter(monster => !taken.has(monster.name)).map(monster => row(monster, 'Allowed by the DM')));
  }
  return forms;
}

// The choices the familiar's features need, cleaned: unknown values dropped.
function cleanFamiliarOptions(options, status) {
  const value = options && typeof options === 'object' ? options : {};
  return {
    elementalType: status && status.elemental && ELEMENTAL_TYPES.includes(value.elementalType) ? value.elementalType : null,
    otherworldlyType: status && status.otherworldly && OTHERWORLDLY_TYPES.includes(value.otherworldlyType) ? value.otherworldlyType : null,
    chainMasterMove: status && status.chainMaster && CHAIN_MASTER_MOVES.includes(value.chainMasterMove) ? value.chainMasterMove : null
  };
}

const feature = (name, text, extra = {}) => ({ name, text, ...extra });

// "20 ft., Fly 30 ft." with a Fly Speed of 40 → "20 ft., Fly 40 ft."; added if missing.
function withSpeed(speed, mode, feet) {
  const pattern = new RegExp(`\\b${mode} (\\d+) ft\\.`, 'i');
  const match = String(speed || '').match(pattern);
  if (!match) return `${speed}, ${mode} ${feet} ft.`;
  return Number(match[1]) >= feet ? speed : speed.replace(pattern, `${mode} ${feet} ft.`);
}
const listText = (...parts) => parts.filter(Boolean).join('; ');

// The familiar's stat block: the form's, as a Celestial, Fey or Fiend, with
// the extra Hit Points, resistances, speed and features from the character.
// familiar: { name, creatureType, options }. null if the form is missing.
function familiarBlock(formName, status, familiar = {}) {
  const monster = getMonster(formName);
  if (!monster) return null;
  // Wild Companion's familiar is always Fey.
  const creatureType = status && status.wildCompanionOnly ? 'Fey' : FAMILIAR_TYPES.includes(familiar.creatureType) ? familiar.creatureType : 'Fey';
  const options = cleanFamiliarOptions(familiar.options, status);
  const pb = status ? status.proficiencyBonus : 2;
  const baseHp = Number.isInteger(monster.hitPoints) ? monster.hitPoints : 1;
  const hpMax = Math.max(1, baseHp + (status ? status.bonusHp : 0));
  const traits = [...monster.traits];
  const bonusActions = [...monster.bonusActions];
  const reactions = [...monster.reactions];
  const resistances = [monster.resistances, options.elementalType, options.otherworldlyType].filter(Boolean);
  let speed = monster.speed;
  const notes = [];

  if (status && status.chainMaster) {
    if (options.chainMasterMove) speed = withSpeed(speed, options.chainMasterMove === 'fly' ? 'Fly' : 'Swim', 40);
    traits.push(feature('Investment of the Chain Master', listText(
      options.chainMasterMove ? null : 'Choose a Fly or Swim Speed of 40 ft. on the familiar card',
      'Quick Attack: as a Bonus Action you can command it to take the Attack action',
      'its Bludgeoning, Piercing or Slashing damage can be Necrotic or Radiant instead',
      status.warlockSaveDc ? `saving throws it forces use your spell save DC (${status.warlockSaveDc})` : 'saving throws it forces use your spell save DC',
      'when it takes damage, your Reaction can give it Resistance to that damage'
    ) + '.'));
  }
  if (options.elementalType || (status && status.elemental)) {
    const type = options.elementalType || 'the chosen type';
    const dc = status && status.spellcasting ? status.spellcasting.saveDc : null;
    reactions.push(feature('Energy Pulse (Elemental Familiar)',
      `When you command it (your Bonus Action, within 120 ft.), its Reaction: each creature in a 5-ft. Emanation makes a DEX save${dc ? ` (DC ${dc})` : ''} or takes 2d4 ${type} damage and, if Medium or smaller, falls Prone.`,
      { roll: { id: 'familiar:pulse', formula: '2d4', type: options.elementalType || 'Elemental' } }));
    if (!options.elementalType) notes.push('Elemental Familiar: choose its damage type on the familiar card.');
  }
  if (status && status.otherworldly) {
    traits.push(feature('Phase Walk (Otherworldly Familiar)', 'It can move through other creatures and objects as if they were Difficult Terrain. Ending its turn inside an object shunts it to the last unoccupied space it was in.'));
    if (!options.otherworldlyType) notes.push('Otherworldly Familiar: choose its resistance on the familiar card.');
  }
  if (status && status.soothing) {
    traits.push(feature('Healing Beacon (Soothing Familiar)', 'A 5-ft. Emanation from it, while within 120 ft. of you: an ally in it who rolls a die to restore Hit Points can treat a 1 or 2 on the die as a 3.'));
  }
  if (status && status.warlike) {
    reactions.push(feature('Intercept Attack (Warlike Familiar)', `When a creature within 5 ft. of it is hit by an attack roll, it adds +${pb} to that creature's AC against the attack, possibly making it miss.`));
  }
  if (status && status.friend) {
    traits.push(feature('Helpful Friend (Familiar Friend)', `While it is within 5 ft. of you, you have Advantage on ability checks using a skill you are proficient in, ${pb} times per Long Rest.`));
  }
  traits.push(feature('Familiar', listText(
    'It acts on its own turn with its own Initiative and obeys your commands',
    status && status.chain ? 'it can\'t attack, except that when you take the Attack action you can give up one of your attacks for it to make one with its Reaction' : 'it can\'t attack, but it can take other actions',
    'telepathy within 100 ft.; a Bonus Action lets you see and hear through it until the start of your next turn',
    'it can deliver your touch spells with its Reaction'
  ) + '.'));

  const sizeType = `${monster.size} ${creatureType}`;
  return {
    name: familiar.name || monster.name,
    form: monster.name,
    creatureType,
    typeLine: `${sizeType} (${monster.name})`,
    size: monster.size,
    crText: monster.crText,
    armorClass: monster.armorClass,
    armorClassText: monster.armorClassText,
    hpMax,
    hpBase: baseHp,
    hpBonus: hpMax - baseHp,
    speed,
    initiative: Number.isInteger(monster.initiative) ? monster.initiative : abilityModifier(monster.abilities.dex || 10),
    abilities: monster.abilities,
    saves: monster.saves,
    skills: monster.skills,
    skillsText: monster.skillsText,
    senses: monster.senses,
    languages: monster.languages,
    resistances: resistances.join(', '),
    immunities: monster.immunities,
    vulnerabilities: monster.vulnerabilities,
    traits,
    // A familiar can't attack (Pact of the Chain: with its Reaction).
    actions: monster.actions,
    canAttack: Boolean(status && status.chain),
    bonusActions,
    reactions,
    legendaryActions: [],
    notes,
    wildCompanion: Boolean(status && status.wildCompanionOnly)
  };
}

module.exports = {
  FAMILIAR_TYPES,
  NAMED_FORMS,
  CHAIN_FORMS,
  ELEMENTAL_TYPES,
  OTHERWORLDLY_TYPES,
  CHAIN_MASTER_MOVES,
  familiarRules,
  familiarFormProblem,
  familiarForms,
  familiarBlock,
  cleanFamiliarOptions
};
