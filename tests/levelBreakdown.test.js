const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const renderAdminPage = require('../views/adminPage');

function addCharacter(playerId, name) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, '{}')
  `).run(playerId, name).lastInsertRowid);
}

test('the level breakdown: adventure by adventure, DM rewards, the rest, and the next level', () => {
  assert.deepEqual([3, 4, 5, 6, 20, 21].map(db.xpForLevel), [0, 3, 7, 11, 67, null]);
  const ola = createPlayer();
  const dm = createPlayer();
  const kael = addCharacter(ola, 'Kael');
  const ysolde = addCharacter(dm, 'Ysolde');
  const finish = (title, xp, dmCharacterId = null) => db.recordAdventure({ title, description: '', xp_awarded: xp, dm_player_id: dm, dm_character_id: dmCharacterId, character_ids: [kael] });
  finish('Wolves of the Vale', 2);
  finish('The Sunken Shrine', 1);
  finish('Ashfall', 1, ysolde);

  let breakdown = db.getCharacterLevelBreakdown(kael);
  assert.deepEqual(breakdown.entries.map(entry => [entry.title, entry.xp, entry.total, entry.levelUp]),
    [['Wolves of the Vale', 2, 2, null], ['The Sunken Shrine', 1, 3, 4], ['Ashfall', 1, 4, null]]);
  assert.deepEqual([breakdown.xp, breakdown.level, breakdown.fromAdventures, breakdown.other], [4, 4, 4, 0]);
  assert.deepEqual(breakdown.next, { level: 5, at: 7, needed: 3 });

  const dmSide = db.getCharacterLevelBreakdown(ysolde);
  assert.deepEqual(dmSide.entries.map(entry => [entry.title, entry.kind, entry.xp]), [['Ashfall', 'dm', 1]]);

  // XP the records don't explain (a DM point spent, a DM's edit) is one line.
  db.prepare('UPDATE characters SET xp = 6 WHERE id = ?').run(kael);
  breakdown = db.getCharacterLevelBreakdown(kael);
  assert.equal(breakdown.other, 2);
  assert.deepEqual(breakdown.next, { level: 5, at: 7, needed: 1 });

  const html = renderAdminPage({ session: { user: { id: ola, discord_tag: 'ola', role: 'player' } }, query: { tab: 'character-sheet', edit_char: String(kael) } });
  assert.match(html, /<details class="sheet-card level-breakdown">/);
  assert.match(html, /The Sunken Shrine[\s\S]*?Level 4/);
  assert.match(html, /DM points spent on this character/);
  assert.match(html, /Level 5 at 7 XP: 1 more to go\./);
});

test('the Adventures tab shows who took part under each adventure', () => {
  const ola = createPlayer();
  const dm = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('party-dm', dm);
  const brin = addCharacter(ola, 'Brin');
  const odo = addCharacter(dm, 'Odo');
  const done = db.recordAdventure({ title: 'The Old Mill', description: '', xp_awarded: 1, dm_player_id: dm, dm_character_id: odo, character_ids: [brin] });
  const { adventure } = db.createAdventureFromThread({ threadId: 'party-thread', title: 'Into the Fen', ownerDiscordId: 'party-dm' });
  db.setPartyMember({ adventureId: adventure.id, user: { id: dm, role: 'player' }, characterId: brin, inParty: true });

  const parties = db.getAdventureParties([adventure.id, typeof done === 'object' ? done.id || done.adventureId : done]);
  assert.deepEqual(parties[adventure.id].map(member => member.name), ['Brin']);

  const html = renderAdminPage({ session: { user: { id: 0, discord_tag: 'admin', role: 'admin' } }, query: { tab: 'adventures' } });
  assert.match(html, /Into the Fen[\s\S]*?adventure-party[\s\S]*?Brin/);
  assert.match(html, /The Old Mill<\/strong><div class="adventure-party small"><span class="muted">Party:<\/span> Brin[\s\S]*?DM reward:<\/span> Odo/);
});
