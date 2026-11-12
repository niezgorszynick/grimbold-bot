const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

test('heights are read however they are typed', () => {
  const cases = {
    '176': 176, '176 cm': 176, '176cm': 176, '1.76 m': 176, '1,76m': 176,
    '5\'9"': 175, '5′9″': 175, '5 ft 9 in': 175, '6\'': 183, '69 in': 175, '5.5': 168,
    '175 cm, 5′9″': 175, 'about 180, lean': 180, '2 m': 200, '90cm': 90,
    tall: null, '': null, '9000 cm': null
  };
  for (const [text, cm] of Object.entries(cases)) assert.equal(rules.parseHeightCm(text), cm, text);
  assert.equal(rules.feetAndInches(193), '6′4″');
});

test('the lineup: living characters with height, build, species and main class; parties to pick', () => {
  const ola = createPlayer();
  const dm = createPlayer('admin');
  const add = (name, race, cls, appearance, status = 'alive') => {
    const id = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
      VALUES (?, ?, ?, ?, '', 3, 0, ?, 0, ?)`).run(ola, name, race, cls, status, JSON.stringify({ appearance })).lastInsertRowid);
    db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level) VALUES (?, ?, ?, 3)').run(id, cls, '');
    return id;
  };
  const ilphas = add('Ilphas', 'Elf', 'Wizard', { height: '1.80 m', build: 'feminine' });
  add('Torak', 'Goliath', 'Barbarian', { height: '6\'4"', build: 'giant' });
  add('Gone', 'Human', 'Fighter', { height: '170' }, 'dead');
  const adventureId = db.startAdventure({ title: 'Wolves', dmPlayerId: dm });
  db.setPartyMember({ adventureId, user: { id: dm, role: 'admin' }, characterId: ilphas, inParty: true });

  const lineup = db.getLineup({ id: ola });
  assert.deepEqual(lineup.characters.map(c => [c.name, c.heightCm, c.build, c.className, c.mine]),
    [['Ilphas', 180, 'feminine', 'Wizard', true], ['Torak', 193, null, 'Barbarian', true]], 'the dead are left out; an unknown build is none');
  assert.deepEqual(lineup.parties.find(party => party.id === adventureId).characterIds, [ilphas]);
  assert.equal(db.getLineup({ id: dm }).characters[0].mine, false);
});
