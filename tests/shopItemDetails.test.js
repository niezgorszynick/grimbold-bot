const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { shopItemDetails } = require('../views/shopItemDetails');

test('magic items: rarity and attunement, with the item text', () => {
  const about = shopItemDetails({ name: 'Amulet of Health', description: 'A fine item from Grimbold.' });
  assert.match(about.summary, /Wondrous Item, rare, requires attunement/);
  assert.match(about.text, /sets Constitution to 19/);
  assert.doesNotMatch(about.text, /fine item/); // the seed placeholder is left out
});

test('spell scrolls show the spell; weapons and armor their stats', () => {
  const scroll = shopItemDetails({ name: 'Spell Scroll (Level 1: Magic Missile)', description: 'A spell scroll of Magic Missile.' });
  assert.match(scroll.summary, /^Magic Missile: Level 1/);
  assert.match(scroll.text, /A spell scroll of Magic Missile\./);
  assert.match(scroll.text, /Placeholder description for Magic Missile/);
  assert.match(shopItemDetails({ name: 'Longbow', description: '' }).summary, /Martial ranged weapon: 1d8 piercing/);
  assert.match(shopItemDetails({ name: 'Chain Mail', description: '' }).summary, /Heavy armor: AC 16/);
  assert.match(shopItemDetails({ name: 'Shield', description: '' }).summary, /^Shield: \+2 AC/);
});

test('other goods keep their own description, or have none', () => {
  assert.deepEqual(shopItemDetails({ name: 'Rope (50 feet)', description: 'Hempen rope.' }), { summary: '', text: 'Hempen rope.' });
  assert.equal(shopItemDetails({ name: 'Mystery Box', description: '' }), null);
});
