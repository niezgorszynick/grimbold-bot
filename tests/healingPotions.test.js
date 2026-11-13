const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

test('a variant table shows only the row of the variant owned', () => {
  const text = [
    'You regain Hit Points when you drink this potion.', '',
    '| Potion | HP Regained | Rarity |', '|---|---|---|',
    '| Potion of Healing | 2d4 + 2 | Common |',
    '| Potion of Healing (greater) | 4d4 + 4 | Uncommon |',
    '| Belt (frost) or Belt (stone) | 23 | Very Rare |'
  ].join('\n');
  const rows = variant => rules.variantDescription(text, variant).split('\n').filter(line => line.startsWith('|'));
  assert.deepEqual(rows('Potion of Healing (Greater)'), ['| Potion | HP Regained | Rarity |', '|---|---|---|', '| Potion of Healing (greater) | 4d4 + 4 | Uncommon |']);
  assert.equal(rows('Belt (Stone)').length, 3, 'a row naming two variants counts for both');
  assert.equal(rows('Something Else').length, 5, 'no matching row: the table stays whole');
  assert.equal(rules.variantDescription(text, null), text);
});

test('healing potions: an Action heals the maximum, a Bonus Action rolls, and a party member can get it', () => {
  const dm = createPlayer('admin');
  const ola = createPlayer();
  const tom = createPlayer();
  const add = (owner, name, sheet) => {
    const id = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
      VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, 900, 'alive', 0, ?)`).run(owner, name, JSON.stringify(sheet)).lastInsertRowid);
    db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level) VALUES (?, ?, ?, 3)').run(id, 'Fighter', 'Champion');
    return id;
  };
  const abilities = { str: { score: 10 }, dex: { score: 10 }, con: { score: 10 }, int: { score: 10 }, wis: { score: 10 }, cha: { score: 10 } };
  const mira = add(ola, 'Mira', { abilities, hpCurrent: 5, magicItems: [{ uid: 'p1', name: 'Potions of Healing', variant: 'Healing', quantity: 3 }] });
  const kael = add(tom, 'Kael', { abilities, hpCurrent: 1 });
  const asMira = { id: mira, player_id: ola, is_admin: false };
  const hp = id => JSON.parse(db.getCharacterById(id).sheet_data).hpCurrent;

  const view = db.getCharacterMagicItems(asMira);
  assert.equal(view.items[0].healing, '2d4 + 2');
  assert.deepEqual(view.potionTargets.map(target => target.name), ['Mira'], 'only yourself outside a running adventure');

  const action = db.changeCharacterMagicItems({ ...asMira, action: 'administer', params: { uid: 'p1', mode: 'action' } });
  assert.equal(action.healing.total, 10, 'the maximum of 2d4 + 2');
  assert.equal(hp(mira), 15);
  assert.equal(action.magicItems.items[0].quantity, 2);
  const logged = db.prepare('SELECT label, total FROM dice_rolls WHERE character_id = ? ORDER BY id DESC').get(mira);
  assert.deepEqual({ ...logged }, { label: 'Potion of Healing (Action)', total: 10 });

  assert.throws(() => db.changeCharacterMagicItems({ ...asMira, action: 'administer', params: { uid: 'p1', mode: 'bonus', targetId: kael } }), /running adventure/);
  assert.throws(() => db.changeCharacterMagicItems({ ...asMira, action: 'administer', params: { uid: 'p1', mode: 'reaction' } }), /Action or a Bonus Action/);

  const adventureId = db.startAdventure({ title: 'Wolves', dmPlayerId: dm });
  db.setPartyMember({ adventureId, user: { id: dm, role: 'admin' }, characterId: mira, inParty: true });
  db.setPartyMember({ adventureId, user: { id: dm, role: 'admin' }, characterId: kael, inParty: true });
  const bonus = db.changeCharacterMagicItems({ ...asMira, action: 'administer', params: { uid: 'p1', mode: 'bonus', targetId: kael } });
  assert.ok(bonus.healing.total >= 4 && bonus.healing.total <= 10);
  assert.equal(hp(kael), Math.min(1 + bonus.healing.total, rules.deriveVitalsContext({ species: 'Human', sheetData: { abilities }, classRows: [{ className: 'Fighter', level: 3 }] }).hpMax));
  assert.equal(hp(mira), 15, "the giver's HP stay");
  assert.equal(bonus.magicItems.items[0].quantity, 1);
  assert.match(bonus.message, /Kael regains/);
});
