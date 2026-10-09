// rules/equipment.js — Tool, instrument, gaming set and language lists (2024 PHB).

const ARTISANS_TOOLS = [
  "Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies", "Carpenter's Tools",
  "Cartographer's Tools", "Cobbler's Tools", "Cook's Utensils", "Glassblower's Tools",
  "Jeweler's Tools", "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
  "Potter's Tools", "Smith's Tools", "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools"
];

const MUSICAL_INSTRUMENTS = [
  'Bagpipes', 'Drum', 'Dulcimer', 'Flute', 'Horn', 'Lute', 'Lyre', 'Pan Flute', 'Shawm', 'Viol'
];

const GAMING_SETS = ['Dice', 'Dragonchess', 'Playing Cards', 'Three-Dragon Ante'];

const OTHER_TOOLS = [
  'Disguise Kit', 'Forgery Kit', 'Herbalism Kit', "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools"
];

const TOOL_CATEGORIES = {
  artisan: ARTISANS_TOOLS,
  instrument: MUSICAL_INSTRUMENTS,
  gamingSet: GAMING_SETS,
  any: [...ARTISANS_TOOLS, ...MUSICAL_INSTRUMENTS, ...GAMING_SETS, ...OTHER_TOOLS]
};

const STANDARD_LANGUAGES = [
  'Common', 'Common Sign Language', 'Draconic', 'Dwarvish', 'Elvish',
  'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc'
];

const RARE_LANGUAGES = [
  'Abyssal', 'Celestial', 'Deep Speech', 'Druidic', 'Infernal',
  'Primordial', 'Sylvan', "Thieves' Cant", 'Undercommon'
];

// Every 2024 character knows Common plus two standard languages of their choice.
const STARTING_LANGUAGE_CHOICES = 2;

module.exports = {
  ARTISANS_TOOLS,
  MUSICAL_INSTRUMENTS,
  GAMING_SETS,
  OTHER_TOOLS,
  TOOL_CATEGORIES,
  STANDARD_LANGUAGES,
  RARE_LANGUAGES,
  STARTING_LANGUAGE_CHOICES
};
