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
// Points, Sorcery Points, Healing Light dice). `rolls({ level, mods, pb })`
// gives dice the sheet can roll for the feature: [{ key, label, formula }]
// (roll id "resource:<key>:<roll key>", see db/dice.js). An entry with max 0
// has no uses, only text and rolls (Soul Siphon); a class entry needs
// `info: true` for that (Martial Arts), else max 0 means "not yet".

const { atLevel, abilityModifier, proficiencyBonus } = require('./util');
const { getClass } = require('./classes');
const { spellcastingFor } = require('./spellcasting');

const table = (className, key) => level => atLevel(getClass(className).resources[key], level);
const modMin1 = ability => ({ mods }) => Math.max(1, mods[ability]);
const signed = value => (value ? `${value > 0 ? '+' : ''}${value}` : '');
const byLevel = steps => level => steps.filter(([at]) => level >= at).reduce((value, [, count]) => count, 0);
const dieAtLevel = steps => level => steps.filter(([at]) => level >= at).reduce((die, [, size]) => size, null);
const PSIONIC_DICE = byLevel([[3, 4], [5, 6], [9, 8], [13, 10], [17, 12]]);
const PSIONIC_DIE = dieAtLevel([[3, 'd6'], [5, 'd8'], [11, 'd10'], [17, 'd12']]);
const MARTIAL_ARTS_DIE = level => `d${table('Monk', 'martialArtsDie')(level)}`;
const RAGE_DAMAGE = level => table('Barbarian', 'rageDamage')(level);
const LAND_DICE = byLevel([[3, 2], [10, 3], [14, 4]]);
const BARDIC_DIE = level => table('Bard', 'bardicInspirationDie')(level);
const ARCANE_SHOT_DIE = dieAtLevel([[3, 'd6'], [10, 'd8'], [15, 'd10'], [18, 'd12']]);
// Phantom: half the Sneak Attack dice (round up).
const WAIL_DICE = level => Math.ceil(table('Rogue', 'sneakAttackDice')(level) / 2);

// className (and subclass) → features. max({ level, mods, pb }) gives the uses.
const RESOURCES = [
  { key: 'rage', name: 'Rage', className: 'Barbarian', minLevel: 1, max: ({ level }) => table('Barbarian', 'rages')(level), recovery: 'shortOne',
    text: ({ level }) => `Bonus Action, 10 minutes. +${atLevel(getClass('Barbarian').resources.rageDamage, level)} damage with Strength attacks; Resistance to Bludgeoning, Piercing and Slashing damage.` },
  // Barbarian subclasses (PHB 2024). Dice that scale with the Rage Damage bonus.
  { key: 'frenzy', name: 'Frenzy', subclass: 'Path of the Berserker', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level }) => [{ key: 'extra', label: 'Frenzy (extra damage)', formula: `${RAGE_DAMAGE(level)}d6` }],
    text: ({ level }) => `Reckless Attack while raging: the first target you hit on your turn with a Strength attack takes an extra ${RAGE_DAMAGE(level)}d6 of the weapon's type.` +
      (level >= 6 ? ' Mindless Rage: immune to Charmed and Frightened while raging.' : '') +
      (level >= 10 ? ' Retaliation: Reaction, a melee attack against a creature within 5 ft. that damages you.' : '') },
  { key: 'intimidatingPresence', name: 'Intimidating Presence', subclass: 'Path of the Berserker', minLevel: 14, max: () => 1, recovery: 'long',
    text: ({ mods, pb }) => `Bonus Action: creatures of your choice within 30 ft. make a WIS save (DC ${8 + mods.str + pb}) or are Frightened for 1 minute (save at the end of each turn). A use of Rage restores it.` },
  { key: 'rageOfTheWilds', name: 'Rage of the Wilds', subclass: 'Path of the Wild Heart', minLevel: 3, max: () => 0, info: true,
    text: ({ level }) => [
      'Each Rage, choose: Bear (Resistance to all damage but Force, Necrotic, Psychic and Radiant), Eagle (Disengage and Dash with the Bonus Action, and as a Bonus Action while raging) or Wolf (allies have Advantage on attacks against your enemies within 5 ft. of you).',
      level >= 6 ? 'Aspect of the Wilds, changed after a Long Rest: Owl (Darkvision 60 ft., or +60 ft.), Panther (Climb Speed) or Salmon (Swim Speed).' : '',
      level >= 14 ? 'Power of the Wilds, each Rage: Falcon (Fly Speed without armor), Lion (enemies within 5 ft. have Disadvantage attacking others) or Ram (knock a Large or smaller creature Prone on a melee hit).' : ''
    ].filter(Boolean).join(' ') },
  { key: 'vitalityOfTheTree', name: 'Vitality of the Tree', subclass: 'Path of the World Tree', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level }) => [{ key: 'life', label: 'Life-Giving Force (temporary HP)', formula: `${RAGE_DAMAGE(level)}d6` }],
    text: ({ level, mods, pb }) => [
      `Vitality Surge: ${level} temporary HP when you Rage. Life-Giving Force: at the start of each of your turns while raging, another creature within 10 ft. gains ${RAGE_DAMAGE(level)}d6 temporary HP (gone when the Rage ends).`,
      level >= 6 ? `Branches of the Tree: Reaction when a creature starts its turn within 30 ft. while you rage: STR save (DC ${8 + mods.str + pb}) or it is pulled next to you, Speed 0 this turn.` : '',
      level >= 10 ? 'Battering Roots: +10 ft. reach on your turn with Heavy or Versatile melee weapons, and Push or Topple on top of their mastery.' : '',
      level >= 14 ? 'Travel along the Tree: teleport 60 ft. when you Rage and as a Bonus Action while raging; once per Rage, 150 ft. with up to six willing creatures.' : ''
    ].filter(Boolean).join(' ') },
  { key: 'divineFury', name: 'Divine Fury', subclass: 'Path of the Zealot', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level }) => [{ key: 'extra', label: 'Divine Fury (Necrotic or Radiant)', formula: `1d6+${Math.floor(level / 2)}` }],
    text: ({ level }) => `While raging, the first creature you hit on each of your turns takes an extra 1d6 + ${Math.floor(level / 2)} Necrotic or Radiant damage.` +
      (level >= 6 ? ` Fanatical Focus: once per Rage, reroll a failed save with +${RAGE_DAMAGE(level)}.` : '') },
  { key: 'warriorOfTheGods', name: 'Warrior of the Gods (d12 pool)', subclass: 'Path of the Zealot', minLevel: 3, max: ({ level }) => byLevel([[3, 4], [6, 5], [12, 6], [17, 7]])(level), recovery: 'long', pool: true,
    rolls: ({ level }) => Array.from({ length: byLevel([[3, 4], [6, 5], [12, 6], [17, 7]])(level) }, (_, index) => ({ key: `heal${index + 1}`, label: `Warrior of the Gods, ${index + 1} ${index ? 'dice' : 'die'}`, formula: `${index + 1}d12` })),
    text: () => 'Bonus Action: spend dice from the pool and regain that many d12s of Hit Points.' },
  { key: 'zealousPresence', name: 'Zealous Presence', subclass: 'Path of the Zealot', minLevel: 10, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action: up to ten other creatures within 60 ft. have Advantage on attacks and saves until the start of your next turn. A use of Rage restores it.' },
  { key: 'rageOfTheGods', name: 'Rage of the Gods', subclass: 'Path of the Zealot', minLevel: 14, max: () => 1, recovery: 'long',
    text: ({ level }) => `When you Rage, 1 minute as a divine warrior: Fly Speed (hover), Resistance to Necrotic, Psychic and Radiant; Reaction and a use of Rage when a creature within 30 ft. would drop to 0 HP: it has ${level} HP instead.` },
  // Bard subclasses (PHB 2024)
  { key: 'danceInfo', name: 'Dazzling Footwork', subclass: 'College of Dance', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level }) => (level >= 6 ? [{ key: 'tandem', label: 'Tandem Footwork: Initiative bonus', formula: `1d${BARDIC_DIE(level)}` }] : []),
    text: ({ level }) => 'No armor or Shield: AC 10 + DEX + CHA, Unarmed Strikes with DEX for d' + BARDIC_DIE(level) + ' + DEX (the die is not spent), and an Unarmed Strike with any action that spends Bardic Inspiration.' +
      (level >= 6 ? ' Inspiring Movement: Reaction and a use, half your Speed, and an ally moves too. Tandem Footwork: a use when you roll Initiative, you and allies within 30 ft. add the die.' : '') +
      (level >= 14 ? ' Leading Evasion: no damage on a successful DEX save for half, half on a failure; share it with creatures within 5 ft.' : '') },
  { key: 'beguilingMagic', name: 'Beguiling Magic', subclass: 'College of Glamour', minLevel: 3, max: () => 1, recovery: 'long',
    rolls: ({ level }) => [{ key: 'mantle', label: 'Mantle of Inspiration: die (×2 temporary HP)', formula: `1d${BARDIC_DIE(level)}` }],
    text: ({ mods }) => `After an Enchantment or Illusion spell with a slot: a creature within 60 ft. makes a WIS save or is Charmed or Frightened for 1 minute. A use of Bardic Inspiration restores it. Mantle of Inspiration: Bonus Action and a use, up to ${Math.max(1, mods.cha)} creatures gain twice the die in temporary HP and move.` },
  { key: 'mantleOfMajesty', name: 'Mantle of Majesty', subclass: 'College of Glamour', minLevel: 6, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action: cast Command without a slot, and again as a Bonus Action for 1 minute (Concentration); creatures you charm fail the save. A level 3+ slot restores it.' },
  { key: 'unbreakableMajesty', name: 'Unbreakable Majesty', subclass: 'College of Glamour', minLevel: 14, max: () => 1, recovery: 'short',
    text: () => 'Bonus Action, 1 minute: the first time a creature hits you on a turn, it makes a CHA save or misses.' },
  { key: 'cuttingWords', name: 'Cutting Words', subclass: 'College of Lore', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level }) => [{ key: 'die', label: 'Cutting Words / Peerless Skill', formula: `1d${BARDIC_DIE(level)}` }],
    text: ({ level }) => 'Reaction and a use of Bardic Inspiration: subtract the die from a damage roll, or a successful check or attack, of a creature within 60 ft.' +
      (level >= 14 ? ' Peerless Skill: add the die to your own failed check or attack (the use is spent only if it then succeeds).' : '') },
  { key: 'combatInspiration', name: 'Combat Inspiration', subclass: 'College of Valor', minLevel: 3, max: () => 0, info: true,
    text: ({ level }) => 'Your Bardic Inspiration can also add to AC against a hit (Reaction) or to the damage of a hit.' +
      (level >= 6 ? ' Extra Attack: two attacks, one may be a cantrip with a casting time of an action.' : '') +
      (level >= 14 ? ' Battle Magic: after an action spell, a weapon attack as a Bonus Action.' : '') },
  { key: 'bardicInspiration', name: 'Bardic Inspiration', className: 'Bard', minLevel: 1, max: modMin1('cha'),
    rolls: ({ level }) => [{ key: 'die', label: 'Bardic Inspiration die', formula: `1d${atLevel(getClass('Bard').resources.bardicInspirationDie, level)}` }],
    recovery: ({ level }) => (level >= 5 ? 'short' : 'long'),
    text: ({ level }) => `Bonus Action: a creature within 60 ft gains a d${atLevel(getClass('Bard').resources.bardicInspirationDie, level)} to add to a failed D20 Test.${level >= 5 ? ' Font of Inspiration: also back on a Short Rest, or spend a spell slot for one use.' : ''}` },
  { key: 'channelDivinityCleric', name: 'Channel Divinity', className: 'Cleric', minLevel: 2, max: ({ level }) => table('Cleric', 'channelDivinity')(level), recovery: 'shortOne',
    rolls: ({ level, mods, subclass }) => [
      { key: 'spark', label: 'Divine Spark (heal, Necrotic or Radiant)', formula: `${level >= 18 ? 4 : level >= 13 ? 3 : level >= 7 ? 2 : 1}d8${signed(mods.wis)}` },
      ...(level >= 5 ? [{ key: 'sear', label: 'Sear Undead (Radiant)', formula: `${Math.max(1, mods.wis)}d8` }] : []),
      ...(subclass === 'Light Domain' ? [{ key: 'dawn', label: 'Radiance of the Dawn (Radiant)', formula: `2d10+${level}` }] : []),
      ...(subclass === 'Arcana Domain' ? [{ key: 'fortifying', label: 'Fortifying Spell: temporary HP', formula: `2d8+${level}` }, { key: 'tenacious', label: 'Tenacious Spell: subtract from the save', formula: '1d6' }] : [])
    ],
    text: ({ level, subclass }) => `Divine Spark (${level >= 18 ? 4 : level >= 13 ? 3 : level >= 7 ? 2 : 1}d8 + WIS: heal, or Necrotic/Radiant damage with a CON save), Turn Undead` +
      ({ 'Life Domain': ', Preserve Life', 'Light Domain': ', Radiance of the Dawn', 'Pestilence Domain': ', Plague Blessing (5-ft. Emanation, CON save or 1 Exhaustion level)', 'Arcana Domain': ', Modify Magic (Fortifying Spell: 2d8 + Cleric level temporary HP; Tenacious Spell: a target that saved subtracts 1d6 from its first save against the spell)', 'Grave Domain': ', Path to the Grave (Bonus Action: a creature within 30 ft. has Disadvantage on attacks and saves; end it on a hit for + Cleric level Necrotic or Radiant damage)', 'Trickery Domain': ', Invoke Duplicity', 'War Domain': level >= 6 ? ", Guided Strike (+10 to a missed attack roll), War God's Blessing (Shield of Faith or Spiritual Weapon without a slot or Concentration)" : ', Guided Strike (+10 to a missed attack roll)' }[subclass] || '') + '. Save DC = your Cleric spell save DC.' },
  { key: 'warPriest', name: 'War Priest', subclass: 'War Domain', minLevel: 3, max: modMin1('wis'), recovery: 'short',
    text: () => 'Bonus Action: make one attack with a weapon or an Unarmed Strike.' },
  // Improved Warding Flare (6): back on a Short Rest, and temporary HP for the target.
  { key: 'wardingFlare', name: 'Warding Flare', subclass: 'Light Domain', minLevel: 3, max: modMin1('wis'),
    recovery: ({ level }) => (level >= 6 ? 'short' : 'long'),
    rolls: ({ level, mods }) => (level >= 6 ? [{ key: 'thp', label: 'Improved Warding Flare: temporary HP', formula: `2d6${signed(mods.wis)}` }] : []),
    text: ({ level }) => 'Reaction: impose Disadvantage on an attack roll made by a creature you can see within 30 ft.' +
      (level >= 6 ? ' The attack\'s target gains 2d6 + WIS temporary HP.' : '') },
  { key: 'coronaOfLight', name: 'Corona of Light', subclass: 'Light Domain', minLevel: 17, max: modMin1('wis'), recovery: 'long',
    text: () => 'Magic action, 1 minute: sunlight 60 ft.; enemies in it have Disadvantage on saves against Radiance of the Dawn and Fire or Radiant spells.' },
  { key: 'blessingOfTheTrickster', name: 'Blessing of the Trickster', subclass: 'Trickery Domain', minLevel: 3, max: () => 0, info: true,
    text: ({ level }) => 'Magic action: you or a willing creature within 30 ft. has Advantage on Stealth checks until your next Long Rest.' +
      (level >= 6 ? " Trickster's Transposition: swap places with your Invoke Duplicity illusion when you create or move it." : '') +
      (level >= 17 ? ' Improved Duplicity: you and allies have Advantage against creatures within 5 ft. of the illusion; when it ends, a creature within 5 ft. of it regains ' + level + ' HP.' : '') },
  { key: 'virulentBurst', name: 'Virulent Burst', subclass: 'Pestilence Domain', minLevel: 6, max: modMin1('wis'), recovery: 'long',
    rolls: () => [{ key: 'toxic', label: 'Toxic Infection (Necrotic or Poison)', formula: '3d6' }],
    text: () => 'Reaction when an enemy within 60 ft. drops to 0 HP: plague bursts from it (10-ft. Emanation, 20 ft. if it had Exhaustion). CON save or Incapacitated (Speed 0) until the end of its next turn, or 3d6 Necrotic or Poison damage.' },
  { key: 'verminForm', name: 'Vermin Form', subclass: 'Pestilence Domain', minLevel: 17, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action, 10 minutes: a Medium swarm of pests. Immune to Grappled, Paralyzed, Prone and Restrained; Resistance to Bludgeoning, Piercing and Slashing; Climb Speed; bites for your WIS modifier. A level 5+ spell slot restores the use.' },
  { key: 'divineIntervention', name: 'Divine Intervention', className: 'Cleric', minLevel: 10, max: () => 1, recovery: 'long',
    text: () => 'Magic action: cast a Cleric spell of level 5 or lower without a slot or Material components.' },
  { key: 'wildShape', name: 'Wild Shape', className: 'Druid', minLevel: 2, max: ({ level }) => table('Druid', 'wildShape')(level), recovery: 'shortOne',
    text: () => 'Bonus Action: take a Beast form you have learned. Also fuels Wild Companion and Circle features.' },
  // Druid circles (PHB 2024)
  { key: 'landsAid', name: "Land's Aid", subclass: 'Circle of the Land', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level }) => [{ key: 'harm', label: "Land's Aid (Necrotic, CON save)", formula: `${LAND_DICE(level)}d6` }, { key: 'heal', label: "Land's Aid (heal)", formula: `${LAND_DICE(level)}d6` }],
    text: ({ level }) => `Magic action and a Wild Shape use: a 10-ft. Sphere within 60 ft., creatures of your choice take ${LAND_DICE(level)}d6 Necrotic (CON save for half) and one creature regains ${LAND_DICE(level)}d6 HP.` +
      (level >= 14 ? " Nature's Sanctuary: a Wild Shape use, a 15-ft. Cube of trees within 120 ft. for 1 minute (Half Cover, your Nature's Ward resistance for allies)." : '') },
  { key: 'naturalRecovery', name: 'Natural Recovery', subclass: 'Circle of the Land', minLevel: 6, max: () => 1, recovery: 'long',
    text: ({ level }) => `Cast a level 1+ Circle spell without a slot (once per Long Rest); and once per Long Rest, after a Short Rest, recover spell slots totalling up to ${Math.ceil(level / 2)} levels (none of level 6+).` },
  { key: 'moonlightStep', name: 'Moonlight Step', subclass: 'Circle of the Moon', minLevel: 10, max: modMin1('wis'), recovery: 'long',
    rolls: ({ level }) => (level >= 14 ? [{ key: 'lunar', label: 'Improved Lunar Radiance (Radiant)', formula: '2d10' }] : []),
    text: ({ level }) => 'Bonus Action: teleport up to 30 ft. and have Advantage on your next attack this turn. A level 2+ slot restores a use.' +
      (level >= 14 ? ' Lunar Form: +2d10 Radiant once per turn with a Wild Shape attack; take a willing creature within 10 ft. along.' : '') },
  { key: 'wrathOfTheSea', name: 'Wrath of the Sea', subclass: 'Circle of the Sea', minLevel: 3, max: () => 0, info: true,
    rolls: ({ mods }) => [{ key: 'cold', label: 'Wrath of the Sea (Cold, CON save)', formula: `${Math.max(1, mods.wis)}d6` }],
    text: ({ level, mods }) => `Bonus Action and a Wild Shape use: a ${level >= 6 ? 10 : 5}-ft. Emanation of ocean spray for 10 minutes. When you make it and as a Bonus Action later, a creature in it makes a CON save or takes ${Math.max(1, mods.wis)}d6 Cold and is pushed 15 ft.` +
      (level >= 6 ? ' Aquatic Affinity: Swim Speed equal to your Speed.' : '') +
      (level >= 10 ? ' Stormborn: while it is active, Fly Speed and Resistance to Cold, Lightning and Thunder.' : '') +
      (level >= 14 ? ' Oceanic Gift: put it on a willing creature within 60 ft. (or on both of you for two uses).' : '') },
  { key: 'starMap', name: 'Star Map: Guiding Bolt', subclass: 'Circle of the Stars', minLevel: 3, max: modMin1('wis'), recovery: 'long',
    text: () => 'Cast Guiding Bolt without a spell slot.' },
  { key: 'cosmicOmen', name: 'Cosmic Omen', subclass: 'Circle of the Stars', minLevel: 6, max: modMin1('wis'), recovery: 'long',
    text: () => 'Reaction: when a creature you can see within 30 ft. is about to make a D20 Test, roll 1d6 and add it (Weal, an even omen) or subtract it (Woe, an odd omen). The omen is rolled after each Long Rest.' },
  { key: 'secondWind', name: 'Second Wind', className: 'Fighter', minLevel: 1, max: ({ level }) => table('Fighter', 'secondWind')(level), recovery: 'shortOne',
    rolls: ({ level }) => [{ key: 'heal', label: 'Second Wind (heal)', formula: `1d10+${level}` }],
    text: ({ level }) => `Bonus Action: regain 1d10 + ${level} HP.` },
  { key: 'actionSurge', name: 'Action Surge', className: 'Fighter', minLevel: 2, max: ({ level }) => table('Fighter', 'actionSurge')(level), recovery: 'short',
    text: () => 'Take one additional action (not the Magic action) on your turn; once per turn.' },
  { key: 'indomitable', name: 'Indomitable', className: 'Fighter', minLevel: 9, max: ({ level }) => table('Fighter', 'indomitable')(level), recovery: 'long',
    text: ({ level }) => `Reroll a failed saving throw with a +${level} bonus.` },
  { key: 'infernalWound', name: 'Infernal Wound', subclass: 'Hell Knight', minLevel: 3, max: modMin1('con'), recovery: 'short',
    rolls: ({ level }) => [
      { key: 'die', label: 'Infernal Wound die (Fire)', formula: '1d6' },
      ...(level >= 15 ? [{ key: 'blister', label: 'Blister of Avernus: another d6 (Fire)', formula: '1d6' }] : [])
    ],
    text: ({ level }) => 'Once per turn, a hit with your Hellfire Weapon: +1d6 Fire damage, and the target takes 1d6 Fire at the start of each of its turns for 1 minute (until healed or stanched).' +
      (level >= 7 ? ' Roll a 6: Purulence of Minauros, Rupture of Cania or Stygian Gangrene.' : '') +
      (level >= 15 ? ' Blister of Avernus: each 6 adds another d6 (up to three).' : '') +
      (level >= 18 ? ' Infernal Bargain: a 1 counts as a 6.' : '') },
  { key: 'superiorityDice', name: 'Superiority Dice', subclass: 'Battle Master', minLevel: 3, max: ({ level }) => byLevel([[3, 4], [7, 5], [15, 6]])(level), recovery: 'short',
    rolls: ({ level }) => [{ key: 'die', label: 'Superiority die', formula: `1d${level >= 18 ? 12 : level >= 10 ? 10 : 8}` }],
    text: ({ level }) => `d${level >= 18 ? 12 : level >= 10 ? 10 : 8}s for your maneuvers.` },
  { key: 'psionicDiceFighter', name: 'Psionic Energy Dice', subclass: 'Psi Warrior', minLevel: 3, max: ({ level }) => PSIONIC_DICE(level), recovery: 'shortOne',
    rolls: ({ level, mods }) => [{ key: 'die', label: 'Psionic Energy die', formula: `1${PSIONIC_DIE(level)}` }, { key: 'strike', label: 'Psionic Strike (Force) / Protective Field', formula: `1${PSIONIC_DIE(level)}${signed(mods.int)}` }],
    text: ({ level, mods, pb }) => `Protective Field: Reaction, reduce damage to you or a creature within 30 ft. by a ${PSIONIC_DIE(level)} + INT. Psionic Strike: once per turn after a weapon hit within 30 ft., a ${PSIONIC_DIE(level)} + INT Force damage.` + (level >= 7 ? ` Telekinetic Thrust: STR save (DC ${8 + mods.int + pb}) or Prone or moved 10 ft.` : '') + ' A die back on a Short Rest, all on a Long Rest.' },
  // Monk: what a beginner needs on one card — what the points buy at this
  // level, and the Martial Arts die. Martial Arts and Deflect Attacks have no
  // uses (info: true), only their text and dice.
  { key: 'martialArts', name: 'Martial Arts', className: 'Monk', minLevel: 1, max: () => 0, info: true,
    rolls: ({ level, mods }) => [{ key: 'die', label: 'Martial Arts die', formula: `1${MARTIAL_ARTS_DIE(level)}${signed(mods.dex)}` }],
    text: ({ level }) => `Without armor or a Shield, using only your fists or Monk weapons (Simple melee, Martial melee with Light): ` +
      `make one Unarmed Strike as a Bonus Action (no points needed); roll ${MARTIAL_ARTS_DIE(level)} for damage instead of the weapon's die; use DEX instead of STR. ` +
      `AC is 10 + DEX + WIS (Unarmored Defense)${level >= 2 ? `; Speed +${table('Monk', 'unarmoredMovement')(level)} feet` : ''}.` +
      (level >= 5 ? ' Extra Attack: two attacks with the Attack action.' : '') +
      (level >= 6 ? ' Unarmed Strikes can deal Force damage.' : '') },
  { key: 'focusPoints', name: 'Focus Points', className: 'Monk', minLevel: 2, max: ({ level }) => table('Monk', 'focusPoints')(level), recovery: 'short', pool: true,
    rolls: ({ level, mods }) => [
      ...(level >= 3 ? [{ key: 'redirect', label: 'Deflect Attacks: redirect', formula: `2${MARTIAL_ARTS_DIE(level)}${signed(mods.dex)}` }] : []),
      ...(level >= 10 ? [{ key: 'patient', label: 'Patient Defense: temporary HP', formula: `2${MARTIAL_ARTS_DIE(level)}` }] : [])
    ],
    text: ({ level, mods, pb }) => [
      `Spend 1 on your turn, as a Bonus Action:`,
      `Flurry of Blows — ${level >= 10 ? 'three' : 'two'} Unarmed Strikes (instead of the free one);`,
      `Patient Defense — Disengage and Dodge (attacks against you have Disadvantage)${level >= 10 ? `, plus 2${MARTIAL_ARTS_DIE(level)} temporary HP` : ''};`,
      `Step of the Wind — Disengage and Dash, jump twice as far${level >= 10 ? ', and carry a willing creature along' : ''}.`,
      `Without a point, Patient Defense is a Disengage and Step of the Wind a Dash.`,
      level >= 3 ? `Deflect Attacks: when you reduce a hit's damage to 0, spend 1 to throw it at someone (DEX save).` : '',
      level >= 5 ? `Stunning Strike: once per turn on a hit, spend 1 — CON save or Stunned until your next turn.` : '',
      level >= 14 ? `Disciplined Survivor: spend 1 to reroll a failed save.` : '',
      level >= 18 ? `Superior Defense: spend 3 at the start of your turn for Resistance to all but Force damage for 1 minute.` : '',
      `Save DC ${8 + mods.wis + pb}.`
    ].filter(Boolean).join(' ') },
  { key: 'deflectAttacks', name: 'Deflect Attacks', className: 'Monk', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level, mods }) => [{ key: 'reduce', label: 'Damage reduced', formula: `1d10${signed(level + mods.dex)}` }],
    text: ({ level }) => `Reaction when an attack hits you${level >= 13 ? '' : ' with Bludgeoning, Piercing or Slashing damage'}: take that much less damage.` },
  { key: 'uncannyMetabolism', name: 'Uncanny Metabolism', className: 'Monk', minLevel: 2, max: () => 1, recovery: 'long',
    rolls: ({ level }) => [{ key: 'heal', label: 'Uncanny Metabolism (heal)', formula: `1${MARTIAL_ARTS_DIE(level)}+${level}` }],
    text: ({ level }) => `When you roll Initiative: regain all Focus Points and heal ${MARTIAL_ARTS_DIE(level)} + ${level} HP.` +
      (level >= 15 ? ' Perfect Focus: if you don\'t use it, you still get back up to 4 Focus Points.' : '') },
  { key: 'layOnHands', name: 'Lay On Hands', className: 'Paladin', minLevel: 1, max: ({ level }) => 5 * level, recovery: 'long', pool: true,
    text: () => 'Bonus Action: heal from the pool, or spend 5 to remove the Poisoned condition.' },
  { key: 'channelDivinityPaladin', name: 'Channel Divinity', className: 'Paladin', minLevel: 3, max: ({ level }) => table('Paladin', 'channelDivinity')(level), recovery: 'shortOne',
    rolls: ({ level, subclass }) => subclass === 'Oath of Glory' ? [{ key: 'smite', label: 'Inspiring Smite (temporary HP to share)', formula: `2d8+${level}` }] : [],
    text: ({ level, subclass }) => `Divine Sense${level >= 9 ? ', Abjure Foes' : ''}` +
      ({ 'Oath of Devotion': ', Sacred Weapon', 'Oath of Glory': ', Peerless Athlete, Inspiring Smite', 'Oath of the Ancients': ", Nature's Wrath", 'Oath of Vengeance': ', Vow of Enmity' }[subclass] || '') + '.' },
  { key: 'faithfulSteed', name: 'Faithful Steed', className: 'Paladin', minLevel: 5, max: () => 1, recovery: 'long',
    text: () => 'Cast Find Steed without a spell slot.' },
  { key: 'favoredEnemy', name: "Favored Enemy: Hunter's Mark", className: 'Ranger', minLevel: 1, max: ({ level }) => table('Ranger', 'favoredEnemy')(level), recovery: 'long',
    text: () => "Cast Hunter's Mark without a spell slot." },
  { key: 'psionicDiceRogue', name: 'Psionic Energy Dice', subclass: 'Soulknife', minLevel: 3, max: ({ level }) => PSIONIC_DICE(level), recovery: 'shortOne',
    rolls: ({ level }) => [{ key: 'die', label: 'Psionic Energy die', formula: `1${PSIONIC_DIE(level)}` }],
    rolls: ({ level }) => [
      { key: 'die', label: 'Psionic Energy die', formula: `1${PSIONIC_DIE(level)}` },
      { key: 'knack', label: 'Psi-Bolstered Knack: add to the failed check', formula: `1${PSIONIC_DIE(level)}` },
      { key: 'whispers', label: 'Psychic Whispers: hours', formula: `1${PSIONIC_DIE(level)}` },
      ...(level >= 9 ? [{ key: 'teleport', label: 'Psychic Teleportation: ×10 ft.', formula: `1${PSIONIC_DIE(level)}` }] : [])
    ],
    text: ({ level, pb }) => [
      `Psi-Bolstered Knack: when you fail an ability check with a skill or tool you're proficient in, add a ${PSIONIC_DIE(level)}; the die is spent only if the check then succeeds.`,
      `Psychic Whispers: Magic action, up to ${pb} creatures you can see; roll a ${PSIONIC_DIE(level)} (not spent): you and they can speak telepathically, within 1 mile, for that many hours.`,
      level >= 9 ? `Homing Strikes: a Psychic Blade misses, add a ${PSIONIC_DIE(level)} to the roll (spent only if it hits). Psychic Teleportation: Bonus Action, spend a die, throw a blade and teleport up to 10 × the roll in feet.` : '',
      'A die back on a Short Rest, all on a Long Rest.'
    ].filter(Boolean).join(' ') },
  { key: 'psychicVeil', name: 'Psychic Veil', subclass: 'Soulknife', minLevel: 13, max: () => 1, recovery: 'long',
    text: () => 'Magic action: Invisible for 1 hour, until you deal damage or force a save. Spend a Psionic Energy die to use it again.' },
  { key: 'rendMind', name: 'Rend Mind', subclass: 'Soulknife', minLevel: 17, max: () => 1, recovery: 'long',
    text: ({ mods, pb }) => `Sneak Attack with a Psychic Blade: WIS save (DC ${8 + mods.dex + pb}) or Stunned for 1 minute (save at the end of each turn). Spend 3 Psionic Energy dice to use it again.` },
  { key: 'innateSorcery', name: 'Innate Sorcery', className: 'Sorcerer', minLevel: 1, max: () => 2, recovery: 'long',
    text: () => 'Bonus Action, 1 minute: +1 to your Sorcerer spell save DC and Advantage on Sorcerer spell attacks.' },
  { key: 'sorceryPoints', name: 'Sorcery Points', className: 'Sorcerer', minLevel: 2, max: ({ level }) => table('Sorcerer', 'sorceryPoints')(level), recovery: 'long', pool: true,
    text: ({ level }) => `Metamagic and Flexible Casting.${level >= 5 ? ` Sorcerous Restoration: once per Long Rest, regain up to ${Math.floor(level / 2)} after a Short Rest.` : ''}` },
  { key: 'abyssalAura', name: 'Abyssal Aura', subclass: 'Demonic Sorcery', minLevel: 6, max: () => 1, recovery: 'long',
    text: ({ level }) => `With Innate Sorcery: a ${level >= 14 ? 20 : 10}-ft. Emanation with a random Abyssal effect (d6${level >= 14 ? ', roll twice and choose' : ''}). 2 Sorcery Points restore the use.` },
  { key: 'fiendishServant', name: 'Fiendish Servant', subclass: 'Demonic Sorcery', minLevel: 18, max: () => 1, recovery: 'long',
    text: () => 'Cast Summon Fiend (a Demon) without a spell slot or Material component.' },
  { key: 'magicalCunning', name: 'Magical Cunning', className: 'Warlock', minLevel: 2, max: () => 1, recovery: 'long',
    text: () => 'After a 1-minute rite, regain up to half your Pact Magic slots (rounded up).' },
  { key: 'healingLight', name: 'Healing Light (d6 pool)', subclass: 'Celestial Patron', minLevel: 3, max: ({ level }) => 1 + level, recovery: 'long', pool: true,
    rolls: ({ level, mods }) => Array.from({ length: Math.min(1 + level, Math.max(1, mods.cha)) }, (_, index) => ({ key: `heal${index + 1}`, label: `Healing Light, ${index + 1} ${index ? 'dice' : 'die'}`, formula: `${index + 1}d6` })),
    text: ({ mods }) => `Bonus Action: roll up to ${Math.max(1, mods.cha)} of these d6s to heal a creature within 60 ft.` },
  // Each cast (with a use or a slot) adds one Fey step; Misty Escape (level 6) adds two more.
  { key: 'stepsOfTheFey', name: 'Steps of the Fey', subclass: 'Archfey Patron', minLevel: 3, max: modMin1('cha'), recovery: 'long',
    rolls: ({ level }) => [
      { key: 'refreshing', label: 'Refreshing Step: temporary HP', formula: '1d10' },
      ...(level >= 6 ? [{ key: 'dreadful', label: 'Dreadful Step (Psychic)', formula: '2d10' }] : [])
    ],
    text: ({ level, mods, pb }) => [
      `Cast Misty Step without a spell slot (Bonus Action, teleport up to 30 ft.).`,
      level >= 6 ? `Misty Escape: you can also cast it as a Reaction when you take damage.` : '',
      `Whenever you cast it, choose one:`,
      `Refreshing Step — right after you teleport, you or a creature you can see within 10 ft. gains 1d10 temporary HP;`,
      `Taunting Step — creatures within 5 ft. of the space you left make a WIS save or have Disadvantage on attacks against anyone but you until the start of your next turn${level >= 6 ? ';' : '.'}`,
      level >= 6 ? `Disappearing Step — you are Invisible until the start of your next turn, or until you attack, deal damage or cast a spell;` : '',
      level >= 6 ? `Dreadful Step — creatures within 5 ft. of the space you left or arrive in make a WIS save or take 2d10 Psychic damage.` : '',
      `Save DC ${8 + mods.cha + pb}.`
    ].filter(Boolean).join(' ') },
  { key: 'darkOnesOwnLuck', name: "Dark One's Own Luck", subclass: 'Fiend Patron', minLevel: 6, max: modMin1('cha'), recovery: 'long',
    rolls: () => [{ key: 'die', label: "Dark One's Own Luck", formula: '1d10' }],
    text: () => 'Add a d10 to an ability check or saving throw.' },
  // PHB 2024 subclasses, levels 6–20 and the uses the book counts.
  { key: 'knowYourEnemy', name: 'Know Your Enemy', subclass: 'Battle Master', minLevel: 7, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action: learn the Immunities, Resistances and Vulnerabilities of a creature within 30 ft. A Superiority Die restores it.' },
  { key: 'telekineticMovement', name: 'Telekinetic Movement', subclass: 'Psi Warrior', minLevel: 3, max: () => 1, recovery: 'short',
    text: ({ level }) => 'Magic action: move a Large or smaller loose object or a willing creature up to 30 ft. A Psionic Energy Die restores it.' +
      (level >= 7 ? ' Psi-Powered Leap: Bonus Action, Fly Speed twice your Speed this turn (once per Short Rest, or a die).' : '') +
      (level >= 10 ? ' Guarded Mind: Resistance to Psychic; spend a die at the start of your turn to end Charmed and Frightened.' : '') },
  { key: 'bulwarkOfForce', name: 'Bulwark of Force', subclass: 'Psi Warrior', minLevel: 15, max: () => 1, recovery: 'long',
    text: ({ mods }) => 'Bonus Action: up to ' + Math.max(1, mods.int) + ' creatures within 30 ft. (you included) have Half Cover for 1 minute. A Psionic Energy Die restores it.' },
  { key: 'telekineticMaster', name: 'Telekinetic Master', subclass: 'Psi Warrior', minLevel: 18, max: () => 1, recovery: 'long',
    text: () => 'Cast Telekinesis without a slot or components (INT); a weapon attack as a Bonus Action each turn while concentrating. A Psionic Energy Die restores it.' },
  { key: 'elementalBurst', name: 'Elemental Burst', subclass: 'Warrior of the Elements', minLevel: 6, max: () => 0, info: true,
    rolls: ({ level }) => [{ key: 'burst', label: 'Elemental Burst (DEX save)', formula: '3' + MARTIAL_ARTS_DIE(level) }],
    text: ({ level }) => 'Magic action and 2 Focus Points: a 20-ft. Sphere within 120 ft., DEX save, three Martial Arts dice of Acid, Cold, Fire, Lightning or Thunder (half on a success).' +
      (level >= 11 ? ' Stride of the Elements: Fly and Swim Speed while attuned.' : '') },
  { key: 'gloriousDefense', name: 'Glorious Defense', subclass: 'Oath of Glory', minLevel: 15, max: modMin1('cha'), recovery: 'long',
    text: ({ mods }) => 'Reaction when you or a creature within 10 ft. is hit: +' + Math.max(1, mods.cha) + ' AC against it; if it misses, attack the attacker.' },
  { key: 'livingLegend', name: 'Living Legend', subclass: 'Oath of Glory', minLevel: 20, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action, 1 minute: Advantage on Charisma checks, reroll a failed save as a Reaction, a missed weapon attack hits once per turn. A level 5 slot restores it.' },
  { key: 'undyingSentinel', name: 'Undying Sentinel', subclass: 'Oath of the Ancients', minLevel: 15, max: () => 1, recovery: 'long',
    text: ({ level }) => 'Dropping to 0 HP (not killed outright): drop to 1 HP instead and regain ' + 3 * level + ' HP.' },
  { key: 'elderChampion', name: 'Elder Champion', subclass: 'Oath of the Ancients', minLevel: 20, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action, 1 minute: enemies in your aura have Disadvantage on saves against your spells and Channel Divinity, you regain 10 HP each turn, action spells take a Bonus Action. A level 5 slot restores it.' },
  { key: 'avengingAngel', name: 'Avenging Angel', subclass: 'Oath of Vengeance', minLevel: 20, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action, 10 minutes: Fly 60 ft. (hover); enemies starting their turn in your aura make a WIS save or are Frightened (attacks against them have Advantage). A level 5 slot restores it.' },
  { key: 'dreadfulStrike', name: 'Dreadful Strike', subclass: 'Gloom Stalker', minLevel: 3, max: modMin1('wis'), recovery: 'long',
    rolls: ({ level }) => [{ key: 'psychic', label: 'Dreadful Strike (Psychic)', formula: level >= 11 ? '2d8' : '2d6' }],
    text: ({ level, mods }) => 'Once per turn on a weapon hit: +' + (level >= 11 ? '2d8' : '2d6') + ' Psychic. Initiative +' + Math.max(0, mods.wis) + ' (WIS), +10 ft. Speed on your first turn.' +
      (level >= 11 ? ' Stalker\'s Flurry: also another attack nearby (Sudden Strike) or Frightened in 10 ft. (Mass Fear, WIS save).' : '') },
  { key: 'shadowyDodge', name: 'Shadowy Dodge', subclass: 'Gloom Stalker', minLevel: 15, max: () => 0, info: true,
    text: () => 'Reaction when a creature attacks you: Disadvantage on the roll, then teleport up to 30 ft.' },
  { key: 'primalCompanion', name: 'Primal Companion', subclass: 'Beast Master', minLevel: 3, max: () => 0, info: true,
    text: ({ level }) => 'Your beast (Land, Sea or Sky) acts on your turn: Dodge, or an action when you command it (Bonus Action), or the Beast\'s Strike in place of one of your attacks. A spell slot revives it within an hour.' +
      (level >= 7 ? ' Exceptional Training: also Dash, Disengage, Dodge or Help as its Bonus Action; Force damage if you like.' : '') +
      (level >= 11 ? ' Bestial Fury: two Beast\'s Strikes, +Hunter\'s Mark damage (Force) once per turn.' : '') +
      (level >= 15 ? ' Share Spells: spells on yourself also affect it within 30 ft.' : '') },
  { key: 'spellThief', name: 'Spell Thief', subclass: 'Arcane Trickster', minLevel: 17, max: () => 1, recovery: 'long',
    text: () => 'Reaction after a spell targets you: INT save against your spell save DC, or you negate it and have it prepared for 8 hours.' },
  { key: 'assassinate', name: 'Assassinate', subclass: 'Assassin', minLevel: 3, max: () => 0, info: true,
    text: ({ level }) => 'Advantage on Initiative; in the first round, Advantage against creatures that haven\'t acted, and a Sneak Attack deals +' + level + ' damage.' +
      (level >= 13 ? ' Envenom Weapons: Poison (Cunning Strike) adds 2d6 Poison, ignoring Resistance.' : '') +
      (level >= 17 ? ' Death Strike: a first-round Sneak Attack doubles its damage on a failed CON save.' : '') },
  { key: 'tidesOfChaos', name: 'Tides of Chaos', subclass: 'Wild Magic Sorcery', minLevel: 3, max: () => 1, recovery: 'long',
    rolls: ({ level }) => [
      { key: 'check', label: 'Wild Magic Surge check (a 20 surges)', formula: '1d20' },
      { key: 'surge', label: 'Wild Magic Surge table', formula: '1d100' },
      ...(level >= 6 ? [{ key: 'bend', label: 'Bend Luck', formula: '1d4' }] : [])
    ],
    text: ({ level }) => 'Advantage on one D20 Test; it comes back when you cast a Sorcerer spell with a slot (which then surges) or after a Long Rest.' +
      (level >= 6 ? ' Bend Luck: Reaction and 1 Sorcery Point, ±1d4 to another creature\'s d20.' : '') +
      (level >= 14 ? ' Controlled Chaos: roll the surge table twice and pick.' : '') },
  { key: 'tamedSurge', name: 'Tamed Surge', subclass: 'Wild Magic Sorcery', minLevel: 18, max: () => 1, recovery: 'long',
    text: () => 'After a Sorcerer spell with a slot: choose a Wild Magic Surge effect (not the last row) instead of rolling.' },
  { key: 'beguilingDefenses', name: 'Beguiling Defenses', subclass: 'Archfey Patron', minLevel: 10, max: () => 1, recovery: 'long',
    text: () => 'Reaction when you are hit: halve the damage; WIS save or the attacker takes that much Psychic. A Pact Magic slot restores it.' },
  { key: 'searingVengeance', name: 'Searing Vengeance', subclass: 'Celestial Patron', minLevel: 14, max: () => 1, recovery: 'long',
    rolls: ({ mods }) => [{ key: 'radiant', label: 'Searing Vengeance (Radiant)', formula: '2d8' + signed(mods.cha) }],
    text: () => 'When you or an ally within 60 ft. is about to make a Death Saving Throw: it regains half its HP and stands; creatures of your choice within 30 ft. take 2d8 + CHA Radiant and are Blinded until the end of the turn.' },
  { key: 'clairvoyantCombatant', name: 'Clairvoyant Combatant', subclass: 'Great Old One Patron', minLevel: 6, max: () => 1, recovery: 'short',
    text: () => 'With Awakened Mind: WIS save or the creature has Disadvantage attacking you and you have Advantage attacking it. A Pact Magic slot restores it.' },
  { key: 'arcaneWard', name: 'Arcane Ward', subclass: 'Abjurer', minLevel: 3, max: () => 1, recovery: 'long',
    text: ({ level, mods }) => 'Cast an Abjuration spell with a slot: a ward with ' + Math.max(0, 2 * level + mods.int) + ' HP absorbs your damage until your Long Rest; it regains twice the slot level per Abjuration spell (or a Bonus Action and a slot).' +
      (level >= 6 ? ' Projected Ward: Reaction, it absorbs damage for a creature within 30 ft.' : '') },
  { key: 'portent', name: 'Portent', subclass: 'Diviner', minLevel: 3, max: ({ level }) => (level >= 14 ? 3 : 2), recovery: 'long',
    rolls: () => [{ key: 'roll', label: 'Portent (foretelling roll)', formula: '1d20' }],
    text: () => 'Roll the foretelling d20s after a Long Rest and note them; replace a D20 Test of yours or a creature you can see with one (once per turn).' },
  { key: 'thirdEye', name: 'The Third Eye', subclass: 'Diviner', minLevel: 10, max: () => 1, recovery: 'short',
    text: () => 'Bonus Action until your next rest: Darkvision 120 ft., read any language, or cast See Invisibility without a slot.' },
  { key: 'phantasmalCreatures', name: 'Phantasmal Creatures', subclass: 'Illusionist', minLevel: 6, max: () => 1, recovery: 'long',
    text: () => 'Cast Summon Beast or Summon Fey as Illusion without a slot (half HP); each once per Long Rest.' },
  { key: 'illusorySelf', name: 'Illusory Self', subclass: 'Illusionist', minLevel: 10, max: () => 1, recovery: 'short',
    text: () => 'Reaction when you are hit: the attack misses. A level 2+ slot restores it.' },
  { key: 'handsOfMercy', name: 'Hand of Harm / Hand of Healing', subclass: 'Warrior of Mercy', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level, mods }) => [
      { key: 'harm', label: 'Hand of Harm (Necrotic)', formula: '1' + MARTIAL_ARTS_DIE(level) + signed(mods.wis) },
      { key: 'heal', label: 'Hand of Healing', formula: '1' + MARTIAL_ARTS_DIE(level) + signed(mods.wis) }
    ],
    text: ({ level }) => '1 Focus Point each. Hand of Harm: once per turn on an Unarmed Strike hit, extra Necrotic. Hand of Healing: Magic action, heal a creature you touch (or in place of a Flurry of Blows strike, free).' +
      (level >= 6 ? ' Physician\'s Touch: Harm also Poisons until your next turn; Healing also ends Blinded, Deafened, Paralyzed, Poisoned or Stunned.' : '') },
  { key: 'flurryOfHealingAndHarm', name: 'Flurry of Healing and Harm', subclass: 'Warrior of Mercy', minLevel: 11, max: modMin1('wis'), recovery: 'long',
    text: () => 'With Flurry of Blows: every strike can be a free Hand of Healing, and Hand of Harm costs no Focus Point (once per turn).' },
  { key: 'handOfUltimateMercy', name: 'Hand of Ultimate Mercy', subclass: 'Warrior of Mercy', minLevel: 17, max: () => 1, recovery: 'long',
    rolls: ({ mods }) => [{ key: 'revive', label: 'Hand of Ultimate Mercy (HP)', formula: '4d10' + signed(mods.wis) }],
    text: () => 'Magic action and 5 Focus Points: a creature dead for up to 24 hours returns to life with 4d10 + WIS HP, cured of Blinded, Deafened, Paralyzed, Poisoned and Stunned.' },
  { key: 'feyDreadfulStrikes', name: 'Dreadful Strikes', subclass: 'Fey Wanderer', minLevel: 3, max: () => 0, info: true,
    rolls: ({ level }) => [{ key: 'psychic', label: 'Dreadful Strikes (Psychic)', formula: level >= 11 ? '1d6' : '1d4' }],
    text: ({ level }) => 'Once per turn per target, a weapon hit deals +' + (level >= 11 ? '1d6' : '1d4') + ' Psychic.' +
      (level >= 7 ? ' Beguiling Twist: Reaction when a creature within 120 ft. resists Charmed or Frightened: another creature makes a WIS save or is Charmed or Frightened for 1 minute.' : '') },
  { key: 'feyReinforcements', name: 'Fey Reinforcements: Summon Fey', subclass: 'Fey Wanderer', minLevel: 11, max: () => 1, recovery: 'long',
    text: () => 'Cast Summon Fey without a slot or Material component; optionally without Concentration for 1 minute.' },
  { key: 'mistyWanderer', name: 'Misty Wanderer', subclass: 'Fey Wanderer', minLevel: 15, max: modMin1('wis'), recovery: 'long',
    text: () => 'Cast Misty Step without a slot, taking a willing creature within 5 ft. along.' },
  { key: 'telepathicSpeech', name: 'Telepathic Speech', subclass: 'Aberrant Sorcery', minLevel: 3, max: () => 0, info: true,
    text: ({ level, mods }) => 'Bonus Action: telepathy with a creature within 30 ft., up to ' + Math.max(1, mods.cha) + ' mile(s) apart, for ' + level + ' minutes.' +
      (level >= 6 ? ' Psionic Sorcery: cast your Psionic Spells with Sorcery Points equal to their level, without V, S or ordinary M.' : '') +
      (level >= 14 ? ' Revelation in Flesh: Bonus Action, 1+ Sorcery Points, one benefit each for 10 minutes (swim and breathe water, fly, see Invisible, squeeze through 1 inch).' : '') },
  { key: 'warpingImplosion', name: 'Warping Implosion', subclass: 'Aberrant Sorcery', minLevel: 18, max: () => 1, recovery: 'long',
    rolls: () => [{ key: 'force', label: 'Warping Implosion (Force, STR save)', formula: '3d10' }],
    text: () => 'Magic action: teleport up to 120 ft.; creatures within 30 ft. of where you were make a STR save, 3d10 Force and pulled in (half, not pulled, on a success). 5 Sorcery Points restore it.' },
  { key: 'restoreBalance', name: 'Restore Balance', subclass: 'Clockwork Sorcery', minLevel: 3, max: modMin1('cha'), recovery: 'long',
    rolls: ({ level }) => (level >= 6 ? [1, 2, 3, 4, 5].map(dice => ({ key: 'ward' + dice, label: 'Bastion of Law, ' + dice + ' d8' + (dice > 1 ? 's' : ''), formula: dice + 'd8' })) : []),
    text: ({ level }) => 'Reaction: a d20 roll within 60 ft. with Advantage or Disadvantage is rolled straight.' +
      (level >= 6 ? ' Bastion of Law: Magic action, 1–5 Sorcery Points make a ward of that many d8s on a creature within 30 ft.; it spends dice to reduce damage.' : '') },
  { key: 'tranceOfOrder', name: 'Trance of Order', subclass: 'Clockwork Sorcery', minLevel: 14, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action, 1 minute: attacks against you can\'t have Advantage, and your d20 rolls of 9 or lower count as 10. 5 Sorcery Points restore it.' },
  { key: 'clockworkCavalcade', name: 'Clockwork Cavalcade', subclass: 'Clockwork Sorcery', minLevel: 18, max: () => 1, recovery: 'long',
    text: () => 'Magic action, a 30-ft. Cube: heal up to 100 HP shared out, repair objects, end spells of level 6 and lower. 7 Sorcery Points restore it.' },
  { key: 'arcaneRecovery', name: 'Arcane Recovery', className: 'Wizard', minLevel: 1, max: () => 1, recovery: 'long',
    text: ({ level }) => `After a Short Rest, recover spell slots totalling up to ${Math.ceil(level / 2)} levels (none of level 6+).` },
  // Arcana Unleashed
  { key: 'dispellingRecovery', name: 'Dispelling Recovery', subclass: 'Arcana Domain', minLevel: 6, max: () => 1, recovery: 'short',
    text: () => 'Right after a spell with a slot heals a creature or ends a condition: cast Dispel Magic without a slot. A Channel Divinity use restores it.' },
  { key: 'arcaneShot', name: 'Arcane Shot', subclass: 'Arcane Archer', minLevel: 3, max: modMin1('int'), recovery: 'short',
    rolls: ({ level }) => {
      const die = ARCANE_SHOT_DIE(level);
      return [{ key: 'one', label: `Arcane Shot, one ${die}`, formula: `1${die}` }, { key: 'two', label: `Arcane Shot, two ${die}`, formula: `2${die}` }];
    },
    text: ({ level, mods, pb }) => `Once per turn, on a hit with a weapon with the Ammunition property: apply an Arcane Shot option you know (${byLevel([[3, 2], [7, 3], [10, 4], [15, 5], [18, 6]])(level)} known). Arcane Shot Die ${ARCANE_SHOT_DIE(level)}; save DC ${8 + mods.int + pb}.${level >= 10 ? ' Ever-Ready Shot: one use back when you roll Initiative.' : ''}` },
  { key: 'magicalAmmunition', name: 'Magical Ammunition', subclass: 'Arcane Archer', minLevel: 7, max: () => 1, recovery: 'short',
    text: () => 'Magic action: Darkening (15-ft. shadows, -5 Perception), Unlocking (opens one lock nearby) or Vine (120-ft. climbable vine) ammunition. A Second Wind use restores it.' },
  { key: 'divinePower', name: 'Divine Power (Vestige)', subclass: 'Vestige Patron', minLevel: 3, max: () => 1,
    recovery: ({ level }) => (level >= 6 ? 'short' : 'long'),
    rolls: ({ mods }) => [{ key: 'heal', label: 'Healing Touch (Celestial vestige)', formula: `2d8${signed(mods.cha)}` }],
    text: ({ level }) => "The vestige's Bonus Action: Cursed Invocation (Undead), Fiendish Swap (Fiend) or Healing Touch (Celestial)." + (level >= 6 ? ' Also back with Magical Cunning.' : '') },
  { key: 'vestigeRecovery', name: 'Vestige Recovery', subclass: 'Vestige Patron', minLevel: 10, max: () => 1, recovery: 'long',
    text: () => 'Reaction and a Pact Magic slot when the vestige would drop to 0 HP: it returns to full HP and teleports up to 30 ft.' },
  { key: 'semblanceOfLife', name: 'Semblance of Life', subclass: 'Vestige Patron', minLevel: 14, max: () => 1, recovery: 'long',
    text: ({ level }) => `Magic action: the vestige becomes a Celestial, Fiendish or Undead Spirit (spell level ${Math.min(9, Math.floor(level / 2))}) for 1 hour.` },
  { key: 'benignTransposition', name: 'Benign Transposition', subclass: 'Conjurer', minLevel: 3, max: modMin1('int'), recovery: 'long',
    text: ({ level }) => `Bonus Action: teleport up to ${level >= 6 ? 60 : 30} ft., or swap places with a willing Medium or smaller creature.${level >= 6 ? ' A level 3+ spell slot restores one use.' : ''}` },
  { key: 'splinteredSummons', name: 'Splintered Summons', subclass: 'Conjurer', minLevel: 14, max: () => 1, recovery: 'long',
    text: () => 'A Conjuration spell with a slot that summons a spirit summons two, each with half the HP. A level 5+ slot restores it.' },
  { key: 'hypnoticPresence', name: 'Hypnotic Presence', subclass: 'Enchanter', minLevel: 3, max: modMin1('int'), recovery: 'long',
    text: () => 'Magic action: a creature within 10 ft. makes a WIS save or is Charmed (Incapacitated, Speed 0) for 1 minute, until it is more than 10 ft. away or takes damage.' },
  // "a number of times equal to your Intelligence modifier" (no minimum in the book).
  { key: 'splitEnchantment', name: 'Split Enchantment', subclass: 'Enchanter', minLevel: 6, max: ({ mods }) => Math.max(0, mods.int), recovery: 'long',
    text: () => 'An Enchantment spell with a slot that targets more creatures when upcast counts as one level higher.' },
  { key: 'instinctiveCharm', name: 'Instinctive Charm', subclass: 'Enchanter', minLevel: 10, max: () => 1, recovery: 'long',
    text: () => 'Reaction when a creature within 30 ft. hits you: WIS save or the attack misses and hits another creature in range. Casting an Enchantment spell with a slot restores it.' },
  { key: 'undeadThralls', name: 'Undead Thralls: Animate Dead', subclass: 'Necromancer', minLevel: 6, max: () => 1, recovery: 'long',
    text: () => 'Cast Animate Dead without a spell slot (one level higher if you like).' },
  { key: 'bolsterUndead', name: 'Bolster Undead', subclass: 'Necromancer', minLevel: 14, max: () => 1, recovery: 'long',
    text: ({ level }) => `Bonus Action: your Undead within 60 ft. gain ${level} temporary HP.` },
  { key: 'wondrousAlteration', name: 'Wondrous Alteration: Alter Self', subclass: 'Transmuter', minLevel: 3, max: () => 1, recovery: 'long',
    text: () => 'Cast Alter Self without a spell slot, with an extra benefit for each option.' },
  { key: 'empoweredTransmutation', name: 'Empowered Transmutation', subclass: 'Transmuter', minLevel: 6, max: modMin1('int'), recovery: 'long',
    text: () => 'A Transmutation spell with a slot that makes no attack roll and forces no save counts as one level higher.' },
  { key: 'shapeShifter', name: 'Shape-Shifter: Polymorph', subclass: 'Transmuter', minLevel: 10, max: () => 1, recovery: 'long',
    text: () => 'Cast Polymorph without a spell slot; on yourself you keep your mind, INT, WIS, CHA, proficiencies and features (once per Long Rest).' },
  // Ravenloft: The Horrors Within
  { key: 'spiritualManifestation', name: 'Spiritual Manifestation: Spirit Guardians', subclass: 'College of Spirits', minLevel: 6, max: () => 1, recovery: 'long',
    rolls: () => [{ key: 'power', label: 'Power from Beyond', formula: '1d6' }],
    text: () => 'Cast Spirit Guardians without a spell slot. Once per Short Rest, you and allies in it have Half Cover.' },
  { key: 'sentinelAtDeathsDoor', name: "Sentinel at Death's Door", subclass: 'Grave Domain', minLevel: 6, max: modMin1('wis'), recovery: 'long',
    text: () => "Reaction when you or a Bloodied creature within 60 ft. is hit: halve the damage; a Critical Hit's extra effects are canceled." },
  { key: 'keeperOfSouls', name: 'Keeper of Souls', subclass: 'Grave Domain', minLevel: 17, max: () => 1, recovery: 'short',
    text: ({ level }) => `When an enemy dies within 60 ft.: you or a creature within 60 ft. regains ${2 * level} HP. A level 6+ slot restores it.` },
  { key: 'persistentWrath', name: 'Persistent Wrath', subclass: 'Hollow Warden', minLevel: 15, max: () => 1, recovery: 'long',
    text: ({ level }) => `Dropping to 0 HP while transformed: your HP become ${2 * level} instead. A level 4+ slot restores it.` },
  { key: 'wailsFromTheGrave', name: 'Wails from the Grave', subclass: 'Phantom', minLevel: 3, max: modMin1('dex'), recovery: 'long',
    rolls: ({ level }) => [{ key: 'wail', label: 'Wails from the Grave (Necrotic)', formula: `${WAIL_DICE(level)}d6` }],
    text: ({ level }) => `Right after Sneak Attack: a second creature within 30 ft. of the first takes ${WAIL_DICE(level)}d6 Necrotic.${level >= 9 ? ` Soul trinkets: up to ${level >= 17 ? 4 : level >= 13 ? 3 : 2}; destroy one for a free use.` : ''}${level >= 17 ? " Death's Lament: both creatures take it." : ''}` },
  { key: 'voiceOfDeath', name: 'Voice of Death: Speak with Dead', subclass: 'Phantom', minLevel: 9, max: () => 1, recovery: 'short',
    text: () => 'Cast Speak with Dead without a slot or components (DEX), on a corpse or one of your soul trinkets.' },
  { key: 'ghostWalk', name: 'Ghost Walk', subclass: 'Phantom', minLevel: 13, max: () => 1, recovery: 'long',
    text: () => 'Bonus Action, 10 minutes: Fly 10 ft. (hover), attacks against you have Disadvantage, move through creatures and objects. Destroying a soul trinket restores it.' },
  { key: 'strengthOfTheGrave', name: 'Strength of the Grave', subclass: 'Shadow Sorcery', minLevel: 3, max: () => 1, recovery: 'long',
    text: ({ level, mods }) => `Dropping to 0 HP (not killed outright): CHA save, DC 5 + the damage; on a success your HP become ${Math.max(0, mods.cha + level)}.` },
  { key: 'umbralForm', name: 'Umbral Form', subclass: 'Shadow Sorcery', minLevel: 18, max: () => 1, recovery: 'long',
    text: () => 'With Innate Sorcery: move through creatures and objects, Resistance to all damage but Force and Radiant. 6 Sorcery Points restore it.' },
  { key: 'formOfDread', name: 'Form of Dread', subclass: 'Undead Patron', minLevel: 3, max: modMin1('cha'), recovery: 'long',
    rolls: ({ level }) => [{ key: 'thp', label: 'Facsimile of Life: temporary HP', formula: `1d10+${level}` }],
    text: ({ level }) => `Bonus Action, 1 minute: 1d10 + ${level} temporary HP, immune to Frightened; once per turn a hit forces a WIS save or Frightened.${level >= 14 ? ' Superior Dread: Resistance to Bludgeoning, Piercing and Slashing, Fly Speed, move through creatures and objects.' : ''}` },
  { key: 'unholyResuscitation', name: 'Unholy Resuscitation', subclass: 'Undead Patron', minLevel: 10, max: () => 1, recovery: 'short',
    rolls: ({ mods }) => [{ key: 'burst', label: 'Unholy Resuscitation (Necrotic, CON save)', formula: `2d10${signed(mods.cha)}` }],
    text: ({ level }) => `Dropping to 0 HP (not killed outright): creatures of your choice within 30 ft. take 2d10 + CHA Necrotic (CON save for half); your HP become ${2 * level} and you gain 1 Exhaustion level.` },
  // Artificer (Eberron: Forge of the Artificer; Reanimator from Ravenloft: The Horrors Within)
  { key: 'tinkersMagic', name: "Tinker's Magic", className: 'Artificer', minLevel: 1, max: modMin1('int'), recovery: 'long',
    text: () => "Magic action with Tinker's Tools: create a mundane item from the list (rope, torch, crowbar, caltrops, ...) within 5 ft. It vanishes at your next Long Rest." },
  // Level 14 Refreshed Genius: one use back on a Short Rest; level 20 Magical Guidance: all of them (while attuned to a magic item).
  { key: 'flashOfGenius', name: 'Flash of Genius', className: 'Artificer', minLevel: 7, max: modMin1('int'),
    recovery: ({ level }) => (level >= 20 ? 'short' : level >= 14 ? 'shortOne' : 'long'),
    text: ({ mods, level }) => `Reaction when you or a creature within 30 ft. fails an ability check or saving throw: add +${Math.max(1, mods.int)} to the roll.` +
      (level >= 20 ? ' All uses back on a Short Rest while you are attuned to a magic item.' : level >= 14 ? ' One use back on a Short Rest.' : '') },
  { key: 'experimentalElixir', name: 'Experimental Elixirs', subclass: 'Alchemist', minLevel: 3, max: ({ level }) => byLevel([[3, 2], [5, 3], [9, 4], [15, 5]])(level), recovery: 'long',
    rolls: ({ level, mods }) => [
      { key: 'effect', label: 'Experimental Elixir effect', formula: '1d6' },
      { key: 'healing', label: 'Elixir of Healing', formula: `${level >= 15 ? 4 : level >= 9 ? 3 : 2}d8${signed(mods.int)}` }
    ],
    text: ({ level }) => `Made at the end of a Long Rest (roll each on the table; more for a spell slot, chosen). Bonus Action to drink or give one: ` +
      `1 Healing (${level >= 15 ? 4 : level >= 9 ? 3 : 2}d8 + INT), 2 Swiftness (+${level >= 15 ? 20 : level >= 9 ? 15 : 10} ft. Speed, 1 hour), ` +
      `3 Resilience (+1 AC, ${level >= 15 ? '8 hours' : level >= 9 ? '1 hour' : '10 minutes'}), 4 Boldness (+1d4 to attacks and saves, ${level >= 15 ? '1 hour' : level >= 9 ? '10 minutes' : '1 minute'}), ` +
      `5 Flight (Fly ${level >= 15 ? 30 : level >= 9 ? 20 : 10} ft., 10 minutes), 6 your choice.` },
  { key: 'restorativeReagents', name: 'Restorative Reagents', subclass: 'Alchemist', minLevel: 9, max: modMin1('int'), recovery: 'long',
    text: () => "Cast Lesser Restoration without a spell slot, using Alchemist's Supplies as the focus." },
  { key: 'conjuredCauldron', name: 'Conjured Cauldron', subclass: 'Alchemist', minLevel: 15, max: () => 1, recovery: 'long',
    text: () => "Cast Tasha's Bubbling Cauldron without a spell slot or Material components, using Alchemist's Supplies as the focus." },
  { key: 'armorModel', name: 'Armor Model (Giant Stature / Infiltrator flight)', subclass: 'Armorer', minLevel: 3, max: modMin1('int'), recovery: 'long',
    text: ({ level }) => 'Dreadnaught: Bonus Action, Giant Stature for 1 minute (Large, +5 ft. reach' + (level >= 15 ? '; or +10 ft. and Large or Huge, Advantage on STR checks and saves' : '') + ').' +
      (level >= 15 ? ' Guardian: Reaction when a creature ends its turn within 30 ft., STR save or pulled 25 ft. toward you (then a melee attack). Infiltrator: Bonus Action, Fly Speed twice your Speed this turn.' : '') +
      ' The uses belong to the model you wear.' },
  { key: 'eldritchCannon', name: 'Eldritch Cannon', subclass: 'Artillerist', minLevel: 3, max: () => 1, recovery: 'long',
    rolls: ({ level }) => (level >= 9 ? [{ key: 'detonate', label: 'Detonate (Force, DEX save)', formula: '3d10' }] : []),
    text: ({ level }) => `Magic action with Smith's or Woodcarver's Tools: a Small or Tiny cannon within 5 ft. for 1 hour. Another one costs a spell slot.` +
      (level >= 15 ? ' You can have two cannons at once.' : '') },
  { key: 'arcaneJolt', name: 'Arcane Jolt', subclass: 'Battle Smith', minLevel: 9, max: modMin1('int'), recovery: 'long',
    rolls: ({ level }) => [
      { key: 'damage', label: 'Arcane Jolt (Force)', formula: `${level >= 15 ? 4 : 2}d6` },
      { key: 'heal', label: 'Arcane Jolt (heal)', formula: `${level >= 15 ? 4 : 2}d6` }
    ],
    text: ({ level }) => `Once per turn, when you hit with a magic weapon or your Steel Defender hits: +${level >= 15 ? 4 : 2}d6 Force damage, or heal a creature within 30 ft. of the target for ${level >= 15 ? 4 : 2}d6.` },
  { key: 'illuminatedCartography', name: 'Illuminated Cartography', subclass: 'Cartographer', minLevel: 3, max: modMin1('int'), recovery: 'long',
    text: () => 'Cast Faerie Fire without a spell slot.' },
  { key: 'unerringPath', name: 'Unerring Path', subclass: 'Cartographer', minLevel: 15, max: () => 1, recovery: 'long',
    text: () => 'While you hold one of your Adventurer\'s Atlas maps: cast Find the Path without a spell slot, preparation or components.' },
  // "a number of times equal to your Intelligence modifier" (no minimum in the book).
  { key: 'joltToLife', name: 'Jolt to Life', subclass: 'Reanimator', minLevel: 3, max: ({ mods }) => Math.max(0, mods.int), recovery: 'long',
    rolls: ({ level }) => [{ key: 'damage', label: 'Jolt to Life (Lightning, DEX save)', formula: `${level >= 17 ? 4 : level >= 11 ? 3 : 2}d4` }],
    text: ({ level }) => `Spare the Dying revives the target with ${level} HP; creatures of your choice within 10 ft. of it take ${level >= 17 ? 4 : level >= 11 ? 3 : 2}d4 Lightning (DEX save for half).` },
  { key: 'reanimatedCompanion', name: 'Reanimated Companion', subclass: 'Reanimator', minLevel: 3, max: () => 1, recovery: 'long',
    text: () => 'Magic action with Tinker\'s or other Artisan\'s Tools: create your companion (it lasts until your next Long Rest). Another one costs a spell slot.' },
  { key: 'facilitatedRevival', name: 'Facilitated Revival', subclass: 'Reanimator', minLevel: 15, max: () => 1, recovery: 'long',
    text: () => 'Cast Raise Dead without a spell slot or Material components, using Tinker\'s or other Artisan\'s Tools as the focus.' }
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
      if (!max && !resource.info) continue;
      const recovery = typeof resource.recovery === 'function' ? resource.recovery(context) : resource.recovery;
      result.push({
        key: resource.key,
        name: resource.name,
        source: resource.subclass || resource.className,
        max,
        recovery,
        pool: Boolean(resource.pool),
        text: resource.text(context),
        rolls: resource.rolls ? resource.rolls(context) : []
      });
    }
  }
  return result;
}

// Uses that come from feats (the Paths of Villainy). feats: the character's
// feats (rules/feats.js collectCharacterFeats); same shape as classResources.
function featResources(feats, classRows, scoreOf) {
  const { featName } = require('./feats');
  const names = new Set((feats || []).map(featName));
  const totalLevel = (classRows || []).reduce((sum, row) => sum + row.level, 0);
  const pb = proficiencyBonus(Math.max(1, totalLevel));
  const cha = abilityModifier(scoreOf('cha'));
  const result = [];
  if (names.has('Lucky')) {
    result.push({
      key: 'luckPoints', name: 'Luck Points', source: 'Lucky', max: pb, recovery: 'long', pool: false, rolls: [],
      text: 'Spend 1: Advantage on your own D20 Test, or Disadvantage on an attack roll against you.'
    });
  }
  if (names.has('Death Knight Initiate')) {
    result.push({
      key: 'deathPoints', name: 'Death Points', source: 'Path of the Death Knight', max: pb, recovery: 'long', pool: true,
      text: 'Spend 1 to cast a Death Knight feat spell without a spell slot (Wrathful Smite, Command, Bane, Fear, Find Steed).' +
        (names.has('Death Knight Ascension') ? ` Hellfire Orb: Magic action, spend 1–5, a 20-ft. Sphere within 120 ft.: DEX save (DC ${8 + cha + pb}), 2d6 Fire + 2d6 Necrotic per point (half on a success).` : ''),
      rolls: [
        ...(names.has('Deathly Presence') ? [{ key: 'awful', label: 'Awful Presence: Fear with a Death Point (Psychic)', formula: '2d6' }] : []),
        ...(names.has('Death Knight Ascension')
          ? [1, 2, 3, 4, 5].map(points => ({ key: `orb${points}`, label: `Hellfire Orb, ${points} point${points > 1 ? 's' : ''} (Fire + Necrotic)`, formula: `${2 * points}d6+${2 * points}d6` }))
          : [])
      ]
    });
  }
  // The Lich feats use "your spellcasting ability": the first spellcasting class's.
  const caster = (classRows || []).map(row => spellcastingFor(row.className, row.subclassName)).find(Boolean);
  const spellMod = caster && caster.ability ? abilityModifier(scoreOf(caster.ability))
    : Math.max(...['int', 'wis', 'cha'].map(ability => abilityModifier(scoreOf(ability))));
  if (names.has('Lich Initiate')) {
    result.push({
      key: 'soulSiphon', name: 'Soul Siphon', source: 'Path of the Lich', max: 0, recovery: 'long', pool: false,
      text: 'Reducing a Humanoid enemy to 0 HP (or one within 10 ft. dropping): on your next turn, the first creature you hit takes extra Necrotic damage.' +
        (names.has('Transfer Life') ? ` Soul Transference: a creature within 60 ft. gains ${Math.max(1, pb + spellMod)} temporary HP.` : ''),
      rolls: [{ key: 'siphon', label: 'Soul Siphon (Necrotic)', formula: `1d6${spellMod >= 0 ? '+' : ''}${spellMod}` }]
    });
  }
  if (names.has('Arcane Restoration')) {
    result.push({
      key: 'essenceRejuvenation', name: 'Essence Rejuvenation', source: 'Path of the Lich', max: 1, recovery: 'short', pool: false,
      text: 'When Soul Siphon consumes a soul: recover spell slots with a combined level of up to 4.', rolls: []
    });
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

module.exports = { CLASS_RESOURCES: RESOURCES, classResources, featResources, recoverResources };
