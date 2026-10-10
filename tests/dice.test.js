const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const fixed = values => () => values.shift();

test('dice formulas roll with advantage, disadvantage, crits and kept dice', () => {
  assert.deepEqual(rules.parseFormula('2d6 + 1d8 - 1').map(term => term.sides || term.sign * term.flat), [6, 8, -1]);
  assert.throws(() => rules.parseFormula('1d20+'), /Can't read/);
  assert.throws(() => rules.parseFormula('100d6'), /1–50 dice/);

  let roll = rules.rollFormula('1d20+5', { mode: 'advantage', rng: fixed([4, 17]) });
  assert.equal(roll.total, 22);
  assert.equal(roll.natural, 17);
  assert.equal(rules.describeRoll(roll), '2d20 [~~4~~, 17] + 5');
  roll = rules.rollFormula('1d20+5', { mode: 'disadvantage', rng: fixed([4, 17]) });
  assert.equal(roll.total, 9);
  roll = rules.rollFormula('2d6+4', { critical: true, rng: fixed([1, 2, 3, 4]) });
  assert.equal(roll.formula, '4d6+4');
  assert.equal(roll.total, 14);
  assert.equal(rules.rollFormula('4d6kh3', { rng: fixed([1, 6, 5, 4]) }).total, 15);
  assert.equal(rules.rollFormula('5').total, 5, 'flat damage (unarmed strike)');
  const real = rules.rollFormula('1d20');
  assert.ok(real.total >= 1 && real.total <= 20);
});

function fighter(playerId) {
  const character = rules.buildStartingCharacter({
    name: 'Kael', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Great Weapon Fighting',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  });
  return db.insertStartingCharacter(playerId, character);
}

test('each character can roll the bonuses on their sheet', () => {
  const id = fighter(createPlayer());
  const options = db.rollOptions(db.getCharacterById(id));
  const formula = key => options.get(key).formula;
  assert.equal(formula('check:str'), '1d20+3');
  assert.equal(formula('save:str'), '1d20+5', 'proficient STR save');
  assert.equal(formula('skill:Athletics'), '1d20+5');
  assert.equal(formula('skill:Arcana'), '1d20-1');
  assert.equal(formula('initiative'), '1d20+3', 'DEX +1 and Alert adds proficiency');
  const greatsword = [...options.values()].find(option => /^Greatsword attack/.test(option.label));
  assert.equal(greatsword.formula, '1d20+5');
  assert.equal(options.get(greatsword.id.replace(':hit', ':damage')).formula, '2d6+3');
});

test('who may roll: owner, admin and the DM of a running adventure', async () => {
  const owner = createPlayer();
  const stranger = createPlayer();
  const dm = createPlayer();
  const id = fighter(owner);
  const asOwner = { characterId: id, user: { id: owner, role: 'player' } };

  const roll = db.rollForCharacter({ ...asOwner, request: { roll: 'skill:Athletics', mode: 'advantage' } });
  assert.equal(roll.label, 'Athletics (STR)');
  assert.equal(roll.formula, '2d20kh1+5');
  assert.equal(roll.mode, 'advantage');
  assert.ok(roll.total >= 6 && roll.total <= 25);
  assert.throws(() => db.rollForCharacter({ characterId: id, user: { id: stranger, role: 'player' }, request: { roll: 'initiative' } }), /Forbidden/);
  assert.ok(db.rollForCharacter({ characterId: id, user: { id: 0, role: 'admin' }, request: { roll: 'initiative' } }).total);
  assert.throws(() => db.rollForCharacter({ ...asOwner, request: { roll: 'skill:Cooking' } }), /not on this character sheet/);

  // Custom formulas, and crits only double damage.
  const custom = db.rollForCharacter({ ...asOwner, request: { formula: '1d4+1d6', label: 'Bless + Hex', critical: true } });
  assert.equal(custom.formula, '2d4+2d6');
  assert.equal(custom.label, 'Bless + Hex — critical');
  const save = db.rollForCharacter({ ...asOwner, request: { roll: 'save:con', critical: true } });
  assert.equal(save.critical, false);

  // The DM of a running adventure rolls for the party.
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('dm-discord', dm);
  const { adventure } = db.createAdventureFromThread({ threadId: 'dice-thread', title: 'Test', ownerDiscordId: 'dm-discord' });
  assert.throws(() => db.rollForCharacter({ characterId: id, user: { id: dm, role: 'player' }, request: { roll: 'initiative' } }), /Forbidden/);
  db.setPartyMember({ adventureId: adventure.id, user: { id: dm, role: 'player' }, characterId: id, inParty: true });
  const secret = db.rollForCharacter({ characterId: id, user: { id: dm, role: 'player' }, request: { roll: 'save:wis', private: true } });
  assert.equal(secret.private, true);

  // Private rolls: hidden from the party, shown to the DM.
  const forOwner = db.getAdventureTable({ adventureId: adventure.id, user: { id: owner, role: 'player' } }).rolls.find(entry => entry.id === secret.id);
  assert.equal(forOwner.total, null);
  assert.equal(forOwner.text, 'Private roll for the DM');
  const forDm = db.getAdventureTable({ adventureId: adventure.id, user: { id: dm, role: 'player' } }).rolls.find(entry => entry.id === secret.id);
  assert.equal(forDm.total, secret.total);
});

test('the Owlbear key reads only its own player\'s new rolls', () => {
  const player = createPlayer();
  const other = createPlayer();
  const id = fighter(player);
  const otherId = fighter(other);
  const key = db.getVttKey({ playerId: player });
  assert.equal(db.getVttKey({ playerId: player }), key, 'the same key until a new one is made');
  assert.throws(() => db.getVttKey({ playerId: 0 }), /Only player accounts/);

  db.rollForCharacter({ characterId: id, user: { id: player, role: 'player' }, request: { roll: 'initiative' } });
  const first = db.getVttRolls({ key });
  assert.deepEqual(first.rolls, [], 'first contact: no history');
  assert.ok(first.latest > 0);

  const a = db.rollForCharacter({ characterId: id, user: { id: player, role: 'player' }, request: { roll: 'check:dex' } });
  db.rollForCharacter({ characterId: otherId, user: { id: other, role: 'player' }, request: { roll: 'check:dex' } });
  const b = db.rollForCharacter({ characterId: id, user: { id: player, role: 'player' }, request: { roll: 'save:con', private: true } });
  const feed = db.getVttRolls({ key, after: first.latest });
  assert.deepEqual(feed.rolls.map(roll => roll.id), [a.id, b.id]);
  assert.equal(feed.rolls[1].private, true);
  assert.equal(feed.rolls[0].character, 'Kael');

  const fresh = db.getVttKey({ playerId: player, regenerate: true });
  assert.notEqual(fresh, key);
  assert.throws(() => db.getVttRolls({ key }), /Unknown key/);
});

test('the extension manifest and feed are public, with CORS', async () => {
  const express = require('express');
  const app = express();
  app.use('/vtt', require('../vtt'));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const manifest = await fetch(`${base}/vtt/manifest.json`);
    assert.equal(manifest.headers.get('access-control-allow-origin'), '*');
    const body = await manifest.json();
    assert.equal(body.manifest_version, 1);
    assert.equal(body.background_url, '/vtt/background.html');
    assert.equal(body.action.popover, '/vtt/popover.html');
    for (const file of ['/vtt/background.html', '/vtt/popover.html', '/vtt/background.js', '/vtt/shared.js', '/vtt/icon.svg']) {
      assert.equal((await fetch(base + file)).status, 200, file);
    }
    const denied = await fetch(`${base}/vtt/rolls?key=not-a-real-key-at-all`);
    assert.equal(denied.status, 401);
  } finally {
    server.close();
  }
});

test('panel d20 rolls show in the roll history and count towards the d20 stats', () => {
  const owner = createPlayer();
  const id = fighter(owner);
  const before = db.getDiceAnalytics();
  const user = { id: owner, role: 'player' };
  const advantage = db.rollForCharacter({ characterId: id, user, request: { roll: 'skill:Athletics', mode: 'advantage' } });
  db.rollForCharacter({ characterId: id, user, request: { roll: 'attack:0:damage' } });
  const secret = db.rollForCharacter({ characterId: id, user, request: { roll: 'save:wis', private: true } });

  const history = db.getSheetD20Rolls({ limit: 10 });
  const listed = history.find(roll => roll.id === advantage.id);
  assert.equal(listed.faces.length, 2, 'both dice of an advantage roll');
  assert.equal(listed.faces.filter(face => face.kept).length, 1);
  assert.ok(!history.some(roll => /damage/.test(roll.label)), 'rolls without a d20 are left out');
  const hidden = history.find(roll => roll.id === secret.id);
  assert.equal(hidden.total, null);
  assert.deepEqual(hidden.faces, []);
  assert.equal(db.getSheetD20Rolls({ limit: 10, showPrivate: true }).find(roll => roll.id === secret.id).total, secret.total);
  assert.equal(db.getSheetD20Rolls({ limit: 10, viewerId: owner }).find(roll => roll.id === secret.id).total, secret.total, 'the roller sees their own');

  const after = db.getDiceAnalytics();
  assert.equal(after.sheetRolls - before.sheetRolls, 3, '2 dice for advantage + 1 for the save');
  assert.equal(after.totalRolls - before.totalRolls, 3);
  assert.equal(Object.values(after.distribution).reduce((sum, count) => sum + count, 0), after.totalRolls);
});
