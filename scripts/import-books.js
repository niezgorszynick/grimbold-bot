// scripts/import-books.js — Runs every scripts/import-book.js import used for
// rules/content (the books exported to Markdown, 5etools style), so the files
// can be rebuilt after a new export:
//
//   node scripts/import-books.js "C:/Users/.../DnD books"
//
// Entries already in the files are replaced, others appended. The book text
// stays in the gitignored content files; this list holds only names.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BOOKS = {
  phb: "Player's Handbook (2024).md",
  dmg: "Dungeon Master's Guide (2024).md",
  au: 'Arcana Unleashed.md',
  efa: 'Eberron_ Forge of the Artificer.md',
  rhw: 'Ravenloft_ The Horrors Within.md'
};
const SOURCES = {
  phb: "Player's Handbook (2024)",
  dmg: "Dungeon Master's Guide 2024",
  au: 'Arcana Unleashed',
  efa: 'Eberron: Forge of the Artificer',
  rhw: 'Ravenloft: The Horrors Within'
};

// [kind, book, names, extra options]
const IMPORTS = [
  ['class', 'efa', ['Artificer']],
  ['subclass', 'efa', ['Alchemist', 'Armorer', 'Artillerist', 'Battle Smith', 'Cartographer'], ['--class', 'Artificer']],
  ['subclass', 'rhw', ['Reanimator'], ['--class', 'Artificer']],
  ['subclass', 'au', ['Arcana Domain'], ['--class', 'Cleric']],
  ['subclass', 'au', ['Arcane Archer'], ['--class', 'Fighter']],
  ['subclass', 'au', ['Warrior of the Mystic Arts'], ['--class', 'Monk']],
  ['subclass', 'au', ['Vestige Patron'], ['--class', 'Warlock']],
  ['subclass', 'au', ['Conjurer', 'Enchanter', 'Necromancer', 'Transmuter'], ['--class', 'Wizard']],
  ['subclass', 'rhw', ['College of Spirits'], ['--class', 'Bard']],
  ['subclass', 'rhw', ['Grave Domain'], ['--class', 'Cleric']],
  ['subclass', 'rhw', ['Hollow Warden'], ['--class', 'Ranger']],
  ['subclass', 'rhw', ['Phantom'], ['--class', 'Rogue']],
  ['subclass', 'rhw', ['Shadow Sorcery'], ['--class', 'Sorcerer']],
  ['subclass', 'rhw', ['Undead Patron'], ['--class', 'Warlock']],
  ['species', 'phb', ['Aasimar', 'Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath', 'Halfling', 'Human', 'Orc', 'Tiefling']],
  ['species', 'efa', ['Changeling', 'Kalashtar', 'Khoravar', 'Shifter', 'Warforged']],
  ['species', 'rhw', ['Dhampir', 'Hexblood', 'Lupin', 'Reborn']],
  ['feat', 'phb', ['Boon of Energy Resistance', 'Boon of Fortitude', 'Boon of Recovery', 'Boon of Skill', 'Boon of Speed']],
  ['feat', 'au', ['Arcane Artist', 'Arcane Eloquence', 'Arcane Infiltrator', 'Arcane Omens', 'Arcane Overload', 'Arcane Safeguard',
    'Arcane Undertaker', 'Familiar Friend', 'Portal Jumper', 'Transmuted Anatomy', 'Abjuration Adept', 'Conjuration Adept', 'Divination Adept',
    'Elemental Familiar', 'Enchantment Adept', 'Evocation Adept', 'Illusion Adept', 'Magic Connoisseur', 'Necromancy Adept', 'Otherworldly Familiar',
    'Soothing Familiar', 'Spell Resistant', 'Spell Subterfuge', 'Transmutation Adept', 'Warlike Familiar', 'Arcane Warrior',
    'Boon of Erupting Spellpower', 'Boon of Magic School Mastery', 'Boon of the Iron Mind']],
  ['feat', 'efa', ['Aberrant Dragonmark', 'Mark of Detection', 'Mark of Finding', 'Mark of Handling', 'Mark of Healing', 'Mark of Hospitality',
    'Mark of Making', 'Mark of Passage', 'Mark of Scribing', 'Mark of Sentinel', 'Mark of Shadow', 'Mark of Storm', 'Mark of Warding',
    'Greater Aberrant Mark', 'Greater Mark of Detection', 'Greater Mark of Finding', 'Greater Mark of Handling', 'Greater Mark of Healing',
    'Greater Mark of Hospitality', 'Greater Mark of Making', 'Greater Mark of Passage', 'Greater Mark of Scribing', 'Greater Mark of Sentinel',
    'Greater Mark of Shadow', 'Greater Mark of Storm', 'Greater Mark of Warding', 'Potent Dragonmark', 'Boon of Siberys']],
  ['feat', 'rhw', ['Sharp Eye', 'Survivor', 'Aberrant Anatomy', 'Echoing Soul', 'Gathered Whispers', 'Living Shadow', 'Mist Walker',
    'Second Skin', 'Symbiotic Being', 'Touch of Death', 'Watchers']],
  ['items', 'au', ['Magic Items']],
  ['item', 'au', ['Blossom Rod', 'Idol of Good Fortunes', 'Keyholes Dagger', 'Staff of Skulls', 'Wave-Swept Weapon', 'Blade of the Guardian',
    'Breastplate of the Tyrant', 'Rod of the Honed Mind', 'Wand of Celestial Prowess']],
  ['items', 'efa', ['Appendix: Magic Items']],
  ['item', 'dmg', ['Blackrazor', 'Demonomicon of Iggwilv', 'Wand of Orcus']],
  ['monsters', 'rhw', []],
  ['monsters', 'au', []],
  ['monsters', 'efa', []]
];

// The export puts Hexblood's Hex Magic trait in Eerie Token's list.
function fixExportSlips(contentDir) {
  const file = path.join(contentDir, 'species.md');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace(/\n- \*\*Hex Magic\.\*\* /, '\n### Hex Magic\n'));
}

function main([booksDir, contentDir = path.join(__dirname, '..', 'rules', 'content')]) {
  if (!booksDir) {
    console.error('Usage: node scripts/import-books.js <books folder> [content folder]');
    process.exit(1);
  }
  for (const [kind, book, names, extra = []] of IMPORTS) {
    execFileSync(process.execPath, [path.join(__dirname, 'import-book.js'), kind, path.join(booksDir, BOOKS[book]), ...names,
      '--source', SOURCES[book], '--dir', contentDir, ...extra], { stdio: 'inherit' });
  }
  fixExportSlips(contentDir);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { IMPORTS };
