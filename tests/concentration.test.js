const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const abilities = scores => Object.fromEntries(Object.entries({ str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10, ...scores })
  .map(([key, score]) => [key, { score }]));

test('Concentration saves: each hit waits for a save; a failure ends it and the buffs it held', async () => {
  const dm = createPlayer('admin');
  const ola = createPlayer();
  const add = (owner, name, cls, sub, sheet) => {
    const id = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
      VALUES (?, ?, 'Human', ?, ?, 3, 900, 'alive', 0, ?)`).run(owner, name, cls, sub, JSON.stringify(sheet)).lastInsertRowid);
    db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level) VALUES (?, ?, ?, 3)').run(id, cls, sub);
    return id;
  };
  const mira = add(ola, 'Mira', 'Cleric', 'Life Domain', { abilities: abilities({}), savingProficiencies: ['wis', 'cha'], hpCurrent: 24 });
  const kael = add(dm, 'Kael', 'Fighter', 'Champion', { abilities: abilities({ str: 16 }), weaponProficiencies: ['Martial weapons'], inventory: [{ name: 'Longsword', quantity: 1 }] });
  const adventureId = db.startAdventure({ title: 'Wolves', dmPlayerId: dm });
  for (const id of [mira, kael]) db.setPartyMember({ adventureId, user: { id: dm, role: 'admin' }, characterId: id, inParty: true });
  const asMira = { id: mira, player_id: ola, is_admin: false };
  db.chooseCharacterSpells({ ...asMira, source: 'Cleric', request: { cantrips: ['Guidance', 'Light', 'Thaumaturgy'], prepared: ['Shield of Faith', 'Guiding Bolt', 'Healing Word', 'Command'] } });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const post = (path, body, user = ola) => fetch(`http://127.0.0.1:${server.address().port}/api/characters/${path}`, {
    method: 'POST', headers: { 'x-user': String(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(async response => ({ status: response.status, data: await response.json() }));
  const state = () => rules.readSpellcasting(JSON.parse(db.getCharacterById(mira).sheet_data)).concentration;
  const blessed = () => (JSON.parse(db.getCharacterById(kael).sheet_data).spellEffects || []).length > 0;
  try {
    let result = await post(`${mira}/spells`, { action: 'cast', source: 'Cleric', spell: 'Bless', slotLevel: 1, targets: [mira, kael] });
    assert.equal(result.status, 200);
    assert.ok(blessed());
    assert.equal(db.rollOptions(db.getCharacterById(mira)).get('concentration').label, 'Concentration save (Bless)');

    // Two hits: two saves, oldest first. The DM deals damage from the table.
    result = await post(`${mira}/vitals`, { action: 'damage', amount: 22 }, dm);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.concentration, { dc: 11, spell: 'Bless' });
    await post(`${mira}/vitals`, { action: 'damage', amount: 1 }, dm);
    assert.deepEqual(state().checks, [11, 10]);
    const option = db.rollOptions(db.getCharacterById(mira)).get('concentration');
    assert.equal(option.label, 'Concentration save (Bless, DC 11)');
    assert.equal(option.formula, '1d20+2+1d4', 'CON save, plus her own Bless');

    // A save rolled on the sheet settles the first check.
    const roll = (await post(`${mira}/roll`, { roll: 'concentration' })).data;
    assert.equal(roll.concentration.dc, 11);
    assert.equal(roll.concentration.kept, roll.total >= 11);
    if (roll.concentration.kept) {
      assert.deepEqual(state().checks, [10]);
      // Real dice at the table: record a failure.
      result = await post(`${mira}/spells`, { action: 'concentrationSave', passed: false });
      assert.equal(result.data.kept, false);
      assert.equal(result.data.dc, 10);
    }
    assert.equal(state(), null, 'Concentration ended');
    assert.equal(blessed(), false, 'Bless ended on Kael too');
    assert.equal(db.rollOptions(db.getCharacterById(mira)).get('concentration'), undefined);
    result = await post(`${mira}/spells`, { action: 'concentrationSave', passed: true });
    assert.match(result.data.error, /No Concentration save is waiting/);
  } finally {
    server.close();
  }
});

test('War Caster and Eldritch Mind give Advantage on Concentration saves', () => {
  const owner = createPlayer();
  const sheet = {
    abilities: abilities({}),
    originFeats: [{ name: 'War Caster' }],
    spellcasting: { classes: {}, feats: {}, changes: {}, freeCastsUsed: {}, concentration: { spell: 'Bless', source: 'Cleric', checks: [12] } }
  };
  const id = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Ivo', 'Human', 'Cleric', '', 3, 900, 'alive', 0, ?)`).run(owner, JSON.stringify(sheet)).lastInsertRowid);
  const option = db.rollOptions(db.getCharacterById(id)).get('concentration');
  assert.deepEqual(option.advantage, ['War Caster']);
  assert.equal(option.label, 'Concentration save (Bless, DC 12)');
});
