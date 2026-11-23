// Spells a class itself always has prepared (Paladin's Smite, Faithful
// Steed, Favored Enemy), and the free Divine Smite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { db, createPlayer } = require('./helpers/tempDatabase');

const player = createPlayer();
const sheet = JSON.stringify({ abilities: { str: { score: 16 }, dex: { score: 10 }, con: { score: 14 }, int: { score: 10 }, wis: { score: 16 }, cha: { score: 16 } } });
function addCharacter(className, subclass, level) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', ?, ?, ?, 0, 'alive', 0, ?)
  `).run(player, `${className} ${level}`, className, subclass, level, sheet).lastInsertRowid);
}
const asOwner = id => ({ id, player_id: player, is_admin: false });
const sourceOf = (view, key) => view.sources.find(source => source.key === key);

test("a Paladin always has Divine Smite from level 2 (once free per Long Rest) and Find Steed from level 5", () => {
  assert.deepEqual(sourceOf(db.getCharacterSpells(asOwner(addCharacter('Paladin', 'Oath of Devotion', 1))), 'Paladin').alwaysPrepared, []);
  const id = addCharacter('Paladin', 'Oath of Devotion', 5);
  const paladin = sourceOf(db.getCharacterSpells(asOwner(id)), 'Paladin');
  assert.ok(paladin.alwaysPrepared.includes('Divine Smite') && paladin.alwaysPrepared.includes('Find Steed'));
  assert.ok(paladin.alwaysPrepared.includes('Protection from Evil and Good'), 'the oath spells too');
  assert.equal(paladin.alwaysPreparedFrom['Divine Smite'], "Paladin's Smite");
  assert.equal(paladin.alwaysPreparedFrom['Find Steed'], 'Faithful Steed');
  assert.ok(paladin.prepared.includes('Divine Smite'));
  assert.equal(paladin.freeLeft['Divine Smite'], 1);
  assert.equal(paladin.freeLeft['Find Steed'] || 0, 0, "Faithful Steed's free cast is on the Resources card");
  assert.ok(db.getCharacterSpells(asOwner(id)).spellDice.Paladin['Divine Smite'], 'its dice are rollable');

  const cast = db.castCharacterSpell({ ...asOwner(id), request: { source: 'Paladin', spell: 'Divine Smite', free: true } });
  assert.ok(cast.events.includes('freeCast'));
  assert.equal(sourceOf(db.getCharacterSpells(asOwner(id)), 'Paladin').freeLeft['Divine Smite'], 0);
  assert.throws(() => db.castCharacterSpell({ ...asOwner(id), request: { source: 'Paladin', spell: 'Divine Smite', free: true } }), /returns after a Long Rest/);
  db.castCharacterSpell({ ...asOwner(id), request: { source: 'Paladin', spell: 'Divine Smite', slotLevel: 2 } });
});

test("a Ranger always has Hunter's Mark prepared", () => {
  const ranger = sourceOf(db.getCharacterSpells(asOwner(addCharacter('Ranger', 'Hunter', 1))), 'Ranger');
  assert.ok(ranger.prepared.includes("Hunter's Mark"));
  assert.equal(ranger.alwaysPreparedFrom["Hunter's Mark"], 'Favored Enemy');
});

test('each spell shows what it rolls on its line: the spell attack, the save DC, its dice', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'character-spells.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(code));
  const body = code.slice(code.indexOf('function quickRolls'), code.indexOf('function spellRow'));
  // The function on its own, with stand-ins for the page's helpers.
  const make = new Function('el', 'signed', 'shift', 'diceLinks', 'SAVE_ABILITY', `${body}; return quickRolls;`);
  const el = (tag, props = {}, children = []) => ({ tag, ...props, children });
  const diceLinks = () => (token, index) => ({ tag: 'button', textContent: token.replace(/\s+/g, ''), index });
  const quickRolls = make(el, n => (n >= 0 ? '+' : '') + n, () => 0, diceLinks,
    { Strength: 'STR', Dexterity: 'DEX', Constitution: 'CON', Intelligence: 'INT', Wisdom: 'WIS', Charisma: 'CHA' });
  const source = { key: 'Cleric', attackBonus: 5, saveDc: 13 };
  const spells = require('../rules').getSpellCatalog();
  const shown = name => {
    const result = quickRolls(source, spells[name], spells[name].level);
    return result ? result.children.map(part => part.text || part.textContent) : [];
  };
  assert.deepEqual(shown('Guiding Bolt'), ['🎯 +5', '4d6 Radiant']);
  assert.deepEqual(shown('Inflict Wounds'), ['DC 13 CON', '2d10 Necrotic']);
  assert.deepEqual(shown('Divine Smite'), ['2d8 Radiant', '1d8']);
  assert.deepEqual(shown('Fire Bolt'), ['🎯 +5', '1d10 Fire']);
  assert.deepEqual(shown('Detect Magic'), []);
});
