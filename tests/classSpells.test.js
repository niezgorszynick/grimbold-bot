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

test('the Root DM and chosen players grant any spell (debug mode): always prepared, cast with slots, at will or once per Long Rest', () => {
  const root = { id: 0, discord_tag: 'admin', role: 'admin' };
  const granter = createPlayer();
  db.prepare("UPDATE players SET discord_id = '210398055516602369' WHERE id = ?").run(granter);
  const dm = createPlayer('admin');
  const id = addCharacter('Fighter', 'Champion', 5);
  assert.equal(db.canGrantSpells(root), true);
  assert.equal(db.canGrantSpells({ id: granter, role: 'player' }), true, 'on the list');
  assert.equal(db.canGrantSpells({ id: dm, role: 'admin' }), false, 'a DM is not, unless listed');
  assert.equal(db.canGrantSpells({ id: player, role: 'player' }), false);
  assert.throws(() => db.grantCharacterSpell({ id, user: { id: player, role: 'player' }, action: 'grant', spell: 'Fireball' }), /Forbidden/);
  assert.throws(() => db.grantCharacterSpell({ id, user: root, action: 'grant', spell: 'Fireballz' }), /no spell called/);

  db.grantCharacterSpell({ id, user: root, action: 'grant', spell: 'fireball', uses: 'longRest' });
  db.grantCharacterSpell({ id, user: { id: granter, role: 'player' }, action: 'grant', spell: 'Fire Bolt', uses: 'atWill' });
  const { spells } = db.grantCharacterSpell({ id, user: root, action: 'grant', spell: 'Guiding Bolt' });
  const granted = sourceOf(spells, 'Granted');
  assert.deepEqual(granted.alwaysPrepared, ['Fireball', 'Fire Bolt', 'Guiding Bolt']);
  assert.deepEqual(granted.grantedUses, { Fireball: 'longRest', 'Fire Bolt': 'atWill', 'Guiding Bolt': 'slots' });
  assert.equal(granted.freeLeft.Fireball, 1);
  assert.equal(granted.freeLeft['Fire Bolt'], 'atWill');
  assert.equal(granted.ability, 'wis', 'a non-caster: the highest of INT, WIS and CHA');
  assert.ok(spells.spellDice.Granted.Fireball, 'its dice roll');

  db.castCharacterSpell({ ...asOwner(id), request: { source: 'Granted', spell: 'Fireball', free: true } });
  assert.throws(() => db.castCharacterSpell({ ...asOwner(id), request: { source: 'Granted', spell: 'Fireball', free: true } }), /Long Rest/);
  assert.throws(() => db.chooseCharacterSpells({ ...asOwner(id), source: 'Granted', request: { prepared: [] } }), /fixed/);

  db.grantCharacterSpell({ id, user: root, action: 'grantAbility', ability: 'cha' });
  assert.equal(sourceOf(db.getCharacterSpells(asOwner(id)), 'Granted').ability, 'cha');
  db.grantCharacterSpell({ id, user: root, action: 'grant', spell: 'Fireball', uses: 'slots' });
  assert.equal(sourceOf(db.getCharacterSpells(asOwner(id)), 'Granted').grantedUses.Fireball, 'slots', 'granting again changes how');
  for (const spell of ['Fireball', 'Fire Bolt', 'Guiding Bolt']) db.grantCharacterSpell({ id, user: root, action: 'ungrant', spell });
  assert.equal(sourceOf(db.getCharacterSpells(asOwner(id)), 'Granted'), undefined);
  assert.throws(() => db.grantCharacterSpell({ id, user: root, action: 'ungrant', spell: 'Fireball' }), /isn't a granted spell/);
});

test('through the API: the sheet learns who may grant, and only they can', async () => {
  const express = require('express');
  const granter = createPlayer();
  db.prepare("UPDATE players SET discord_id = '210398055516602369-api' WHERE id = ?").run(granter);
  db.prepare("UPDATE config SET value = ? WHERE key = 'spell_granters'").run(JSON.stringify(['210398055516602369', '210398055516602369-api']));
  const id = addCharacter('Wizard', 'Evoker', 3);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const call = (userId, method, body) => fetch(`http://127.0.0.1:${server.address().port}/api/characters/${id}/spells`, {
    method, headers: { 'x-user': String(userId), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  });
  try {
    assert.equal((await (await call(player, 'GET')).json()).canGrant, false);
    assert.equal((await call(player, 'POST', { action: 'grant', spell: 'Wish' })).status, 403);
    assert.equal((await (await call(granter, 'GET')).json()).canGrant, true);
    const granted = await (await call(granter, 'POST', { action: 'grant', spell: 'Wish', uses: 'longRest' })).json();
    assert.equal(granted.spells.canGrant, true);
    assert.ok(granted.spells.sources.find(source => source.key === 'Granted').alwaysPrepared.includes('Wish'));
  } finally {
    server.close();
  }
});
