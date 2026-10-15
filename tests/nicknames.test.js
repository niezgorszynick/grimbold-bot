const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

function fighter(owner) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Brakka', 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, ?)
  `).run(owner, JSON.stringify({
    abilities: { str: { score: 16 }, dex: { score: 12 } },
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    inventory: [{ name: 'Greatsword', quantity: 1, source: 'class', equipped: true }]
  })).lastInsertRowid);
}

test('a nicknamed weapon still attacks and rolls as what it is', () => {
  const owner = createPlayer();
  const id = fighter(owner);
  const asOwner = { id, player_id: owner, is_admin: false };
  const result = db.changeCharacterInventory({ ...asOwner, action: 'rename', params: { index: 0, name: 'Greatsword', nickname: 'Ambassador' } });
  assert.equal(result.message, 'Greatsword is now called Ambassador.');
  assert.equal(result.inventory.items[0].nickname, 'Ambassador');

  const attack = db.getCharacterCombat(asOwner).attacks.find(entry => entry.name === 'Ambassador');
  assert.ok(attack, 'listed under its nickname');
  assert.equal(attack.weapon, 'Greatsword', 'and says what it really is');
  assert.equal(attack.damage, '2d6+3 Slashing');
  const options = [...db.rollOptions(db.getCharacterById(id)).values()].map(option => option.label);
  assert.ok(options.includes('Ambassador attack'));

  // Another Greatsword is a separate row, not part of Ambassador.
  db.changeCharacterInventory({ ...asOwner, action: 'add', params: { name: 'Greatsword' } });
  const rows = JSON.parse(db.getCharacterById(id).sheet_data).inventory;
  assert.deepEqual(rows.map(row => [row.name, row.nickname || null, row.quantity]), [['Greatsword', 'Ambassador', 1], ['Greatsword', null, 1]]);

  assert.throws(() => db.changeCharacterInventory({ ...asOwner, action: 'rename', params: { index: 0, name: 'Longsword', nickname: 'X' } }), /list changed/);
  db.changeCharacterInventory({ ...asOwner, action: 'rename', params: { index: 0, name: 'Greatsword', nickname: '' } });
  assert.equal(JSON.parse(db.getCharacterById(id).sheet_data).inventory[0].nickname, undefined, 'cleared');
});

test('a nicknamed magic weapon keeps its bonus', () => {
  const owner = createPlayer();
  const id = fighter(owner);
  const asOwner = { id, player_id: owner, is_admin: false };
  const granted = db.changeCharacterMagicItems({ ...asOwner, action: 'grant', params: { name: '+1 Longsword' } });
  const uid = granted.magicItems.items[0].uid;
  db.changeCharacterMagicItems({ ...asOwner, action: 'equip', params: { uid } });
  const before = db.getCharacterCombat(asOwner).attacks.find(entry => /Longsword/.test(entry.name));

  const renamed = db.changeCharacterMagicItems({ ...asOwner, action: 'rename', params: { uid, nickname: 'Dawnbringer' } });
  assert.equal(renamed.magicItems.items[0].name, 'Dawnbringer');
  assert.equal(renamed.magicItems.items[0].realName, '+1 Longsword');
  const after = db.getCharacterCombat(asOwner).attacks.find(entry => entry.name === 'Dawnbringer');
  assert.equal(after.attackBonus, before.attackBonus, 'same +1 to hit');
  assert.equal(after.damage, before.damage);
  assert.equal(after.notes[0], '+1 Longsword');
});
