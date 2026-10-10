const path = require('path');
const fs = require('fs');
const os = require('os');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseContentMarkdown, loadContent } = require('../rules/content');
const spells = require('../rules/spells');
const book = require('../rules/spellbook');

const abilities = scores => Object.fromEntries(Object.entries({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...scores })
  .map(([key, score]) => [key, { score }]));
const sourcesFor = (classes, sheetData = {}, species = 'Human') =>
  book.getSpellSources({ classes, species, sheetData: { abilities: abilities({ int: 16, wis: 16, cha: 16 }), ...sheetData } });
const sourceOf = (sources, key) => sources.find(source => source.key === key);

test('parses the spells.md format: bold fields, description section, separators', () => {
  const entries = parseContentMarkdown([
    '# Aid', '', '- **Level**: Level 2', '- **Casting Time**: 1 minute or Ritual',
    '- **Duration**: Concentration, up to 1 hour', '- **Components**: V, S, M (diamond dust worth 1,000+ GP, which the spell consumes)',
    '- **Classes**: Bard, Warlo, Psion,', '', '### Description', '', 'First paragraph.', '',
    '**Using a Higher-Level Spell Slot**. More per level.', '', '---', '', '# Light', '', '- **Level**: Cantrip (Level 0)',
    '- **Classes**: Wizard', '', '### Description', '', 'Glows.', '', '**Cantrip Upgrade**. Brighter.', '', '---'
  ].join('\r\n'));
  assert.deepEqual(Object.keys(entries), ['Aid', 'Light']);
  const aid = spells.normalizeSpell(entries.Aid);
  assert.equal(aid.level, 2);
  assert.equal(aid.ritual, true);
  assert.equal(aid.concentration, true);
  assert.deepEqual(aid.classes, ['Bard', 'Warlock']);
  assert.deepEqual(aid.otherClasses, ['Psion']);
  assert.equal(aid.description, 'First paragraph.');
  assert.equal(aid.higherLevels, 'More per level.');
  assert.equal(aid.components.materialCostGp, 1000);
  assert.equal(aid.components.materialConsumed, true);
  const light = spells.normalizeSpell(entries.Light);
  assert.equal(light.level, 0);
  assert.equal(light.cantripUpgrade, 'Brighter.');
});

test('fallback descriptions fill gaps but never override real text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grimbold-content-'));
  fs.writeFileSync(path.join(dir, 'spells.md'), '# Gate\n\n- **Level**: Level 9\n\n### Description\n\nNo description available.\n\n---\n\n# Wish\n\n- **Level**: Level 9\n\n### Description\n\nReal text.\n');
  fs.writeFileSync(path.join(dir, 'spells.fallback.md'), '## Gate\n- Level: Level 9\n\nSummary text.\n\n## Wish\n- Level: Level 9\n\nShould not win.\n\n## Extra\n- Level: Level 1\n\nOnly here.\n');
  const entries = loadContent('spells', { dir });
  assert.equal(entries.Gate.description, 'Summary text.');
  assert.equal(entries.Wish.description, 'Real text.');
  assert.equal(entries.Extra.description, 'Only here.');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('class sources follow the 2024 tables', () => {
  const sources = sourcesFor([{ className: 'Wizard', subclassName: 'Evoker', level: 3 }, { className: 'Cleric', subclassName: null, level: 1 }]);
  const wizard = sourceOf(sources, 'Wizard');
  assert.equal(wizard.cantripLimit, 3);
  assert.equal(wizard.preparedLimit, 6);
  assert.equal(wizard.maxSpellLevel, 2);
  assert.equal(wizard.spellbook.freeLimit, 10);
  assert.equal(wizard.saveDc, 8 + 2 + 3); // character level 4: proficiency +2, INT 16: +3
  const cleric = sourceOf(sources, 'Cleric');
  assert.equal(cleric.maxSpellLevel, 1); // each class prepares as if single-classed
  assert.equal(cleric.changeRule, 'longRestAll');

  assert.equal(sourceOf(sourcesFor([{ className: 'Paladin', level: 5 }]), 'Paladin').maxSpellLevel, 2);
  assert.equal(sourceOf(sourcesFor([{ className: 'Warlock', level: 5 }]), 'Warlock').maxSpellLevel, 3);
  const knight = sourceOf(sourcesFor([{ className: 'Fighter', subclassName: 'Eldritch Knight', level: 3 }]), 'Fighter');
  assert.equal(knight.list, 'Wizard');
  assert.equal(knight.maxSpellLevel, 1);
  assert.equal(knight.changeRule, 'levelUpOne');
  assert.equal(sourcesFor([{ className: 'Fighter', subclassName: 'Champion', level: 5 }]).length, 0);
});

test('wizards fill their spellbook, then prepare from it', () => {
  const sources = sourcesFor([{ className: 'Wizard', subclassName: 'Evoker', level: 3 }]);
  const wizard = sourceOf(sources, 'Wizard');
  const book1 = ['Magic Missile', 'Shield', 'Detect Magic', 'Find Familiar', 'Sleep', 'Burning Hands', 'Thunderwave', 'Charm Person', 'Misty Step', 'Web'];
  let { state, copyCostGp } = book.chooseSpells(book.readSpellcasting({}), wizard, {
    cantrips: ['Fire Bolt', 'Light', 'Mage Hand'],
    addToSpellbook: book1,
    prepared: ['Magic Missile', 'Shield', 'Sleep', 'Misty Step', 'Web', 'Thunderwave']
  });
  assert.equal(copyCostGp, 0);
  assert.equal(state.classes.Wizard.spellbook.length, 10);

  assert.throws(() => book.chooseSpells(state, wizard, { addToSpellbook: ['Scorching Ray'] }), /must be copied/);
  const copied = book.chooseSpells(state, wizard, { addToSpellbook: ['Scorching Ray'], copyAddedSpells: true });
  assert.equal(copied.copyCostGp, 100);
  assert.throws(() => book.chooseSpells(state, wizard, { addToSpellbook: ['Fireball'], copyAddedSpells: true }), /up to level 2/);
  assert.throws(() => book.chooseSpells(state, wizard, { prepared: ['Hold Person'] }), /not in your spellbook/);
  assert.throws(() => book.chooseSpells(state, wizard, { cantrips: ['Fire Bolt', 'Light', 'Mage Hand', 'Minor Illusion'] }), /at most 3 cantrips/);
  assert.throws(() => book.chooseSpells(state, wizard, { prepared: ['Cure Wounds'] }), /not on the Wizard spell list/);
});

test('strict changes: Wizards rework after a Long Rest until they cast', () => {
  const sources = sourcesFor([{ className: 'Wizard', subclassName: 'Evoker', level: 3 }]);
  const wizard = sourceOf(sources, 'Wizard');
  let { state } = book.chooseSpells(book.readSpellcasting({}), wizard, {
    addToSpellbook: ['Magic Missile', 'Shield', 'Sleep', 'Burning Hands'], prepared: ['Magic Missile', 'Shield']
  });
  assert.throws(() => book.chooseSpells(state, wizard, { prepared: ['Sleep', 'Burning Hands'] }), /after a Long Rest/);
  // Adding to an empty slot is always fine.
  state = book.chooseSpells(state, wizard, { prepared: ['Magic Missile', 'Shield', 'Sleep'] }).state;

  state = book.onLongRest(state, sources);
  state = book.chooseSpells(state, wizard, { prepared: ['Burning Hands', 'Sleep'] }).state;
  state = book.chooseSpells(state, wizard, { prepared: ['Magic Missile', 'Sleep'] }).state;
  state = book.castSpell(state, sources, { source: 'Wizard', spell: 'Sleep', slotLevel: 1 }).state;
  assert.throws(() => book.chooseSpells(state, wizard, { prepared: ['Shield', 'Sleep'] }), /after a Long Rest/);
});

test('strict changes: Bards swap one spell per Bard level, cantrips one per level', () => {
  const sources = sourcesFor([{ className: 'Bard', subclassName: 'College of Lore', level: 3 }]);
  const bard = sourceOf(sources, 'Bard');
  let { state } = book.chooseSpells(book.readSpellcasting({}), bard, {
    cantrips: ['Light', 'Mage Hand'], prepared: ['Sleep', 'Charm Person', 'Healing Word', 'Faerie Fire', 'Thunderwave', 'Cure Wounds']
  });
  state = book.onLongRest(state, sources);
  assert.throws(() => book.chooseSpells(state, bard, { prepared: ['Detect Magic', 'Charm Person', 'Healing Word', 'Faerie Fire', 'Thunderwave', 'Cure Wounds'] }), /when you gain a level/);
  assert.throws(() => book.chooseSpells(state, bard, { cantrips: ['Light', 'Minor Illusion'] }), /when you gain a level/);

  state = book.onLevelUp(state, sources, 'Bard');
  state = book.chooseSpells(state, bard, { prepared: ['Detect Magic', 'Charm Person', 'Healing Word', 'Faerie Fire', 'Thunderwave', 'Cure Wounds'] }).state;
  state = book.chooseSpells(state, bard, { cantrips: ['Light', 'Minor Illusion'] }).state;
  assert.throws(() => book.chooseSpells(state, bard, { prepared: ['Sleep', 'Charm Person', 'Healing Word', 'Faerie Fire', 'Thunderwave', 'Cure Wounds'] }), /when you gain a level/);
});

test('strict changes: Paladins swap one spell after a Long Rest', () => {
  const sources = sourcesFor([{ className: 'Paladin', level: 5 }]);
  const paladin = sourceOf(sources, 'Paladin');
  let { state } = book.chooseSpells(book.readSpellcasting({}), paladin, { prepared: ['Bless', 'Cure Wounds', 'Detect Magic'] });
  state = book.onLongRest(state, sources);
  state = book.chooseSpells(state, paladin, { prepared: ['Bless', 'Cure Wounds', 'Aid'] }).state;
  assert.throws(() => book.chooseSpells(state, paladin, { prepared: ['Detect Magic', 'Cure Wounds', 'Aid'] }), /one spell after a Long Rest/);
});

test('Magic Initiate gives two cantrips, one level 1 spell and a free cast per Long Rest', () => {
  const sheetData = { originFeats: [{ name: 'Magic Initiate', spellList: 'Cleric', spellAbility: 'wis' }] };
  const sources = sourcesFor([{ className: 'Fighter', subclassName: 'Champion', level: 3 }], sheetData);
  const feat = sourceOf(sources, 'Magic Initiate (Cleric)');
  assert.ok(feat);
  assert.throws(() => book.chooseSpells(book.readSpellcasting({}), feat, { prepared: ['Aid'] }), /up to level 1/);
  let { state } = book.chooseSpells(book.readSpellcasting({}), feat, { cantrips: ['Guidance', 'Sacred Flame'], prepared: ['Bless'] });
  state = book.castSpell(state, sources, { source: feat.key, spell: 'Bless', free: true }).state;
  assert.throws(() => book.castSpell(state, sources, { source: feat.key, spell: 'Bless', free: true }), /returns after a Long Rest/);
  state = book.onLongRest(state, sources);
  assert.doesNotThrow(() => book.castSpell(state, sources, { source: feat.key, spell: 'Bless', free: true }));
});

test('species spells unlock with character level', () => {
  const at = level => sourceOf(book.getSpellSources({
    classes: [{ className: 'Wizard', level }], species: 'Elf', sheetData: { speciesOption: 'High Elf', speciesSpellAbility: 'int' }
  }), 'Elf:High Elf');
  assert.deepEqual(book.listOf(book.readSpellcasting({}), at(3)), { cantrips: ['Prestidigitation'], prepared: ['Detect Magic'], spellbook: [] });
  assert.deepEqual(book.listOf(book.readSpellcasting({}), at(5)).prepared, ['Detect Magic', 'Misty Step']);
  assert.throws(() => book.chooseSpells(book.readSpellcasting({}), at(5), { prepared: [] }), /fixed/);
});

test('casting: slots, pact slots, rituals and concentration', () => {
  const sources = sourcesFor([{ className: 'Wizard', subclassName: 'Evoker', level: 3 }, { className: 'Warlock', level: 1 }]);
  let { state } = book.chooseSpells(book.readSpellcasting({}), sourceOf(sources, 'Wizard'), {
    cantrips: ['Fire Bolt'], addToSpellbook: ['Find Familiar', 'Sleep', 'Web'], prepared: ['Sleep', 'Web']
  });
  state = book.chooseSpells(state, sourceOf(sources, 'Warlock'), { cantrips: ['Eldritch Blast'], prepared: ['Hex'] }).state;

  assert.equal(book.castSpell(state, sources, { source: 'Wizard', spell: 'Fire Bolt' }).slotChange, null);
  assert.throws(() => book.castSpell(state, sources, { source: 'Wizard', spell: 'Eldritch Blast' }), /not one of your Wizard cantrips/);
  assert.throws(() => book.castSpell(state, sources, { source: 'Wizard', spell: 'Web', slotLevel: 1 }), /level 2 or higher/);
  assert.deepEqual(book.castSpell(state, sources, { source: 'Wizard', spell: 'Web', slotLevel: 2 }).slotChange, { level: 2 });
  assert.deepEqual(book.castSpell(state, sources, { source: 'Warlock', spell: 'Hex', pact: true }).slotChange, { level: 'pact' });
  // Ritual Adept: a ritual from the spellbook needs no slot and no preparation.
  const ritual = book.castSpell(state, sources, { source: 'Wizard', spell: 'Find Familiar', ritual: true });
  assert.equal(ritual.slotChange, null);
  assert.throws(() => book.castSpell(state, sources, { source: 'Wizard', spell: 'Sleep', ritual: true }), /Ritual tag/);

  state = book.castSpell(state, sources, { source: 'Wizard', spell: 'Web', slotLevel: 2 }).state;
  assert.equal(state.concentration.spell, 'Web');
  const swap = book.castSpell(state, sources, { source: 'Warlock', spell: 'Hex', pact: true });
  assert.ok(swap.events.includes('concentrationReplaced'));
  assert.equal(swap.state.concentration.spell, 'Hex');

  const hit = book.concentrationAfterDamage(swap.state, 34, { droppedToZero: false });
  assert.deepEqual(hit.check, { dc: 17, spell: 'Hex' });
  assert.equal(book.concentrationAfterDamage(swap.state, 4, { droppedToZero: false }).check.dc, 10);
  assert.equal(book.concentrationAfterDamage(swap.state, 80, { droppedToZero: true }).state.concentration, null);
});

test('removing levels trims choices that no longer fit', () => {
  const at3 = sourcesFor([{ className: 'Cleric', level: 3 }]);
  let { state } = book.chooseSpells(book.readSpellcasting({}), sourceOf(at3, 'Cleric'), {
    cantrips: ['Guidance', 'Sacred Flame', 'Light'], prepared: ['Bless', 'Cure Wounds', 'Healing Word', 'Detect Magic', 'Aid', 'Hold Person']
  });
  const at1 = sourcesFor([{ className: 'Cleric', level: 1 }]);
  state = book.fitToLimits(state, at1);
  assert.deepEqual(state.classes.Cleric.prepared, ['Bless', 'Cure Wounds', 'Healing Word', 'Detect Magic']);
  assert.equal(state.classes.Cleric.cantrips.length, 3);
});
