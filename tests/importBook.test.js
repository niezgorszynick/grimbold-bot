// scripts/import-book.js: feats, species, magic items and stat blocks from a
// book exported to Markdown, on made-up text in the export's style.
const test = require('node:test');
const assert = require('node:assert/strict');
const importer = require('../scripts/import-book');

const BOOK = [
  '# Feats', '',
  '## Lucky Socks', '', 'General Feat (Prerequisite: Level 4+; Spellcasting or Pact Magic Feature)', '', '**Repeatable:** Yes', '',
  'You gain the following benefits.', '', '***Ability Score Increase.*** Increase one score by 1.', '',
  '# Species', '',
  '## Mothfolk', '', '- **Creature Type:** Fey', '- **Size:** Small', '- **Speed:** 30 feet', '',
  '***Darkvision.*** You see in the dark.', '', '***Dusty Wings.*** You flutter.', '', '- **Glide.** You glide.', '',
  '# Magic Items', '',
  '#### Shiny Sword', '', 'Generic Variant, Rare (Requires Attunement By a Spellcaster)', '', '---', '',
  'This magic weapon glows.', '', '***Base items.*** This item variant can be applied to:', '', '- *Longsword*', '',
  '#### Odd Potion', '', 'Potion, Common, 50 GP, ½ lb.', '', '---', '', 'Tastes odd.', '',
  '# Bestiary', '',
  '## Grumbler', '', 'Grumblers grumble.', '',
  '___', '>## Grumbler', '>*Small Fey, Neutral*', '>___', '>- **Armor Class** 12', '>- **Hit Points** 9 (2d6 + 2)', '>- **Speed** 30 ft.',
  '>- **Initiative** +1 (11)', '>___', '>|STR|DEX|CON|INT|WIS|CHA|', '>|:---:|:---:|:---:|:---:|:---:|:---:|', '>|8 (-1)|12 (+1)|12 (+1)|10 (+0)|10 (+0)|14 (+2)|',
  '>___', '>- **Saving Throws** Cha +4', '>- **Damage Resistances** Psychic', '>- **Challenge** 1/2 (XP 100; PB +2)', '>- **Proficiency Bonus** +2', '>___',
  '>***Grumpy.*** It grumbles.  ', '>', '>### Actions', '>***Poke.*** *Melee Attack Roll:*  +3, reach 5 ft. *Hit:* 3 (1d4 + 1) Piercing damage.  ',
  '>', '>### Legendary Actions', '>*Legendary Action Uses: 1.*', '>- **Sulk.** It sulks.', '>', '>### Regional Effects', '>- **Gloom.** Gloomy.', '',
  '___', '>## Vestige Pet', '>*Tiny Fey*', '>- **Armor Class** 13 + your Charisma modifier', '>|1 (-5)|1 (-5)|1 (-5)|1 (-5)|1 (-5)|1 (-5)|', ''
].join('\n');

test('a feat becomes a feats.md entry with its category and prerequisite', () => {
  const entry = importer.featEntry(BOOK, 'Lucky Socks', { source: 'Test' });
  assert.match(entry, /^# Lucky Socks\n\n- \*\*Category\*\*: General Feat\n- \*\*Prerequisite\*\*: Level 4\+, Spellcasting or Pact Magic Feature\n- \*\*Source\*\*: Test\n\n### Benefits\n\nYou gain/);
  assert.match(entry, /\*\*Ability Score Increase\.\*\* Increase one score by 1\./);
  assert.doesNotMatch(entry, /Repeatable:/);
});

test('a species: fields, and one section per trait', () => {
  const entry = importer.speciesEntry(BOOK, 'Mothfolk');
  assert.match(entry, /^## Mothfolk\n- Creature Type: Fey\n- Size: Small\n- Speed: 30 feet\n\n### Darkvision\nYou see in the dark\.\n\n### Dusty Wings\nYou flutter\.\n\n- \*\*Glide\.\*\* You glide\./);
});

test('magic items: type, rarity and attunement from the first line; a variant\'s type from its text', () => {
  const [[sword, swordText], [potion, potionText]] = importer.itemEntries(BOOK, 'Magic Items');
  assert.equal(sword, 'Shiny Sword');
  assert.match(swordText, /- \*\*Type\*\*: Weapon \(Any Simple or Martial\)\n- \*\*Rarity\*\*: Rare\n- \*\*Attunement\*\*: Requires Attunement by a Spellcaster/);
  assert.doesNotMatch(swordText, /Base items|Longsword/);
  assert.equal(potion, 'Odd Potion');
  assert.match(potionText, /- \*\*Type\*\*: Potion\n- \*\*Rarity\*\*: Common\n- \*\*Attunement\*\*: None/);
});

test('stat blocks become monsters.md entries the Monsters tab reads', () => {
  const entries = importer.statblockEntries(BOOK, { source: 'Arcana Unleashed' });
  assert.deepEqual(entries.map(([name]) => name), ['Grumbler'], 'the companion with "your" stats is skipped');
  const [, text] = entries[0];
  assert.match(text, /\| \*\*Cha\*\* \| 14 \| \+2 \| \+4 \|/);
  assert.match(text, /- \*\*Resistances\*\*: Psychic/);
  assert.doesNotMatch(text, /Proficiency Bonus/);
  const { parseContentMarkdown, parseMonster } = { ...require('../rules/content'), ...require('../rules/monsters') };
  const monster = parseMonster(Object.values(parseContentMarkdown(text))[0]);
  assert.equal(monster.armorClass, 12);
  assert.equal(monster.hitPoints, 9);
  assert.equal(monster.cr, 0.5);
  assert.equal(monster.sourceCode, 'AU');
  assert.equal(monster.actions[0].name, 'Poke');
  assert.deepEqual(monster.legendaryActions.map(action => action.name), ['Sulk']);
  assert.match(monster.lore, /Grumblers grumble\.[\s\S]*Regional effects[\s\S]*Gloom/);
});
