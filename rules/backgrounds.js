// rules/backgrounds.js — The 16 backgrounds from the 2024 Player's Handbook.
//
// Each background grants: three abilities to boost (+2/+1 or +1/+1/+1, max 20),
// an Origin feat, two skill proficiencies, one tool proficiency, and a choice
// between equipment package A or 50 GP (package B).
//
// toolProficiency is either a fixed tool name or { choose: <TOOL_CATEGORIES key> }.
// An equipment entry with { fromToolChoice: true } is the tool picked for the proficiency.

const { normalizeItems } = require('./util');

const BACKGROUND_GOLD_OPTION = 50;

const RAW_BACKGROUNDS = {
  Acolyte: {
    abilityBoosts: ['int', 'wis', 'cha'],
    originFeat: { name: 'Magic Initiate', spellList: 'Cleric' },
    skillProficiencies: ['Insight', 'Religion'],
    toolProficiency: "Calligrapher's Supplies",
    equipment: { items: ["Calligrapher's Supplies", 'Book (prayers)', 'Holy Symbol', ['Parchment (sheet)', 10], 'Robe'], gp: 8 }
  },
  Artisan: {
    abilityBoosts: ['str', 'dex', 'int'],
    originFeat: { name: 'Crafter' },
    skillProficiencies: ['Investigation', 'Persuasion'],
    toolProficiency: { choose: 'artisan' },
    equipment: { items: [{ name: "Artisan's Tools", fromToolChoice: true }, ['Pouch', 2], "Traveler's Clothes"], gp: 32 }
  },
  Charlatan: {
    abilityBoosts: ['dex', 'con', 'cha'],
    originFeat: { name: 'Skilled' },
    skillProficiencies: ['Deception', 'Sleight of Hand'],
    toolProficiency: 'Forgery Kit',
    equipment: { items: ['Forgery Kit', 'Costume', 'Fine Clothes'], gp: 15 }
  },
  Criminal: {
    abilityBoosts: ['dex', 'con', 'int'],
    originFeat: { name: 'Alert' },
    skillProficiencies: ['Sleight of Hand', 'Stealth'],
    toolProficiency: "Thieves' Tools",
    equipment: { items: [['Dagger', 2], "Thieves' Tools", 'Crowbar', ['Pouch', 2], "Traveler's Clothes"], gp: 16 }
  },
  Entertainer: {
    abilityBoosts: ['str', 'dex', 'cha'],
    originFeat: { name: 'Musician' },
    skillProficiencies: ['Acrobatics', 'Performance'],
    toolProficiency: { choose: 'instrument' },
    equipment: { items: [{ name: 'Musical Instrument', fromToolChoice: true }, ['Costume', 2], 'Mirror', 'Perfume', "Traveler's Clothes"], gp: 11 }
  },
  Farmer: {
    abilityBoosts: ['str', 'con', 'wis'],
    originFeat: { name: 'Tough' },
    skillProficiencies: ['Animal Handling', 'Nature'],
    toolProficiency: "Carpenter's Tools",
    equipment: { items: ['Sickle', "Carpenter's Tools", "Healer's Kit", 'Iron Pot', 'Shovel', "Traveler's Clothes"], gp: 30 }
  },
  Guard: {
    abilityBoosts: ['str', 'int', 'wis'],
    originFeat: { name: 'Alert' },
    skillProficiencies: ['Athletics', 'Perception'],
    toolProficiency: { choose: 'gamingSet' },
    equipment: { items: ['Spear', 'Light Crossbow', ['Bolt', 20], { name: 'Gaming Set', fromToolChoice: true }, 'Hooded Lantern', 'Manacles', 'Quiver', "Traveler's Clothes"], gp: 12 }
  },
  Guide: {
    abilityBoosts: ['dex', 'con', 'wis'],
    originFeat: { name: 'Magic Initiate', spellList: 'Druid' },
    skillProficiencies: ['Stealth', 'Survival'],
    toolProficiency: "Cartographer's Tools",
    equipment: { items: ['Shortbow', ['Arrow', 20], "Cartographer's Tools", 'Bedroll', 'Quiver', 'Tent', "Traveler's Clothes"], gp: 3 }
  },
  Hermit: {
    abilityBoosts: ['con', 'wis', 'cha'],
    originFeat: { name: 'Healer' },
    skillProficiencies: ['Medicine', 'Religion'],
    toolProficiency: 'Herbalism Kit',
    equipment: { items: ['Quarterstaff', 'Herbalism Kit', 'Bedroll', 'Book (philosophy)', 'Lamp', ['Oil (flask)', 3], "Traveler's Clothes"], gp: 16 }
  },
  Merchant: {
    abilityBoosts: ['con', 'int', 'cha'],
    originFeat: { name: 'Lucky' },
    skillProficiencies: ['Animal Handling', 'Persuasion'],
    toolProficiency: "Navigator's Tools",
    equipment: { items: ["Navigator's Tools", ['Pouch', 2], "Traveler's Clothes"], gp: 22 }
  },
  Noble: {
    abilityBoosts: ['str', 'int', 'cha'],
    originFeat: { name: 'Skilled' },
    skillProficiencies: ['History', 'Persuasion'],
    toolProficiency: { choose: 'gamingSet' },
    equipment: { items: [{ name: 'Gaming Set', fromToolChoice: true }, 'Fine Clothes', 'Perfume'], gp: 29 }
  },
  Sage: {
    abilityBoosts: ['con', 'int', 'wis'],
    originFeat: { name: 'Magic Initiate', spellList: 'Wizard' },
    skillProficiencies: ['Arcana', 'History'],
    toolProficiency: "Calligrapher's Supplies",
    equipment: { items: ['Quarterstaff', "Calligrapher's Supplies", 'Book (history)', ['Parchment (sheet)', 8], 'Robe'], gp: 8 }
  },
  Sailor: {
    abilityBoosts: ['str', 'dex', 'wis'],
    originFeat: { name: 'Tavern Brawler' },
    skillProficiencies: ['Acrobatics', 'Perception'],
    toolProficiency: "Navigator's Tools",
    equipment: { items: ['Dagger', "Navigator's Tools", 'Rope', "Traveler's Clothes"], gp: 20 }
  },
  Scribe: {
    abilityBoosts: ['dex', 'int', 'wis'],
    originFeat: { name: 'Skilled' },
    skillProficiencies: ['Investigation', 'Perception'],
    toolProficiency: "Calligrapher's Supplies",
    equipment: { items: ["Calligrapher's Supplies", 'Fine Clothes', 'Lamp', ['Oil (flask)', 3], ['Parchment (sheet)', 12]], gp: 23 }
  },
  Soldier: {
    abilityBoosts: ['str', 'dex', 'con'],
    originFeat: { name: 'Savage Attacker' },
    skillProficiencies: ['Athletics', 'Intimidation'],
    toolProficiency: { choose: 'gamingSet' },
    equipment: { items: ['Spear', 'Shortbow', ['Arrow', 20], { name: 'Gaming Set', fromToolChoice: true }, "Healer's Kit", 'Quiver', "Traveler's Clothes"], gp: 14 }
  },
  Wayfarer: {
    abilityBoosts: ['dex', 'wis', 'cha'],
    originFeat: { name: 'Lucky' },
    skillProficiencies: ['Insight', 'Stealth'],
    toolProficiency: "Thieves' Tools",
    equipment: { items: [['Dagger', 2], "Thieves' Tools", { name: 'Gaming Set', choose: 'gamingSet' }, 'Bedroll', ['Pouch', 2], "Traveler's Clothes"], gp: 16 }
  }
};

const BACKGROUNDS = Object.fromEntries(Object.entries(RAW_BACKGROUNDS).map(([name, background]) => [
  name,
  {
    ...background,
    equipmentOptions: {
      A: { items: normalizeItems(background.equipment.items), gp: background.equipment.gp },
      B: { items: [], gp: BACKGROUND_GOLD_OPTION }
    }
  }
]));
for (const background of Object.values(BACKGROUNDS)) delete background.equipment;

module.exports = { BACKGROUNDS, BACKGROUND_GOLD_OPTION };
