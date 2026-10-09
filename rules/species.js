// rules/species.js — The 10 species from the 2024 Player's Handbook.

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
      { name: 'Lucky', description: 'When you roll a 1 on a d20 Test, you can reroll the die; you must use the new roll.' }
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
  Tiefling: { label: 'Fiendish Legacy', options: ['Abyssal', 'Chthonic', 'Infernal'], spellAbilityChoice: true }
};

// Species whose size is "Medium or Small" let the player choose.
function sizeOptions(speciesName) {
  const species = DND_SPECIES_DATA[speciesName];
  if (!species) return [];
  return species.size === 'Medium or Small' ? ['Medium', 'Small'] : [species.size];
}

module.exports = { DND_SPECIES_DATA, DND_SPECIES, SPECIES_OPTIONS, sizeOptions };
