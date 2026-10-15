// rules/subclassSpells.js — Spells a subclass always has prepared (2024 PHB):
// Cleric domains, Paladin oaths, Druid circles, Warlock patrons, Sorcerer
// origins and Ranger subclasses. They don't count against the class's
// prepared spells and can't be swapped out.
//
// Each list is [[class level, [spells]], ...]; a spell is prepared from that
// class level on. Circle of the Land's spells depend on the land the druid
// chose (a feature choice, see rules/featureChoices.js).

const SUBCLASS_SPELLS = {
  // Cleric
  'Life Domain': [[3, ['Aid', 'Bless', 'Cure Wounds', 'Lesser Restoration']], [5, ['Mass Healing Word', 'Revivify']], [7, ['Aura of Life', 'Death Ward']], [9, ['Greater Restoration', 'Mass Cure Wounds']]],
  'Light Domain': [[3, ['Burning Hands', 'Faerie Fire', 'Scorching Ray', 'See Invisibility']], [5, ['Daylight', 'Fireball']], [7, ['Arcane Eye', 'Wall of Fire']], [9, ['Flame Strike', 'Scrying']]],
  'Trickery Domain': [[3, ['Charm Person', 'Disguise Self', 'Invisibility', 'Pass without Trace']], [5, ['Hypnotic Pattern', 'Nondetection']], [7, ['Confusion', 'Dimension Door']], [9, ['Dominate Person', 'Modify Memory']]],
  'War Domain': [[3, ['Guiding Bolt', 'Magic Weapon', 'Shield of Faith', 'Spiritual Weapon']], [5, ["Crusader's Mantle", 'Spirit Guardians']], [7, ['Fire Shield', 'Freedom of Movement']], [9, ['Hold Monster', 'Steel Wind Strike']]],
  // Paladin
  'Oath of Devotion': [[3, ['Protection from Evil and Good', 'Shield of Faith']], [5, ['Aid', 'Zone of Truth']], [9, ['Beacon of Hope', 'Dispel Magic']], [13, ['Freedom of Movement', 'Guardian of Faith']], [17, ['Commune', 'Flame Strike']]],
  'Oath of Glory': [[3, ['Guiding Bolt', 'Heroism']], [5, ['Enhance Ability', 'Magic Weapon']], [9, ['Haste', 'Protection from Energy']], [13, ['Compulsion', 'Freedom of Movement']], [17, ['Legend Lore', "Yolande's Regal Presence"]]],
  'Oath of the Ancients': [[3, ['Ensnaring Strike', 'Speak with Animals']], [5, ['Misty Step', 'Moonbeam']], [9, ['Plant Growth', 'Protection from Energy']], [13, ['Ice Storm', 'Stoneskin']], [17, ['Commune with Nature', 'Tree Stride']]],
  'Oath of Vengeance': [[3, ['Bane', "Hunter's Mark"]], [5, ['Hold Person', 'Misty Step']], [9, ['Haste', 'Protection from Energy']], [13, ['Banishment', 'Dimension Door']], [17, ['Hold Monster', 'Scrying']]],
  // Druid
  'Circle of the Moon': [[3, ['Cure Wounds', 'Moonbeam', 'Starry Wisp']], [5, ['Conjure Animals']], [7, ['Fount of Moonlight']], [9, ['Mass Cure Wounds']]],
  'Circle of the Sea': [[3, ['Fog Cloud', 'Gust of Wind', 'Ray of Frost', 'Thunderwave']], [5, ['Lightning Bolt', 'Water Breathing']], [7, ['Control Water', 'Ice Storm']], [9, ['Conjure Elemental', 'Hold Monster']]],
  // Star Map.
  'Circle of the Stars': [[3, ['Guidance', 'Guiding Bolt']]],
  // Warlock
  'Archfey Patron': [[3, ['Calm Emotions', 'Faerie Fire', 'Misty Step', 'Phantasmal Force', 'Sleep']], [5, ['Blink', 'Plant Growth']], [7, ['Dominate Beast', 'Greater Invisibility']], [9, ['Dominate Person', 'Seeming']]],
  'Celestial Patron': [[3, ['Aid', 'Cure Wounds', 'Guiding Bolt', 'Lesser Restoration', 'Light', 'Sacred Flame']], [5, ['Daylight', 'Revivify']], [7, ['Guardian of Faith', 'Wall of Fire']], [9, ['Greater Restoration', 'Summon Celestial']]],
  'Fiend Patron': [[3, ['Burning Hands', 'Command', 'Scorching Ray', 'Suggestion']], [5, ['Fireball', 'Stinking Cloud']], [7, ['Fire Shield', 'Wall of Fire']], [9, ['Geas', 'Insect Plague']]],
  'Great Old One Patron': [[3, ['Detect Thoughts', 'Dissonant Whispers', 'Phantasmal Force', "Tasha's Hideous Laughter"]], [5, ['Clairvoyance', 'Hunger of Hadar']], [7, ['Confusion', 'Summon Aberration']], [9, ['Modify Memory', 'Telekinesis']]],
  // Sorcerer
  'Aberrant Sorcery': [[3, ['Arms of Hadar', 'Calm Emotions', 'Detect Thoughts', 'Dissonant Whispers', 'Mind Sliver']], [5, ['Hunger of Hadar', 'Sending']], [7, ["Evard's Black Tentacles", 'Summon Aberration']], [9, ["Rary's Telepathic Bond", 'Telekinesis']]],
  'Clockwork Sorcery': [[3, ['Aid', 'Alarm', 'Lesser Restoration', 'Protection from Evil and Good']], [5, ['Dispel Magic', 'Protection from Energy']], [7, ['Freedom of Movement', 'Summon Construct']], [9, ['Greater Restoration', 'Wall of Force']]],
  'Draconic Sorcery': [[3, ['Alter Self', 'Chromatic Orb', 'Command', "Dragon's Breath"]], [5, ['Fear', 'Fly']], [7, ['Arcane Eye', 'Charm Monster']], [9, ['Legend Lore', 'Summon Dragon']]],
  // Ranger
  'Fey Wanderer': [[3, ['Charm Person']], [5, ['Misty Step']], [9, ['Summon Fey']], [13, ['Dimension Door']], [17, ['Mislead']]],
  'Gloom Stalker': [[3, ['Disguise Self']], [5, ['Rope Trick']], [9, ['Fear']], [13, ['Greater Invisibility']], [17, ['Seeming']]]
};

// Circle of the Land: the land chosen with the "Circle Spells (Land)" feature choice.
const LAND_CHOICE_ID = 'Circle of the Land:3:Circle Spells (Land)';
const LAND_SPELLS = {
  Arid: [[3, ['Blur', 'Burning Hands', 'Fire Bolt']], [5, ['Fireball']], [7, ['Blight']], [9, ['Wall of Stone']]],
  Polar: [[3, ['Fog Cloud', 'Hold Person', 'Ray of Frost']], [5, ['Sleet Storm']], [7, ['Ice Storm']], [9, ['Cone of Cold']]],
  Temperate: [[3, ['Misty Step', 'Shocking Grasp', 'Sleep']], [5, ['Lightning Bolt']], [7, ['Freedom of Movement']], [9, ['Tree Stride']]],
  Tropical: [[3, ['Acid Splash', 'Ray of Sickness', 'Web']], [5, ['Stinking Cloud']], [7, ['Polymorph']], [9, ['Insect Plague']]]
};

// The always-prepared spells of one class row: { className, subclassName, level }.
function subclassSpellsFor(row, sheetData) {
  let table = SUBCLASS_SPELLS[row.subclassName];
  if (row.subclassName === 'Circle of the Land') {
    const land = (((sheetData || {}).featureChoices || {})[LAND_CHOICE_ID] || {}).value;
    table = LAND_SPELLS[land];
  }
  if (!table) return [];
  return table.filter(([level]) => row.level >= level).flatMap(([, spells]) => spells);
}

// The land a Circle of the Land druid has chosen, or null.
function chosenLand(sheetData) {
  return (((sheetData || {}).featureChoices || {})[LAND_CHOICE_ID] || {}).value || null;
}

// Sets the land (after a Long Rest, or the first time). Returns the next sheetData.
function setLand(sheetData, land) {
  if (!LAND_SPELLS[land]) throw new Error(`Choose a land: ${Object.keys(LAND_SPELLS).join(', ')}.`);
  const featureChoices = { ...((sheetData || {}).featureChoices || {}) };
  const previous = featureChoices[LAND_CHOICE_ID] || {};
  featureChoices[LAND_CHOICE_ID] = {
    name: 'Circle Spells (Land)', source: 'Circle of the Land', level: 3, ...previous, value: land,
    added: previous.added || { skills: [], expertise: [], tools: [], languages: [], weapons: [], armor: [], cantrips: 0 }
  };
  return { ...sheetData, featureChoices };
}

module.exports = { SUBCLASS_SPELLS, LAND_SPELLS, LAND_CHOICE_ID, subclassSpellsFor, chosenLand, setLand };
