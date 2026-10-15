// rules/classResources.js — Limited-use class and subclass features (2024 PHB):
// Channel Divinity, Rage, Wild Shape, Second Wind, Bardic Inspiration, War
// Priest, Lay On Hands, ... How many uses a character has follows their class
// levels and ability scores; how many are spent is stored with the vitals
// (resourcesUsed) and recovered by rests (see rules/vitals.js).
//
// Recovery:
//   short    — all uses back on a Short or Long Rest
//   shortOne — one use back on a Short Rest, all on a Long Rest
//   long     — all uses back on a Long Rest only
// `pool: true` marks points spent several at a time (Lay On Hands, Focus
// Points, Sorcery Points, Healing Light dice).

const { atLevel, abilityModifier, proficiencyBonus } = require('./util');
const { getClass } = require('./classes');

const table = (className, key) => level => atLevel(getClass(className).resources[key], level);
const modMin1 = ability => ({ mods }) => Math.max(1, mods[ability]);
const byLevel = steps => level => steps.filter(([at]) => level >= at).reduce((value, [, count]) => count, 0);
const dieAtLevel = steps => level => steps.filter(([at]) => level >= at).reduce((die, [, size]) => size, null);
const PSIONIC_DICE = byLevel([[3, 4], [5, 6], [9, 8], [13, 10], [17, 12]]);
const PSIONIC_DIE = dieAtLevel([[3, 'd6'], [5, 'd8'], [11, 'd10'], [17, 'd12']]);

// className (and subclass) → features. max({ level, mods, pb }) gives the uses.
const RESOURCES = [
  { key: 'rage', name: 'Rage', className: 'Barbarian', minLevel: 1, max: ({ level }) => table('Barbarian', 'rages')(level), recovery: 'shortOne',
    text: ({ level }) => `Bonus Action, 10 minutes. +${atLevel(getClass('Barbarian').resources.rageDamage, level)} damage with Strength attacks; Resistance to Bludgeoning, Piercing and Slashing damage.` },
  { key: 'bardicInspiration', name: 'Bardic Inspiration', className: 'Bard', minLevel: 1, max: modMin1('cha'),
    recovery: ({ level }) => (level >= 5 ? 'short' : 'long'),
    text: ({ level }) => `Bonus Action: a creature within 60 ft gains a d${atLevel(getClass('Bard').resources.bardicInspirationDie, level)} to add to a failed D20 Test.${level >= 5 ? ' Font of Inspiration: also back on a Short Rest, or spend a spell slot for one use.' : ''}` },
  { key: 'channelDivinityCleric', name: 'Channel Divinity', className: 'Cleric', minLevel: 2, max: ({ level }) => table('Cleric', 'channelDivinity')(level), recovery: 'shortOne',
    text: ({ level, subclass }) => `Divine Spark (${level >= 18 ? 4 : level >= 13 ? 3 : level >= 7 ? 2 : 1}d8 + WIS: heal, or Necrotic/Radiant damage with a CON save), Turn Undead` +
      ({ 'Life Domain': ', Preserve Life', 'Light Domain': ', Radiance of the Dawn', 'Trickery Domain': ', Invoke Duplicity', 'War Domain': ', Guided Strike (+10 to a missed attack roll)' }[subclass] || '') + '. Save DC = your Cleric spell save DC.' },
  { key: 'warPriest', name: 'War Priest', subclass: 'War Domain', minLevel: 3, max: modMin1('wis'), recovery: 'short',
    text: () => 'Bonus Action: make one attack with a weapon or an Unarmed Strike.' },
  { key: 'wardingFlare', name: 'Warding Flare', subclass: 'Light Domain', minLevel: 3, max: modMin1('wis'), recovery: 'long',
    text: () => 'Reaction: impose Disadvantage on an attack roll against you or a creature within 30 ft.' },
  { key: 'divineIntervention', name: 'Divine Intervention', className: 'Cleric', minLevel: 10, max: () => 1, recovery: 'long',
    text: () => 'Magic action: cast a Cleric spell of level 5 or lower without a slot or Material components.' },
  { key: 'wildShape', name: 'Wild Shape', className: 'Druid', minLevel: 2, max: ({ level }) => table('Druid', 'wildShape')(level), recovery: 'shortOne',
    text: () => 'Bonus Action: take a Beast form you have learned. Also fuels Wild Companion and Circle features.' },
  { key: 'starMap', name: 'Star Map: Guiding Bolt', subclass: 'Circle of the Stars', minLevel: 3, max: modMin1('wis'), recovery: 'long',
    text: () => 'Cast Guiding Bolt without a spell slot.' },
  { key: 'cosmicOmen', name: 'Cosmic Omen', subclass: 'Circle of the Stars', minLevel: 6, max: modMin1('wis'), recovery: 'long',
    text: () => 'Reaction: when a creature you can see within 30 ft. is about to make a D20 Test, roll 1d6 and add it (Weal, an even omen) or subtract it (Woe, an odd omen). The omen is rolled after each Long Rest.' },
  { key: 'secondWind', name: 'Second Wind', className: 'Fighter', minLevel: 1, max: ({ level }) => table('Fighter', 'secondWind')(level), recovery: 'shortOne',
    text: ({ level }) => `Bonus Action: regain 1d10 + ${level} HP.` },
  { key: 'actionSurge', name: 'Action Surge', className: 'Fighter', minLevel: 2, max: ({ level }) => table('Fighter', 'actionSurge')(level), recovery: 'short',
    text: () => 'Take one additional action (not the Magic action) on your turn; once per turn.' },
  { key: 'indomitable', name: 'Indomitable', className: 'Fighter', minLevel: 9, max: ({ level }) => table('Fighter', 'indomitable')(level), recovery: 'long',
    text: ({ level }) => `Reroll a failed saving throw with a +${level} bonus.` },
  { key: 'superiorityDice', name: 'Superiority Dice', subclass: 'Battle Master', minLevel: 3, max: ({ level }) => byLevel([[3, 4], [7, 5], [15, 6]])(level), recovery: 'short',
    text: ({ level }) => `d${level >= 18 ? 12 : level >= 10 ? 10 : 8}s for your maneuvers.` },
  { key: 'psionicDiceFighter', name: 'Psionic Energy Dice', subclass: 'Psi Warrior', minLevel: 3, max: ({ level }) => PSIONIC_DICE(level), recovery: 'shortOne',
    text: ({ level }) => `${PSIONIC_DIE(level)}s for Protective Field, Psionic Strike and Telekinetic Movement.` },
  { key: 'focusPoints', name: 'Focus Points', className: 'Monk', minLevel: 2, max: ({ level }) => table('Monk', 'focusPoints')(level), recovery: 'short', pool: true,
    text: () => 'Flurry of Blows, Patient Defense, Step of the Wind and more.' },
  { key: 'uncannyMetabolism', name: 'Uncanny Metabolism', className: 'Monk', minLevel: 2, max: () => 1, recovery: 'long',
    text: ({ level }) => `When you roll Initiative: regain all Focus Points and Martial Arts die + ${level} HP.` },
  { key: 'layOnHands', name: 'Lay On Hands', className: 'Paladin', minLevel: 1, max: ({ level }) => 5 * level, recovery: 'long', pool: true,
    text: () => 'Bonus Action: heal from the pool, or spend 5 to remove the Poisoned condition.' },
  { key: 'channelDivinityPaladin', name: 'Channel Divinity', className: 'Paladin', minLevel: 3, max: ({ level }) => table('Paladin', 'channelDivinity')(level), recovery: 'shortOne',
    text: ({ level, subclass }) => `Divine Sense${level >= 9 ? ', Abjure Foes' : ''}` +
      ({ 'Oath of Devotion': ', Sacred Weapon', 'Oath of Glory': ', Peerless Athlete, Inspiring Smite', 'Oath of the Ancients': ", Nature's Wrath", 'Oath of Vengeance': ', Vow of Enmity' }[subclass] || '') + '.' },
  { key: 'faithfulSteed', name: 'Faithful Steed', className: 'Paladin', minLevel: 5, max: () => 1, recovery: 'long',
    text: () => 'Cast Find Steed without a spell slot.' },
  { key: 'favoredEnemy', name: "Favored Enemy: Hunter's Mark", className: 'Ranger', minLevel: 1, max: ({ level }) => table('Ranger', 'favoredEnemy')(level), recovery: 'long',
    text: () => "Cast Hunter's Mark without a spell slot." },
  { key: 'psionicDiceRogue', name: 'Psionic Energy Dice', subclass: 'Soulknife', minLevel: 3, max: ({ level }) => PSIONIC_DICE(level), recovery: 'shortOne',
    text: ({ level }) => `${PSIONIC_DIE(level)}s for Psi-Bolstered Knack and Psychic Whispers.` },
  { key: 'innateSorcery', name: 'Innate Sorcery', className: 'Sorcerer', minLevel: 1, max: () => 2, recovery: 'long',
    text: () => 'Bonus Action, 1 minute: +1 to your Sorcerer spell save DC and Advantage on Sorcerer spell attacks.' },
  { key: 'sorceryPoints', name: 'Sorcery Points', className: 'Sorcerer', minLevel: 2, max: ({ level }) => table('Sorcerer', 'sorceryPoints')(level), recovery: 'long', pool: true,
    text: ({ level }) => `Metamagic and Flexible Casting.${level >= 5 ? ` Sorcerous Restoration: once per Long Rest, regain up to ${Math.floor(level / 2)} after a Short Rest.` : ''}` },
  { key: 'magicalCunning', name: 'Magical Cunning', className: 'Warlock', minLevel: 2, max: () => 1, recovery: 'long',
    text: () => 'After a 1-minute rite, regain up to half your Pact Magic slots (rounded up).' },
  { key: 'healingLight', name: 'Healing Light (d6 pool)', subclass: 'Celestial Patron', minLevel: 3, max: ({ level }) => 1 + level, recovery: 'long', pool: true,
    text: ({ mods }) => `Bonus Action: roll up to ${Math.max(1, mods.cha)} of these d6s to heal a creature within 60 ft.` },
  { key: 'stepsOfTheFey', name: 'Steps of the Fey', subclass: 'Archfey Patron', minLevel: 3, max: modMin1('cha'), recovery: 'long',
    text: () => 'Cast Misty Step without a spell slot.' },
  { key: 'darkOnesOwnLuck', name: "Dark One's Own Luck", subclass: 'Fiend Patron', minLevel: 6, max: modMin1('cha'), recovery: 'long',
    text: () => 'Add a d10 to an ability check or saving throw.' },
  { key: 'arcaneRecovery', name: 'Arcane Recovery', className: 'Wizard', minLevel: 1, max: () => 1, recovery: 'long',
    text: ({ level }) => `After a Short Rest, recover spell slots totalling up to ${Math.ceil(level / 2)} levels (none of level 6+).` }
];

// classRows: [{ className, subclassName, level }]; scoreOf(ability) gives the score.
// Returns [{ key, name, source, max, recovery, pool, text }].
function classResources(classRows, scoreOf) {
  const mods = Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(ability => [ability, abilityModifier(scoreOf(ability))]));
  const totalLevel = classRows.reduce((sum, row) => sum + row.level, 0);
  const pb = proficiencyBonus(Math.max(1, totalLevel));
  const result = [];
  for (const row of classRows) {
    for (const resource of RESOURCES) {
      const matches = resource.subclass ? row.subclassName === resource.subclass : row.className === resource.className;
      if (!matches || row.level < resource.minLevel) continue;
      const context = { level: row.level, mods, pb, subclass: row.subclassName };
      const max = resource.max(context);
      if (!max) continue;
      const recovery = typeof resource.recovery === 'function' ? resource.recovery(context) : resource.recovery;
      result.push({
        key: resource.key,
        name: resource.name,
        source: resource.subclass || resource.className,
        max,
        recovery,
        pool: Boolean(resource.pool),
        text: resource.text(context)
      });
    }
  }
  return result;
}

// Uses spent after a rest. used: { key: count }; kind: 'short' | 'long'.
function recoverResources(used, resources, kind) {
  const next = {};
  for (const resource of resources) {
    const spent = Math.min(resource.max, used[resource.key] || 0);
    if (!spent) continue;
    if (kind === 'long' || resource.recovery === 'short') continue;
    next[resource.key] = resource.recovery === 'shortOne' ? spent - 1 : spent;
    if (!next[resource.key]) delete next[resource.key];
  }
  return next;
}

module.exports = { CLASS_RESOURCES: RESOURCES, classResources, recoverResources };
