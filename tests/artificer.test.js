// Artificer (Eberron: Forge of the Artificer): the book importer, uses of its
// features, the attunement limit, subclass spells and its spell list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const importer = require('../scripts/import-book');
const rules = require('../rules');

// A made-up book in the export's style.
const BOOK = [
  '# Chapter 1', '',
  '## Tinkerer', '',
  '#### Level 1: Gadgets', '', 'You make gadgets.', '',
  '***Gizmo.*** A small one.', '***Doohickey.*** A bigger one.', '',
  '![art](img/x.webp)', '',
  '#### Level 3: Tinkerer Subclass', '', 'Pick one.', '',
  '#### Level 4: Ability Score Improvement', '', 'A feat.', '',
  '##### Gadget Table', '| Level | Gadgets |', '|---|---|', '| 1 | 2 |', '',
  '# Subclasses', '',
  '## Cogwright', '', '*Turn Cogs*', '', 'Cogwrights love cogs.', '',
  '***Level 3: Cog Spells.*** You always have *Shield* prepared.', '',
  '***Tool Proficiency.*** Smith\'s Tools.', '',
  '***Level 5: Extra Cog.*** Another cog.', '',
  '> ##### Sidebar', '>', '> Cogs are fun.', '', '>## Cog Golem', '>### Actions', '>***Bonk.*** It bonks.', '',
  '## Next Subclass', '', '***Level 3: Other.*** Not this one.'
].join('\n');

test('a class section becomes "### Level N: Feature" entries without the structural ones', () => {
  const entry = importer.classEntry(BOOK, 'Tinkerer', { source: 'Test Book' });
  assert.match(entry, /^## Tinkerer\n- Source: Test Book\n/);
  assert.match(entry, /### Level 1: Gadgets\nYou make gadgets\.\n\n\*\*Gizmo\.\*\* A small one\.\n\n\*\*Doohickey\.\*\* A bigger one\./);
  assert.doesNotMatch(entry, /Subclass|Ability Score Improvement|img\//);
});

test('a subclass section splits on "***Level N: Name.***" paragraphs and keeps the intro', () => {
  const entry = importer.subclassEntry(BOOK, 'Cogwright', { className: 'Tinkerer' });
  assert.match(entry, /^## Cogwright\n- Class: Tinkerer\n\n\*Turn Cogs\*\n\nCogwrights love cogs\.\n/);
  assert.match(entry, /### Level 3: Cog Spells\nYou always have \*Shield\* prepared\.\n\n\*\*Tool Proficiency\.\*\* Smith's Tools\./);
  assert.match(entry, /### Level 5: Extra Cog\nAnother cog\.\n\n\*\*Sidebar\*\*\n\nCogs are fun\./);
  assert.doesNotMatch(entry, /Not this one/);
});

test('upserting replaces an entry in place and appends new ones', () => {
  const before = '## A\n- Class: X\n\nOld.\n\n---\n\n<!-- below: SRD -->\n\n## B\n- Class: Y\n\nKeep.\n';
  const after = importer.upsertEntries(before, [['A', '## A\n- Class: X\n\nNew.\n\n---\n'], ['C', '## C\n\nAdded.\n\n---\n']]);
  assert.match(after, /^## A\n- Class: X\n\nNew\.\n\n---\n\n<!-- below: SRD -->\n\n## B\n/);
  assert.match(after, /Keep\.\n\n## C\n\nAdded\./);
  assert.doesNotMatch(after, /Old\./);
});

test('the importer writes into a content folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimbold-import-'));
  const book = path.join(dir, 'book.md');
  fs.writeFileSync(book, BOOK);
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'import-book.js'), 'subclass', book, 'Cogwright', '--class', 'Tinkerer', '--dir', dir]);
  assert.match(fs.readFileSync(path.join(dir, 'subclasses.md'), 'utf8'), /## Cogwright/);
});

const INT_18 = ability => (ability === 'int' ? 18 : 10);
const uses = rows => Object.fromEntries(rules.classResources(rows, INT_18).map(resource => [resource.key, resource]));

test('Artificer uses: Tinker\'s Magic, Flash of Genius and its rests', () => {
  assert.equal(uses([{ className: 'Artificer', level: 1 }]).tinkersMagic.max, 4);
  assert.equal(uses([{ className: 'Artificer', level: 6 }]).flashOfGenius, undefined);
  assert.equal(uses([{ className: 'Artificer', level: 7 }]).flashOfGenius.recovery, 'long');
  assert.equal(uses([{ className: 'Artificer', level: 14 }]).flashOfGenius.recovery, 'shortOne');
  assert.equal(uses([{ className: 'Artificer', level: 20 }]).flashOfGenius.recovery, 'short');
});

test('Artificer subclass uses follow the level', () => {
  const alchemist = uses([{ className: 'Artificer', subclassName: 'Alchemist', level: 9 }]);
  assert.equal(alchemist.experimentalElixir.max, 4);
  assert.equal(alchemist.experimentalElixir.rolls.find(roll => roll.key === 'healing').formula, '3d8+4');
  assert.equal(alchemist.restorativeReagents.max, 4);
  const smith = uses([{ className: 'Artificer', subclassName: 'Battle Smith', level: 15 }]);
  assert.equal(smith.arcaneJolt.rolls[0].formula, '4d6');
  const reanimator = rules.classResources([{ className: 'Artificer', subclassName: 'Reanimator', level: 3 }], () => 10);
  assert.ok(!reanimator.some(resource => resource.key === 'joltToLife'), 'INT +0: no Jolt to Life uses');
});

test('Artificers attune to more magic items at levels 10, 14 and 18', () => {
  const limit = level => rules.attunementLimit({ classes: [{ className: 'Wizard', level: 5 }, { className: 'Artificer', level }] });
  assert.deepEqual([9, 10, 14, 18].map(limit), [3, 4, 5, 6]);
  assert.equal(rules.attunementLimit({ classes: [{ className: 'Fighter', level: 20 }] }), 3);
});

test('Artificer subclass spells and tools', () => {
  assert.deepEqual(rules.subclassSpellsFor({ className: 'Artificer', subclassName: 'Cartographer', level: 5 }),
    ['Faerie Fire', 'Guiding Bolt', 'Healing Word', 'Locate Object', 'Mind Spike']);
  const { normalizeSpell } = require('../rules/spells');
  assert.ok(normalizeSpell({ name: 'Grease', fields: { classes: 'Sorcerer, Wizard' } }).classes.includes('Artificer'));
});

test('"Martial Ranged weapons" covers martial ranged weapons only', () => {
  const { isProficient } = require('../rules/combat');
  assert.equal(isProficient({ name: 'Longbow', category: 'Martial', kind: 'Ranged', properties: [] }, ['Martial Ranged weapons']), true);
  assert.equal(isProficient({ name: 'Longsword', category: 'Martial', kind: 'Melee', properties: [] }, ['Martial Ranged weapons']), false);
});
