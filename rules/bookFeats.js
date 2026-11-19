// rules/bookFeats.js — Feats from Arcana Unleashed, Eberron: Forge of the
// Artificer and Ravenloft: The Horrors Within, in the shapes rules/feats.js
// uses (their text is in rules/content/feats.md, kept off Git).
//
// Spell grants beyond the PHB feats' (handled by rules/spellbook.js):
//   later: [[character level, [spells]]] — always prepared from that level, cast like `fixed`
//   bySlotLevel: [[slot level, spell]] — the Adept feats: prepared once you have slots of that level
//   cantripChoice: { list, count } — cantrips picked from a class list
//   choose.list — the picked level 1+ spells come from that class list
//   markList — Spells of the Mark: added to the character's class spell lists
// Categories: `category: 'Dragonmark'` (one per character) and 'Dark Gift' sit
// with the Origin feats (backgrounds and feat choices offer them).

const MENTAL = ['int', 'wis', 'cha'];
const ANY = 'any';

const castOnce = (fixed, extra = {}) => ({ fixed, chooseAbility: true, freeEach: 1, ...extra });

// Origin-category feats (plus Dragonmark and Dark Gift feats).
const BOOK_ORIGIN_FEATS = {
  // Arcana Unleashed
  'Arcane Artist': { repeatable: false, grants: { spells: { cantrips: ['Minor Illusion'], chooseAbility: true } } },
  'Arcane Eloquence': { repeatable: false, grants: { spells: { cantrips: ['Vicious Mockery'], chooseAbility: true } } },
  'Arcane Infiltrator': { repeatable: false, grants: { spells: { cantrips: ['Friends'], chooseAbility: true } } },
  'Arcane Omens': { repeatable: false, grants: { spells: { cantrips: ['Guidance'], chooseAbility: true } } },
  'Arcane Overload': { repeatable: false, grants: { spells: { cantrips: ['Fire Bolt'], chooseAbility: true } } },
  'Arcane Safeguard': { repeatable: false, grants: { spells: { cantrips: ['Resistance'], chooseAbility: true } } },
  // A Cleric or Wizard Necromancy cantrip: picked on the Spells page.
  'Arcane Undertaker': { repeatable: false, grants: { spells: { cantripChoice: { lists: ['Cleric', 'Wizard'], schools: ['Necromancy'], count: 1 }, chooseAbility: true } } },
  'Familiar Friend': { repeatable: false, grants: { spells: castOnce(['Find Familiar']) } },
  'Portal Jumper': { repeatable: false, grants: {} },
  'Transmuted Anatomy': { repeatable: false, grants: { speedBonus: 5 } },
  // Ravenloft: The Horrors Within
  'Sharp Eye': { repeatable: false, grants: {} },
  Survivor: { repeatable: false, grants: {} },
  'Aberrant Anatomy': { category: 'Dark Gift', repeatable: false, grants: { skills: ['Perception'], expertise: ['Perception'] } },
  'Echoing Soul': { category: 'Dark Gift', repeatable: false, grants: {} },
  'Gathered Whispers': { category: 'Dark Gift', repeatable: false, grants: { spells: { cantrips: ['Message'], fixed: ['Augury'], chooseAbility: true, freeEach: 1 } } },
  'Living Shadow': { category: 'Dark Gift', repeatable: false, grants: { spells: { cantrips: ['Mage Hand'], chooseAbility: true } } },
  'Mist Walker': { category: 'Dark Gift', repeatable: false, grants: {} },
  'Second Skin': { category: 'Dark Gift', repeatable: false, grants: { spells: { fixed: ['Alter Self'], chooseAbility: true, freeEach: 1 } } },
  'Symbiotic Being': { category: 'Dark Gift', repeatable: false, grants: {} },
  'Touch of Death': { category: 'Dark Gift', repeatable: false, grants: { spells: { cantrips: ['Chill Touch'], chooseAbility: true } } },
  'Watchers': { category: 'Dark Gift', repeatable: false, grants: { spells: castOnce(['Beast Sense', 'Speak with Animals']) } },
  // Eberron: Forge of the Artificer
  'Aberrant Dragonmark': {
    category: 'Dragonmark', repeatable: false,
    grants: { spells: { cantripChoice: { lists: ['Sorcerer'], count: 1 }, choose: { count: 1, level: 1, list: 'Sorcerer' }, ability: 'con', freeEach: 1 } }
  },
  'Mark of Detection': mark(['Detect Magic', 'Detect Poison and Disease'], { later: [[3, ['See Invisibility']]] },
    ['Detect Evil and Good', 'Identify', 'Detect Thoughts', 'Find Traps', 'Clairvoyance', 'Nondetection', 'Arcane Eye', 'Divination', 'Legend Lore']),
  'Mark of Finding': mark(["Hunter's Mark"], { later: [[3, ['Locate Object']]] },
    ['Faerie Fire', 'Longstrider', 'Locate Animals or Plants', 'Mind Spike', 'Clairvoyance', 'Speak with Plants', 'Divination', 'Locate Creature', 'Commune with Nature']),
  'Mark of Handling': mark(['Animal Friendship', 'Speak with Animals'], {},
    ['Command', 'Find Familiar', 'Beast Sense', 'Calm Emotions', 'Beacon of Hope', 'Conjure Animals', 'Aura of Life', 'Dominate Beast', 'Awaken']),
  'Mark of Healing': mark(['Cure Wounds'], { later: [[3, ['Lesser Restoration']]] },
    ['False Life', 'Healing Word', 'Arcane Vigor', 'Prayer of Healing', 'Aura of Vitality', 'Mass Healing Word', 'Aura of Life', 'Aura of Purity', 'Greater Restoration']),
  'Mark of Hospitality': mark(['Purify Food and Drink', 'Unseen Servant'], { later: [[3, ['Calm Emotions']]] },
    ['Goodberry', 'Sleep', 'Aid', 'Enhance Ability', 'Create Food and Water', "Leomund's Tiny Hut", 'Aura of Purity', "Mordenkainen's Private Sanctum", 'Hallow']),
  'Mark of Making': mark(['Magic Weapon'], { cantrips: ['Mending'] },
    ['Identify', "Tenser's Floating Disk", 'Continual Flame', 'Spiritual Weapon', 'Conjure Barrage', 'Elemental Weapon', 'Fabricate', 'Stone Shape', 'Creation']),
  'Mark of Passage': mark(['Misty Step'], {},
    ['Expeditious Retreat', 'Jump', 'Find Steed', 'Pass without Trace', 'Blink', 'Phantom Steed', 'Dimension Door', 'Freedom of Movement', 'Teleportation Circle'], { speedBonus: 5 }),
  'Mark of Scribing': mark(['Comprehend Languages'], { cantrips: ['Message'], later: [[3, ['Magic Mouth']]] },
    ['Command', 'Illusory Script', 'Animal Messenger', 'Silence', 'Sending', 'Tongues', 'Arcane Eye', 'Confusion', 'Dream']),
  'Mark of Sentinel': mark(['Shield'], {},
    ['Compelled Duel', 'Shield of Faith', 'Warding Bond', 'Zone of Truth', 'Counterspell', 'Protection from Energy', 'Death Ward', 'Guardian of Faith', "Bigby's Hand"]),
  'Mark of Shadow': mark(['Invisibility'], { cantrips: ['Minor Illusion'] },
    ['Disguise Self', 'Silent Image', 'Darkness', 'Pass without Trace', 'Clairvoyance', 'Major Image', 'Greater Invisibility', 'Hallucinatory Terrain', 'Mislead']),
  'Mark of Storm': mark([], { cantrips: ['Thunderclap'], later: [[3, ['Gust of Wind']]] },
    ['Feather Fall', 'Fog Cloud', 'Levitate', 'Shatter', 'Sleet Storm', 'Wind Wall', 'Conjure Minor Elementals', 'Control Water', 'Conjure Elemental'], { resistances: ['Lightning'] }),
  'Mark of Warding': mark(['Alarm', 'Mage Armor'], { later: [[3, ['Arcane Lock']]] },
    ['Armor of Agathys', 'Sanctuary', 'Knock', "Nystul's Magic Aura", 'Glyph of Warding', 'Magic Circle', "Leomund's Secret Chest", "Mordenkainen's Faithful Hound", 'Antilife Shell'])
};

// A Dragonmark feat: spells cast once per Long Rest (INT, WIS or CHA, chosen
// with the feat) and the Spells of the Mark.
function mark(fixed, extra, markList, grants = {}) {
  return { category: 'Dragonmark', repeatable: false, grants: { ...grants, spells: { ...castOnce(fixed, extra), markList } } };
}

const DRAGONMARK_FEATS = Object.keys(BOOK_ORIGIN_FEATS).filter(name => BOOK_ORIGIN_FEATS[name].category === 'Dragonmark');

// General feats (level 4+).
const adept = (spells, extra = {}) => ({
  prerequisite: { spellcasting: true }, abilityIncrease: MENTAL,
  grants: { spells: { bySlotLevel: spells.map((spell, index) => [index + 1, spell]) } }, ...extra
});
const greaterMark = (base, extra = {}) => ({ prerequisite: { feats: [base] }, abilityIncrease: ANY, ...extra });
const BOOK_GENERAL_FEATS = {
  // Arcana Unleashed
  'Abjuration Adept': adept(['Shield', 'Lesser Restoration', 'Protection from Energy', 'Banishment', 'Mass Cure Wounds']),
  'Conjuration Adept': adept(['Entangle', 'Misty Step', 'Conjure Animals', 'Dimension Door', 'Conjure Elemental']),
  'Divination Adept': adept(['Detect Evil and Good', 'Mind Spike', 'Clairvoyance', 'Divination', 'Scrying']),
  'Enchantment Adept': adept(['Dissonant Whispers', 'Enthrall', 'Hold Person', 'Dominate Beast', 'Modify Memory']),
  'Evocation Adept': adept(['Chromatic Orb', 'Shatter', 'Fireball', 'Vitriolic Sphere', 'Wall of Force']),
  'Illusion Adept': adept(['Silent Image', 'Phantasmal Force', 'Major Image', 'Hallucinatory Terrain', 'Seeming']),
  'Necromancy Adept': adept(['Inflict Wounds', 'Ray of Enfeeblement', 'Vampiric Touch', 'Blight', 'Raise Dead']),
  'Transmutation Adept': adept(['Jump', 'Spider Climb', 'Slow', 'Polymorph', 'Animate Objects']),
  'Elemental Familiar': { prerequisite: { feats: ['Familiar Friend'] }, abilityIncrease: ANY },
  'Otherworldly Familiar': { prerequisite: { feats: ['Familiar Friend'] }, abilityIncrease: ANY },
  'Soothing Familiar': { prerequisite: { feats: ['Familiar Friend'] }, abilityIncrease: ANY },
  // Battle Familiar is cast with the Find Familiar ability (Familiar Friend's).
  'Warlike Familiar': { prerequisite: { feats: ['Familiar Friend'] }, abilityIncrease: ANY, grants: { spells: castOnce(['Battle Familiar']) } },
  // A level 1 and a level 2 spell from the Magic Initiate list: picked on the Spells page.
  'Magic Connoisseur': { prerequisite: { feats: ['Magic Initiate'] }, abilityIncrease: MENTAL },
  'Spell Resistant': { abilityIncrease: ['dex', 'con'] },
  'Spell Subterfuge': { prerequisite: { spellcasting: true }, abilityIncrease: MENTAL },
  // Eberron: Forge of the Artificer
  'Greater Aberrant Mark': greaterMark('Aberrant Dragonmark', { abilityIncrease: ['con'] }),
  'Greater Mark of Detection': greaterMark('Mark of Detection'),
  'Greater Mark of Finding': greaterMark('Mark of Finding'),
  'Greater Mark of Handling': greaterMark('Mark of Handling'),
  'Greater Mark of Healing': greaterMark('Mark of Healing'),
  'Greater Mark of Hospitality': greaterMark('Mark of Hospitality'),
  'Greater Mark of Making': greaterMark('Mark of Making'),
  'Greater Mark of Passage': greaterMark('Mark of Passage'),
  'Greater Mark of Scribing': greaterMark('Mark of Scribing'),
  'Greater Mark of Sentinel': greaterMark('Mark of Sentinel'),
  'Greater Mark of Shadow': greaterMark('Mark of Shadow'),
  'Greater Mark of Storm': greaterMark('Mark of Storm'),
  'Greater Mark of Warding': greaterMark('Mark of Warding'),
  // The ability the Dragonmark feat's spells use; its Spells of the Mark always prepared.
  'Potent Dragonmark': { prerequisite: { anyFeat: DRAGONMARK_FEATS }, abilityIncrease: MENTAL, grants: { markPrepared: true } }
};

const BOOK_FIGHTING_STYLE_FEATS = {
  'Arcane Warrior': { grants: { spells: { cantripChoice: { lists: ['Wizard'], count: 2 }, chooseAbility: true } } }
};

const BOOK_EPIC_BOONS = {
  'Boon of Erupting Spellpower': { abilityIncrease: MENTAL, prerequisite: { spellcasting: true } },
  'Boon of Magic School Mastery': { abilityIncrease: MENTAL, prerequisite: { spellcasting: true }, repeatable: true },
  'Boon of the Iron Mind': { abilityIncrease: ANY },
  'Boon of Siberys': { abilityIncrease: ANY }
};

module.exports = { BOOK_ORIGIN_FEATS, BOOK_GENERAL_FEATS, BOOK_FIGHTING_STYLE_FEATS, BOOK_EPIC_BOONS, DRAGONMARK_FEATS };
