// rules/species.js — The 10 species from the 2024 Player's Handbook, plus those of
// Eberron: Forge of the Artificer and Ravenloft: The Horrors Within. Trait texts
// here are short summaries; the book text comes from rules/content/species.md.

const DND_SPECIES_DATA = {
  Aasimar: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Celestial Resistance', description: 'You resist radiant and necrotic damage.' },
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Healing Hands', description: 'Once per Long Rest, touch a creature to restore Hit Points by rolling a number of d4s equal to your Proficiency Bonus.' },
      { name: 'Light Bearer', description: 'You know the Light cantrip; Charisma is your spellcasting ability for it.' },
      { name: 'Celestial Revelation', description: 'Once per Long Rest, reveal your celestial nature for 1 minute, choosing an option that grants wings, radiant energy, or a frightening aura.' }
    ]
  },
  Dragonborn: {
    size: 'Medium', speed: 30, traits: [
      { name: 'Draconic Ancestry', description: 'Choose a dragon ancestry; it determines the damage type and shape of your Breath Weapon.' },
      { name: 'Breath Weapon', description: 'Exhale damaging energy in a cone or line. Uses scale with your Proficiency Bonus and return after a Long Rest.' },
      { name: 'Damage Resistance', description: 'You resist the damage type associated with your draconic ancestry.' },
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' }
    ]
  },
  Dwarf: {
    size: 'Medium', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 120 feet, though only in shades of gray.' },
      { name: 'Dwarven Resilience', description: 'You have advantage on saves against Poisoned and resistance to poison damage.' },
      { name: 'Dwarven Toughness', description: 'Your Hit Point maximum increases by 1 for each character level you have.' },
      { name: 'Stonecunning', description: 'As a Bonus Action, gain Tremorsense out to 60 feet for 10 minutes; uses scale with your Proficiency Bonus and return after a Long Rest.' }
    ]
  },
  Elf: {
    size: 'Medium', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Elven Lineage', description: 'Choose a lineage—Drow, High Elf, or Wood Elf—which grants spells as you gain character levels.' },
      { name: 'Fey Ancestry', description: 'You have advantage on saves to avoid or end the Charmed condition on yourself.' },
      { name: 'Keen Senses', description: 'You have proficiency in the Insight, Perception, or Survival skill.' },
      { name: 'Trance', description: 'You do not need to sleep, and magic cannot put you to sleep. Meditation lets you finish a Long Rest in 4 hours.' }
    ],
    skillChoiceCount: 1,
    skillChoiceOptions: ['Insight', 'Perception', 'Survival']
  },
  Gnome: {
    size: 'Small', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Gnomish Cunning', description: 'You have advantage on Intelligence, Wisdom, and Charisma saves against magical effects.' },
      { name: 'Gnomish Lineage', description: 'Choose a lineage—Forest Gnome or Rock Gnome—which grants magical abilities.' }
    ]
  },
  Goliath: {
    size: 'Medium', speed: 35, traits: [
      { name: 'Giant Ancestry', description: 'Choose a giant type to gain a special ability, such as teleporting, dealing elemental damage, or reducing incoming damage.' },
      { name: 'Large Form', description: 'As a Bonus Action, become Large for 10 minutes if space allows; your Speed increases by 10 feet. Uses scale with your Proficiency Bonus and return after a Long Rest.' },
      { name: 'Powerful Build', description: 'You have advantage on checks to end the Grappled condition, and count as one size larger when determining carrying capacity.' }
    ]
  },
  Halfling: {
    size: 'Small', speed: 30, traits: [
      { name: 'Brave', description: 'You have advantage on saves to avoid or end the Frightened condition on yourself.' },
      { name: 'Halfling Nimbleness', description: 'You can move through the space of a creature that is larger than you.' },
      { name: 'Luck', description: 'When you roll a 1 on a d20 Test, you can reroll the die; you must use the new roll.' },
      { name: 'Naturally Stealthy', description: 'You can take the Hide action even when you are obscured only by a creature at least one size larger than you.' }
    ]
  },
  Human: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Resourceful', description: 'You gain Heroic Inspiration whenever you finish a Long Rest.' },
      { name: 'Skillful', description: 'You gain proficiency in one skill of your choice.' },
      { name: 'Versatile', description: 'You gain one Origin feat of your choice.' }
    ],
    skillChoiceCount: 1
  },
  Orc: {
    size: 'Medium', speed: 30, traits: [
      { name: 'Adrenaline Rush', description: 'As a Bonus Action, move up to your Speed and gain Temporary Hit Points. Uses scale with your Proficiency Bonus and return after a Short or Long Rest.' },
      { name: 'Darkvision', description: 'You can see in darkness up to 120 feet, though only in shades of gray.' },
      { name: 'Relentless Endurance', description: 'When reduced to 0 Hit Points but not killed outright, drop to 1 Hit Point instead. Once per Long Rest.' }
    ]
  },
  Tiefling: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Fiendish Legacy', description: 'Choose an Abyssal, Chthonic, or Infernal legacy that grants spells as you gain character levels.' },
      { name: 'Otherworldly Presence', description: 'You know the Thaumaturgy cantrip; Charisma is your spellcasting ability for it.' }
    ]
  },
  // Eberron: Forge of the Artificer
  Changeling: {
    size: 'Medium or Small', speed: 30, creatureType: 'Fey', traits: [
      { name: 'Changeling Instincts', description: 'Proficiency in two of Deception, Insight, Intimidation, Performance and Persuasion.' },
      { name: 'Shape-Shifter', description: 'As an action, change your appearance, voice and size (Medium or Small); Advantage on Charisma checks while shape-shifted.' }
    ],
    skillChoiceCount: 2,
    skillChoiceOptions: ['Deception', 'Insight', 'Intimidation', 'Performance', 'Persuasion']
  },
  Kalashtar: {
    size: 'Medium', speed: 30, creatureType: 'Aberration', traits: [
      { name: 'Dual Mind', description: 'Advantage on Wisdom and Charisma saving throws.' },
      { name: 'Mental Discipline', description: 'Resistance to Psychic damage.' },
      { name: 'Mind Link', description: 'Telepathy out to 10 feet times your level; a Magic action lets the creature answer you telepathically for 1 hour.' },
      { name: 'Severed from Dreams', description: "The Dream spell can't target you. After each Long Rest, gain proficiency in one skill until the next Long Rest." }
    ]
  },
  Khoravar: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Fey Ancestry', description: 'Advantage on saves to avoid or end the Charmed condition.' },
      { name: 'Fey Gift', description: 'You know Friends; after a Long Rest you can swap it for a Cleric, Druid or Wizard cantrip (INT, WIS or CHA).' },
      { name: 'Lethargy Resilience', description: 'Turn a failed save against Unconscious into a success; then wait 1d4 Long Rests.' },
      { name: 'Skill Versatility', description: 'Proficiency in one skill or tool, which you can change after a Long Rest.' }
    ],
    skillChoiceCount: 1
  },
  Shifter: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Bestial Instincts', description: 'Proficiency in Acrobatics, Athletics, Intimidation or Survival.' },
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Shifting', description: 'Bonus Action, 1 minute: a bestial form with 2 × Proficiency Bonus Temporary Hit Points and the benefit of your shifter type. Proficiency Bonus uses per Long Rest.' }
    ],
    skillChoiceCount: 1,
    skillChoiceOptions: ['Acrobatics', 'Athletics', 'Intimidation', 'Survival']
  },
  Warforged: {
    size: 'Medium or Small', speed: 30, creatureType: 'Construct', acBonus: 1, traits: [
      { name: 'Construct Resilience', description: 'Resistance to Poison damage; Advantage on saves to avoid or end Poisoned.' },
      { name: 'Integrated Protection', description: "+1 to your Armor Class; your armor can't be removed against your will." },
      { name: "Sentry's Rest", description: "You don't need to sleep and magic can't put you to sleep; a Long Rest takes 6 hours of inactivity." },
      { name: 'Specialized Design', description: 'Proficiency in one skill and one tool of your choice.' },
      { name: 'Tireless', description: "No Exhaustion from dehydration, malnutrition or suffocation." }
    ],
    skillChoiceCount: 1
  },
  // Ravenloft: The Horrors Within
  Dhampir: {
    size: 'Medium or Small', speed: 35, climbSpeed: true, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Spider Climb', description: 'A Climb Speed equal to your Speed; from level 3, walls and ceilings with your hands free.' },
      { name: 'Trace of Undeath', description: 'Resistance to Necrotic damage.' },
      { name: 'Vampiric Bite', description: 'Unarmed Strike bite: 1d4 + CON Piercing. Proficiency Bonus times per Long Rest, heal that much or add it to your next check or attack.' }
    ]
  },
  Hexblood: {
    size: 'Medium or Small', speed: 30, creatureType: 'Fey', traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Eerie Token', description: 'Bonus Action, once per Long Rest: a token for sending messages to its holder and seeing and hearing through it, within 10 miles.' },
      { name: 'Hex Magic', description: 'Disguise Self and Hex always prepared, each once per Long Rest without a slot (INT, WIS or CHA).' }
    ]
  },
  Lupin: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Darkvision', description: 'You can see in darkness up to 60 feet, though only in shades of gray.' },
      { name: 'Feral Pounce', description: 'Unarmed Strikes deal Slashing damage; once per turn in the Attack action, use both Damage and Shove.' },
      { name: 'Howl', description: 'Bonus Action: creatures of your choice within 15 ft. make a WIS save (DC 8 + CON + PB) or have Disadvantage on attacks and saves. Proficiency Bonus uses per Long Rest.' },
      { name: 'Werewolf Instincts', description: 'Proficiency in Perception, Stealth or Survival.' }
    ],
    skillChoiceCount: 1,
    skillChoiceOptions: ['Perception', 'Stealth', 'Survival']
  },
  Reborn: {
    size: 'Medium or Small', speed: 30, traits: [
      { name: 'Escaped Death', description: 'Advantage on Death Saving Throws.' },
      { name: 'Everlasting', description: "No Exhaustion from dehydration, malnutrition or suffocation; no sleep needed, and magic can't put you to sleep. A Long Rest takes 4 hours." },
      { name: 'Knowledge from a Past Life', description: 'Proficiency in one skill. Proficiency Bonus times per Long Rest, add 1d6 to a failed ability check.' },
      { name: 'Strange Endurance', description: 'Resistance to Cold, Necrotic or Poison damage (your choice).' }
    ],
    skillChoiceCount: 1
  }
};
const DND_SPECIES = Object.keys(DND_SPECIES_DATA);

// Choices a species requires at character creation. spellAbilityChoice means the
// player picks Intelligence, Wisdom or Charisma for the spells the option grants.
const SPECIES_OPTIONS = {
  Dragonborn: {
    label: 'Draconic Ancestry',
    options: ['Black (Acid)', 'Blue (Lightning)', 'Brass (Fire)', 'Bronze (Lightning)', 'Copper (Acid)',
      'Gold (Fire)', 'Green (Poison)', 'Red (Fire)', 'Silver (Cold)', 'White (Cold)']
  },
  Elf: { label: 'Elven Lineage', options: ['Drow', 'High Elf', 'Wood Elf'], spellAbilityChoice: true },
  Gnome: { label: 'Gnomish Lineage', options: ['Forest Gnome', 'Rock Gnome'], spellAbilityChoice: true },
  Goliath: {
    label: 'Giant Ancestry',
    options: ["Cloud's Jaunt", "Fire's Burn", "Frost's Chill", "Hill's Tumble", "Stone's Endurance", "Storm's Thunder"]
  },
  Tiefling: { label: 'Fiendish Legacy', options: ['Abyssal', 'Chthonic', 'Infernal'], spellAbilityChoice: true },
  // A single option: only the spellcasting ability is really chosen.
  Khoravar: { label: 'Fey Gift', options: ['Friends'], spellAbilityChoice: true },
  Shifter: { label: 'Shifter Type', options: ['Beasthide', 'Longtooth', 'Swiftstride', 'Wildhunt'] },
  Hexblood: { label: 'Hex Magic', options: ['Disguise Self and Hex'], spellAbilityChoice: true },
  Reborn: { label: 'Strange Endurance', options: ['Cold', 'Necrotic', 'Poison'] }
};

// Species whose size is "Medium or Small" let the player choose.
function sizeOptions(speciesName) {
  const species = DND_SPECIES_DATA[speciesName];
  if (!species) return [];
  return species.size === 'Medium or Small' ? ['Medium', 'Small'] : [species.size];
}

// Lineages that change the species' Speed (Wood Elf: Speed 35 ft.).
const LINEAGE_SPEED = { 'Elf:Wood Elf': 35 };

// Walking speed in feet for a species and its chosen lineage (if any).
function speciesSpeed(species, option) {
  const lineage = LINEAGE_SPEED[`${species}:${option}`];
  if (lineage) return lineage;
  return (DND_SPECIES_DATA[species] || {}).speed || 30;
}

// The book text of a species' traits from rules/content/species.md ("## Elf" with
// "### Darkvision" sections), by trait name, plus its description. {} without it.
function speciesTraitTexts(speciesName) {
  const { loadContent } = require('./content');
  const entry = loadContent('species')[speciesName];
  if (!entry) return { description: '', traits: {} };
  return { description: entry.description || '', traits: Object.fromEntries(Object.entries(entry.sections).filter(([, text]) => text)) };
}

module.exports = { DND_SPECIES_DATA, DND_SPECIES, SPECIES_OPTIONS, LINEAGE_SPEED, speciesSpeed, sizeOptions, speciesTraitTexts };
