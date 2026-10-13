const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { db, createPlayer } = require('./helpers/tempDatabase');

function addCharacter(playerId, name) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Dwarf', 'Fighter', 'Champion', 3, 0, 'alive', 0, '{}')
  `).run(playerId, name).lastInsertRowid);
}

test('every change to a character, party or roll is noted in the change log', () => {
  const id = addCharacter(createPlayer(), 'Logged');
  const before = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM change_log').get().id;
  db.prepare("UPDATE characters SET sheet_data = '{\"hpCurrent\":3}' WHERE id = ?").run(id);
  db.prepare("INSERT INTO dice_rolls (character_id, label, formula, mode, total, detail) VALUES (?, 'Test', '1d20', 'normal', 7, '{}')").run(id);
  const rows = db.prepare('SELECT kind, ref_id FROM change_log WHERE id > ? ORDER BY id').all(before);
  assert.deepEqual(rows, [{ kind: 'character', ref_id: id }, { kind: 'roll', ref_id: id }]);
});

test('the adventure table hears about party changes at once, and only those', async () => {
  const dm = createPlayer();
  const owner = createPlayer();
  const stranger = createPlayer();
  for (const id of [dm, owner, stranger]) db.prepare("UPDATE players SET password_hash = 'x' WHERE id = ?").run(id);
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('live-dm', dm);
  const member = addCharacter(owner, 'In the party');
  const outsider = addCharacter(owner, 'Not in it');
  const { adventure } = db.createAdventureFromThread({ threadId: 'live-thread', title: 'Live', ownerDiscordId: 'live-dm' });
  db.setPartyMember({ adventureId: adventure.id, user: { id: dm, role: 'player' }, characterId: member, inParty: true });

  const app = express();
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/adventures/${adventure.id}/live`;
  const controller = new AbortController();
  try {
    assert.equal((await fetch(url, { headers: { 'x-user': String(stranger) } })).status, 403);

    const response = await fetch(url, { headers: { 'x-user': String(dm) }, signal: controller.signal });
    assert.match(response.headers.get('content-type'), /^text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const nextEvent = async () => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const match = buffer.match(/data: (.*)\n\n/);
        if (match) {
          buffer = buffer.slice(buffer.indexOf(match[0]) + match[0].length);
          return JSON.parse(match[1]);
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      throw new Error('No event within 3 s');
    };
    await new Promise(resolve => setTimeout(resolve, 100));

    // Someone outside the party changes: nothing. A party member: an event.
    db.prepare("UPDATE characters SET sheet_data = '{\"hpCurrent\":1}' WHERE id = ?").run(outsider);
    db.prepare("UPDATE characters SET sheet_data = '{\"hpCurrent\":9}' WHERE id = ?").run(member);
    const started = Date.now();
    assert.deepEqual(await nextEvent(), { characters: [member], adventure: false, rolls: false });
    assert.ok(Date.now() - started < 1500, 'within about half a second');

    db.setPartyMember({ adventureId: adventure.id, user: { id: dm, role: 'player' }, characterId: outsider, inParty: true });
    assert.equal((await nextEvent()).adventure, true, 'the party changed');
  } finally {
    controller.abort();
    server.close();
  }
});
