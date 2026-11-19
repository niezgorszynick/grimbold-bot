// rules/bookBackgrounds.js — Backgrounds from Arcana Unleashed, Eberron: Forge of
// the Artificer and Ravenloft: The Horrors Within, in the shape of rules/backgrounds.js.
// Where the book offers "X or a Dark Gift feat", X is the default and the
// creator's Origin feat swap gives the Dark Gift instead; "a Dark Gift of your
// choice" starts with the one the book recommends.

const STR = 'str';
const DEX = 'dex';
const CON = 'con';
const INT = 'int';
const WIS = 'wis';
const CHA = 'cha';

const background = (abilityBoosts, feat, skillProficiencies, toolProficiency, items, gp) => ({
  abilityBoosts, originFeat: { name: feat }, skillProficiencies, toolProficiency, equipment: { items, gp }
});
const chosenTool = name => ({ name, fromToolChoice: true });

const BOOK_BACKGROUNDS = {
  // Arcana Unleashed
  'Agent of the Ninth Quill': background([DEX, INT, CHA], 'Arcane Infiltrator', ['Arcana', 'Sleight of Hand'], "Thieves' Tools",
    ['Dagger', 'Light Hammer', "Thieves' Tools", 'Iron Spikes', 'Rope', "Traveler's Clothes"], 17),
  'Bejeweled Conclave Spy': background([DEX, WIS, CHA], 'Arcane Eloquence', ['Deception', 'Perception'], 'Disguise Kit',
    ['Disguise Kit', 'Fine Clothes', 'Perfume'], 5),
  'Cosmic Dawn Experiment': background([STR, DEX, CON], 'Transmuted Anatomy', ['Athletics', 'Survival'], { choose: 'artisan' },
    [chosenTool("Artisan's Tools"), 'Backpack', 'Robe', "Traveler's Clothes"], 30),
  'Covenant of the Grave Recruit': background([STR, INT, WIS], 'Arcane Undertaker', ['History', 'Medicine'], 'Herbalism Kit',
    ['Dagger', 'Herbalism Kit', 'Book (anatomy)', 'Shovel'], 16),
  'Crucible Storm Chaser': background([STR, CON, INT], 'Arcane Overload', ['Athletics', 'Nature'], "Glassblower's Tools",
    ["Glassblower's Tools", 'Backpack', 'Rope', "Traveler's Clothes"], 15),
  'Familiar Trainer': background([CON, INT, WIS], 'Familiar Friend', ['Animal Handling', 'Arcana'], { choose: 'gamingSet' },
    ['Quarterstaff', chosenTool('Gaming Set'), 'Bedroll', 'Bell', 'String', 'Tinderbox', "Traveler's Clothes", 'Waterskin'], 44),
  'Horizon Weaver Initiate': background([DEX, CON, WIS], 'Portal Jumper', ['Acrobatics', 'Survival'], "Weaver's Tools",
    ['Shortbow', ['Arrow', 20], "Weaver's Tools", 'Map', 'Quiver', 'Rope', "Traveler's Clothes"], 18),
  'Phantasmic Circus Trouper': background([DEX, CON, CHA], 'Arcane Artist', ['Deception', 'Performance'], 'Disguise Kit',
    ['Disguise Kit', { name: 'Gaming Set', choose: 'gamingSet' }, 'Costume', 'Mirror', "Traveler's Clothes"], 12),
  'Seer Apprentice': background([INT, WIS, CHA], 'Arcane Omens', ['History', 'Insight'], "Navigator's Tools",
    ["Navigator's Tools", ['Candle', 8], 'Ink', 'Ink Pen', ['Parchment (sheet)', 9], 'Pouch', 'Tinderbox', "Traveler's Clothes"], 11),
  'Ward of the Sheltering Hands': background([CON, WIS, CHA], 'Arcane Safeguard', ['Insight', 'Medicine'], "Cook's Utensils",
    ["Cook's Utensils", 'Blanket', "Healer's Kit", 'Lamp', ['Oil (flask)', 3], 'Tinderbox', "Traveler's Clothes", 'Waterskin'], 40),
  // Eberron: Forge of the Artificer
  'Aberrant Heir': background([STR, CON, CHA], 'Aberrant Dragonmark', ['History', 'Intimidation'], 'Disguise Kit',
    ['Dagger', 'Disguise Kit', 'Costume', "Traveler's Clothes"], 16),
  Archaeologist: background([DEX, INT, WIS], 'Skilled', ['History', 'Survival'], "Cartographer's Tools",
    ["Cartographer's Tools", 'Bullseye Lantern', 'Map', 'Map or Scroll Case', 'Shovel', 'Tent', "Traveler's Clothes"], 17),
  'House Agent': background([STR, INT, CHA], 'Lucky', ['Investigation', 'Persuasion'], { choose: 'artisan' },
    [chosenTool("Artisan's Tools"), 'Fine Clothes'], 20),
  'House Cannith Heir': background([STR, DEX, INT], 'Mark of Making', ['Investigation', 'Sleight of Hand'], { choose: 'artisan' },
    [chosenTool("Artisan's Tools"), 'Crowbar', 'Fine Clothes', ['Pouch', 2]], 17),
  'House Deneith Heir': background([STR, CON, WIS], 'Mark of Sentinel', ['Insight', 'Perception'], { choose: 'gamingSet' },
    ['Spear', 'Shortbow', ['Arrow', 20], chosenTool('Gaming Set'), 'Fine Clothes', "Healer's Kit", 'Quiver'], 1),
  'House Ghallanda Heir': background([DEX, WIS, CHA], 'Mark of Hospitality', ['Insight', 'Persuasion'], "Cook's Utensils",
    ["Cook's Utensils", 'Fine Clothes', 'Iron Pot', 'Lamp', ['Oil (flask)', 5], 'Perfume'], 26),
  'House Jorasco Heir': background([DEX, CON, WIS], 'Mark of Healing', ['Medicine', 'Stealth'], 'Herbalism Kit',
    ['Herbalism Kit', 'Fine Clothes', "Healer's Kit"], 25),
  'House Kundarak Heir': background([STR, CON, INT], 'Mark of Warding', ['Arcana', 'Investigation'], "Thieves' Tools",
    ["Thieves' Tools", 'Fine Clothes'], 10),
  'House Lyrandar Heir': background([STR, DEX, CHA], 'Mark of Storm', ['Acrobatics', 'Nature'], "Navigator's Tools",
    ["Navigator's Tools", 'Fine Clothes'], 10),
  'House Medani Heir': background([DEX, INT, WIS], 'Mark of Detection', ['Insight', 'Investigation'], 'Disguise Kit',
    ['Disguise Kit', 'Fine Clothes'], 10),
  'House Orien Heir': background([DEX, CON, INT], 'Mark of Passage', ['Acrobatics', 'Athletics'], "Cartographer's Tools",
    ["Cartographer's Tools", 'Fine Clothes', 'Map', 'Map or Scroll Case'], 18),
  'House Phiarlan Heir': background([DEX, WIS, CHA], 'Mark of Shadow', ['Deception', 'Stealth'], 'Disguise Kit',
    ['Disguise Kit', 'Fine Clothes'], 10),
  'House Sivis Heir': background([INT, WIS, CHA], 'Mark of Scribing', ['History', 'Perception'], "Calligrapher's Supplies",
    ["Calligrapher's Supplies", 'Fine Clothes', 'Ink', ['Ink Pen', 5], ['Paper (sheet)', 30], ['Parchment (sheet)', 9]], 8),
  'House Tharashk Heir': background([CON, INT, WIS], 'Mark of Finding', ['Perception', 'Survival'], { choose: 'gamingSet' },
    [chosenTool('Gaming Set'), "Climber's Kit", 'Fine Clothes', 'Hunting Trap', 'Manacles'], 2),
  'House Thuranni Heir': background([DEX, INT, CHA], 'Mark of Shadow', ['Performance', 'Stealth'], { choose: 'instrument' },
    [chosenTool('Musical Instrument'), 'Costume', 'Fine Clothes'], 13),
  'House Vadalis Heir': background([CON, WIS, CHA], 'Mark of Handling', ['Animal Handling', 'Nature'], 'Herbalism Kit',
    ['Herbalism Kit', 'Fine Clothes', 'Net'], 29),
  Inquisitive: background([CON, INT, CHA], 'Alert', ['Insight', 'Investigation'], "Thieves' Tools",
    ["Thieves' Tools", 'Bullseye Lantern', 'Crowbar', ['Oil (flask)', 10], "Traveler's Clothes"], 10),
  // Ravenloft: The Horrors Within
  'Haunted One': background([CON, WIS, CHA], 'Survivor', ['Arcana', 'Survival'], { choose: 'gamingSet' },
    [chosenTool('Gaming Set'), 'Crowbar', 'Holy Water (flask)', 'Mirror', ['Oil (flask)', 2], 'Signal Whistle', 'Tinderbox', "Traveler's Clothes", ['Torch', 5], 'Waterskin'], 14),
  Investigator: background([INT, WIS, CHA], 'Sharp Eye', ['Insight', 'Investigation'], 'Disguise Kit',
    ['Disguise Kit', 'Manacles', 'Shovel', "Traveler's Clothes", ['Vial', 3]], 16),
  'Mist Wanderer': background([DEX, CON, WIS], 'Mist Walker', ['Survival', 'Stealth'], { choose: 'artisan' },
    [chosenTool("Artisan's Tools"), 'Lamp', ['Oil (flask)', 5], 'Pouch', 'Rope', 'Tinderbox', "Traveler's Clothes"], 30),
  'Spirit Medium': background([CON, INT, WIS], 'Gathered Whispers', ['Insight', 'Religion'], { choose: 'gamingSet' },
    ['Dagger', chosenTool('Gaming Set'), 'Basket', 'Bell', ['Candle', 8], 'Ink', 'Ink Pen', ['Paper (sheet)', 5], 'Tinderbox', "Traveler's Clothes"], 32)
};

module.exports = { BOOK_BACKGROUNDS };
