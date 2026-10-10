// rules/invocations.js — Warlock Eldritch Invocations (2024 PHB).
//
// A Warlock knows the number of invocations in the Warlock table. Whenever they
// gain a Warlock level they may replace one invocation (strict 2024 rule);
// filling empty invocation slots is always allowed.
//
// Stored in sheet_data.invocations: [{ name, cantrip?, feat?, addedSkills?, addedTools? }].
// Descriptions come from rules/content/invocations.md.

const { atLevel } = require('./util');
const { getClass } = require('./classes');
const { ORIGIN_FEATS } = require('./feats');
const { getSpellCatalog, findSpell } = require('./spells');

// requires: invocation names needed first; cantrip: 'damage' | 'attack' means the
// invocation targets one of the Warlock's damaging cantrips (chosen per copy).
// spells: { name: 'atWill' | uses per Long Rest } cast without a spell slot.
const INVOCATIONS = {
  'Agonizing Blast': { level: 2, cantrip: 'damage', repeatable: true },
  'Armor of Shadows': { level: 1, spells: { 'Mage Armor': 'atWill' } },
  'Ascendant Step': { level: 5, spells: { Levitate: 'atWill' } },
  "Devil's Sight": { level: 2 },
  'Devouring Blade': { level: 12, requires: ['Thirsting Blade'] },
  'Eldritch Mind': { level: 1 },
  'Eldritch Smite': { level: 5, requires: ['Pact of the Blade'] },
  'Eldritch Spear': { level: 2, cantrip: 'damage', repeatable: true },
  'Fiendish Vigor': { level: 2, spells: { 'False Life': 'atWill' } },
  'Gaze of Two Minds': { level: 5 },
  'Gift of the Depths': { level: 5, spells: { 'Water Breathing': 1 } },
  'Gift of the Protectors': { level: 9, requires: ['Pact of the Tome'] },
  'Investment of the Chain Master': { level: 5, requires: ['Pact of the Chain'] },
  'Lessons of the First Ones': { level: 2, repeatable: true, originFeat: true },
  Lifedrinker: { level: 9, requires: ['Pact of the Blade'] },
  'Mask of the Many Faces': { level: 2, spells: { 'Disguise Self': 'atWill' } },
  'Master of Myriad Forms': { level: 5, spells: { 'Alter Self': 'atWill' } },
  'Misty Visions': { level: 2, spells: { 'Silent Image': 'atWill' } },
  'One with Shadows': { level: 5, spells: { Invisibility: 'atWill' } },
  'Otherworldly Leap': { level: 2, spells: { Jump: 'atWill' } },
  'Pact of the Blade': { level: 1 },
  'Pact of the Chain': { level: 1, spells: { 'Find Familiar': 'atWill' } },
  'Pact of the Tome': { level: 1, tome: { cantrips: 3, rituals: 2 } },
  'Repelling Blast': { level: 2, cantrip: 'attack', repeatable: true },
  'Thirsting Blade': { level: 5, requires: ['Pact of the Blade'] },
  'Visions of Distant Realms': { level: 9, spells: { 'Arcane Eye': 'atWill' } },
  'Whispers of the Grave': { level: 7, spells: { 'Speak with Dead': 'atWill' } },
  'Witch Sight': { level: 15 }
};
const INVOCATION_NAMES = Object.keys(INVOCATIONS);

function warlockLevelOf(classes) {
  const row = classes.find(item => item.className === 'Warlock');
  return row ? row.level : 0;
}

function invocationLimit(classes) {
  const level = warlockLevelOf(classes);
  return level ? atLevel(getClass('Warlock').resources.invocations, level) : 0;
}

function readInvocations(sheetData) {
  return Array.isArray((sheetData || {}).invocations) ? sheetData.invocations : [];
}

const DEALS_DAMAGE = /\d+d\d+[^.]*\bdamage\b/i;
const ATTACK_ROLL = /spell attack|attack roll/i;

// Warlock cantrips the character knows that qualify for Agonizing Blast etc.
function eligibleCantrips(kind, sheetData, catalog = getSpellCatalog()) {
  const known = ((((sheetData || {}).spellcasting || {}).classes || {}).Warlock || {}).cantrips || [];
  return known.filter(name => {
    const spell = findSpell(name, catalog);
    if (!spell || !spell.classes.includes('Warlock') || !DEALS_DAMAGE.test(spell.description)) return false;
    return kind !== 'attack' || ATTACK_ROLL.test(spell.description);
  });
}

// Reason a character can't take this invocation now, or null.
function invocationIneligibility(name, { classes, sheetData, chosen }) {
  const data = INVOCATIONS[name];
  if (!data) return 'Unknown invocation.';
  const level = warlockLevelOf(classes);
  if (level < data.level) return `Requires Warlock level ${data.level}.`;
  const missing = (data.requires || []).filter(required => !chosen.includes(required));
  if (missing.length) return `Requires ${missing.join(' and ')}.`;
  if (data.cantrip && !eligibleCantrips(data.cantrip, sheetData).length) {
    return data.cantrip === 'attack'
      ? 'Requires a Warlock cantrip that deals damage with an attack roll.'
      : 'Requires a Warlock cantrip that deals damage.';
  }
  return null;
}

// Validates a full new invocation list. choices: [{ name, cantrip, feat }].
// resolveFeat(featRequest, sheetData) resolves a Lessons of the First Ones feat.
// Returns { invocations, removedCount }.
function validateInvocations(choices, { classes, sheetData, resolveFeat }) {
  const list = Array.isArray(choices) ? choices : [];
  const limit = invocationLimit(classes);
  if (!limit) throw new Error('Only Warlocks have Eldritch Invocations.');
  if (list.length > limit) throw new Error(`You know at most ${limit} invocations at your Warlock level.`);
  const names = list.map(choice => choice && choice.name);
  const previous = readInvocations(sheetData);

  const result = list.map((choice, index) => {
    const name = names[index];
    const data = INVOCATIONS[name];
    if (!data) throw new Error(`Unknown invocation "${name}".`);
    const reason = invocationIneligibility(name, { classes, sheetData, chosen: names });
    if (reason) throw new Error(`${name}: ${reason}`);
    const copies = list.filter(other => other.name === name);
    if (copies.length > 1 && !data.repeatable) throw new Error(`${name} can only be taken once.`);
    const entry = { name };
    if (data.cantrip) {
      const options = eligibleCantrips(data.cantrip, sheetData);
      if (!options.includes(choice.cantrip)) throw new Error(`Choose which cantrip ${name} improves.`);
      if (copies.filter(other => other.cantrip === choice.cantrip).length > 1) {
        throw new Error(`Each copy of ${name} must improve a different cantrip.`);
      }
      entry.cantrip = choice.cantrip;
    }
    if (data.originFeat) {
      // Keep an unchanged feat as it is, so its earlier choices are not re-asked.
      const same = previous.find(old => old.name === name && old.feat && choice.feat && old.feat.name === choice.feat.name);
      const resolved = same && !choice.feat.changed ? same : resolveFeat(choice.feat || {}, sheetData);
      if (!ORIGIN_FEATS[resolved.feat.name]) throw new Error('Lessons of the First Ones grants an Origin feat.');
      if (copies.filter(other => other.feat && other.feat.name === resolved.feat.name).length > 1 &&
          !ORIGIN_FEATS[resolved.feat.name].repeatable) {
        throw new Error('Each Lessons of the First Ones must grant a different Origin feat.');
      }
      Object.assign(entry, { feat: resolved.feat, addedSkills: resolved.addedSkills || [], addedTools: resolved.addedTools || [] });
    }
    return entry;
  });

  // Strict rule: dropping an existing invocation counts as a replacement.
  const remaining = [...result];
  let removedCount = 0;
  for (const old of previous) {
    const index = remaining.findIndex(entry => entry.name === old.name);
    if (index >= 0) remaining.splice(index, 1);
    else removedCount += 1;
  }
  return { invocations: result, removedCount };
}

module.exports = {
  INVOCATIONS,
  INVOCATION_NAMES,
  invocationLimit,
  readInvocations,
  eligibleCantrips,
  invocationIneligibility,
  validateInvocations
};
