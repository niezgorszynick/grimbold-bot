// rules/subclasses.js — Subclasses per class (2024 PHB, plus supplements for Artificer,
// and the Unearthed Arcana 2026 "Villainous Options" playtest subclasses).

const DND_CLASSES_AND_SUBCLASSES = {
  'Artificer': [
    'Alchemist',
    'Armorer',
    'Artillerist',
    'Battle Smith',
    'Cartographer',
    'Reanimator'
  ],
  'Barbarian': [
    'Path of the Berserker',
    'Path of the Wild Heart',
    'Path of the World Tree',
    'Path of the Zealot'
  ],
  'Bard': [
    'College of Dance',
    'College of Glamour',
    'College of Lore',
    'College of Valor'
  ],
  'Cleric': [
    'Life Domain',
    'Light Domain',
    'Pestilence Domain',
    'Trickery Domain',
    'War Domain'
  ],
  'Druid': [
    'Circle of the Land',
    'Circle of the Moon',
    'Circle of the Sea',
    'Circle of the Stars',
    'Circle of the Titan'
  ],
  'Fighter': [
    'Battle Master',
    'Champion',
    'Eldritch Knight',
    'Hell Knight',
    'Psi Warrior'
  ],
  'Monk': [
    'Warrior of Mercy',
    'Warrior of Shadow',
    'Warrior of the Elements',
    'Warrior of the Open Hand'
  ],
  'Paladin': [
    'Oath of Devotion',
    'Oath of Glory',
    'Oath of the Ancients',
    'Oath of Vengeance'
  ],
  'Ranger': [
    'Beast Master',
    'Fey Wanderer',
    'Gloom Stalker',
    'Hunter'
  ],
  'Rogue': [
    'Arcane Trickster',
    'Assassin',
    'Soulknife',
    'Thief'
  ],
  'Sorcerer': [
    'Aberrant Sorcery',
    'Clockwork Sorcery',
    'Demonic Sorcery',
    'Draconic Sorcery',
    'Wild Magic Sorcery'
  ],
  'Warlock': [
    'Archfey Patron',
    'Celestial Patron',
    'Fiend Patron',
    'Great Old One Patron'
  ],
  'Wizard': [
    'Abjurer',
    'Diviner',
    'Evoker',
    'Illusionist'
  ]
};

// Subclasses from playtest material (shown as such on the sheet).
const PLAYTEST_SUBCLASSES = {
  'Pestilence Domain': 'Unearthed Arcana 2026: Villainous Options',
  'Circle of the Titan': 'Unearthed Arcana 2026: Villainous Options',
  'Hell Knight': 'Unearthed Arcana 2026: Villainous Options',
  'Demonic Sorcery': 'Unearthed Arcana 2026: Villainous Options'
};

// The features a character's subclasses give up to their class levels, with
// their text from rules/content/subclasses.md (kept off Git: book and playtest
// wording). An entry is "## Subclass", its features "### Level 3: Name".
// classRows: [{ className, subclassName, level }]. [] without the file.
function subclassFeatureTexts(classRows) {
  const { loadContent } = require('./content');
  const entries = loadContent('subclasses');
  return (classRows || []).filter(row => row.subclassName && entries[row.subclassName]).map(row => {
    const entry = entries[row.subclassName];
    const features = Object.entries(entry.sections).map(([heading, text]) => {
      const match = heading.match(/^Level\s+(\d+)\s*:\s*(.+)$/i);
      return match ? { level: Number(match[1]), name: match[2].trim(), text } : null;
    }).filter(feature => feature && feature.text && feature.level <= row.level);
    return {
      subclass: row.subclassName,
      className: row.className,
      level: row.level,
      source: PLAYTEST_SUBCLASSES[row.subclassName] || null,
      intro: entry.description,
      features,
      // What comes later, by name only.
      upcoming: Object.keys(entry.sections).map(heading => heading.match(/^Level\s+(\d+)\s*:\s*(.+)$/i))
        .filter(match => match && Number(match[1]) > row.level).map(match => ({ level: Number(match[1]), name: match[2].trim() }))
    };
  });
}

// The class features a character has, with their text from rules/content/classes.md
// (kept off Git like subclasses.md): "## Cleric", its features "### Level 1: Divine Order".
// A feature with no text yet is left out. classRows: [{ className, level }]. [] without the file.
function classFeatureTexts(classRows) {
  const { loadContent } = require('./content');
  const entries = loadContent('classes');
  return (classRows || []).filter(row => row.className && entries[row.className]).map(row => ({
    className: row.className,
    level: row.level,
    features: Object.entries(entries[row.className].sections).map(([heading, text]) => {
      const match = heading.match(/^Level\s+(\d+)\s*:\s*(.+)$/i);
      return match && text ? { level: Number(match[1]), name: match[2].trim(), text } : null;
    }).filter(feature => feature && feature.level <= row.level)
  }));
}

module.exports = { DND_CLASSES_AND_SUBCLASSES, PLAYTEST_SUBCLASSES, subclassFeatureTexts, classFeatureTexts };
