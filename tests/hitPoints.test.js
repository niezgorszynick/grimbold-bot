const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

test('current and max HP can be set directly (e.g. Aid)', () => {
  const context = { baseHpMax: 24 };
  const vitals = rules.normalizeVitals({ hpCurrent: 20, hpMaxBonus: 0 }, 24);
  const aid = rules.applyVitalsAction(vitals, 'setHp', { current: 25, max: 29 }, context);
  assert.equal(aid.hpMax, 29);
  assert.equal(aid.vitals.hpCurrent, 25);
  assert.equal(aid.vitals.hpMaxBonus, 5);
  assert.throws(() => rules.applyVitalsAction(vitals, 'setHp', { current: 30, max: 29 }, context), /above the maximum \(29\)/);
  assert.throws(() => rules.applyVitalsAction(vitals, 'setHp', { current: -1 }, context), /at least 0/);

  const down = rules.normalizeVitals({ hpCurrent: 0, hpMaxBonus: 0, deathSaves: { successes: 1, failures: 2 } }, 24);
  const up = rules.applyVitalsAction(down, 'setHp', { current: 5 }, context);
  assert.deepEqual(up.events, ['revived']);
  assert.deepEqual(up.vitals.deathSaves, { successes: 0, failures: 0 });
});

function fighter(playerId) {
  return db.insertStartingCharacter(playerId, rules.buildStartingCharacter({
    name: 'Kael', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Defense',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  }));
}

test("the adventure's DM can damage and heal party members; the sheet shows it", async () => {
  const owner = createPlayer();
  const dm = createPlayer();
  const stranger = createPlayer();
  for (const id of [owner, dm, stranger]) db.prepare("UPDATE players SET password_hash = 'x' WHERE id = ?").run(id);
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('hp-dm', dm);
  const characterId = fighter(owner);
  const { adventure } = db.createAdventureFromThread({ threadId: 'hp-thread', title: 'Ambush', ownerDiscordId: 'hp-dm' });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const vitals = (userId, body) => fetch(`http://127.0.0.1:${server.address().port}/api/characters/${characterId}/vitals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': String(userId) }, body: JSON.stringify(body)
  }).then(async response => ({ status: response.status, body: await response.json() }));
  try {
    assert.equal((await vitals(dm, { action: 'damage', amount: 5 })).status, 403, 'not in the party yet');
    db.setPartyMember({ adventureId: adventure.id, user: { id: dm, role: 'player' }, characterId, inParty: true });

    const max = (await vitals(owner, { action: 'setHp', current: 1 })).body.vitals.hpMax;
    await vitals(owner, { action: 'setHp', current: max });
    const hit = await vitals(dm, { action: 'damage', amount: 5 });
    assert.equal(hit.status, 200);
    assert.equal(hit.body.vitals.hpCurrent, max - 5);
    assert.equal(JSON.parse(db.getCharacterById(characterId).sheet_data).hpCurrent, max - 5, 'saved on the sheet');
    assert.equal((await vitals(dm, { action: 'heal', amount: 2 })).body.vitals.hpCurrent, max - 3);
    assert.equal((await vitals(dm, { action: 'longRest' })).status, 403, 'rests stay with the player');
    assert.equal((await vitals(stranger, { action: 'damage', amount: 5 })).status, 403);
  } finally {
    server.close();
  }
});
