const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const shop = require('../shop');
const rules = require('../rules');
const threads = require('../characterThreads');

function addCharacter(playerId, name, { goldCp = 0, status = 'alive', sheet = {} } = {}) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, 0, ?, ?, ?)
  `).run(playerId, name, status, goldCp, JSON.stringify(sheet)).lastInsertRowid);
}
const sheetOf = id => JSON.parse(db.getCharacterById(id).sheet_data);

test('giving equipment: it moves to the other sheet (put away), stacks, and Grimbold logs it', () => {
  const ola = createPlayer();
  const tom = createPlayer();
  const kael = addCharacter(ola, 'Kael', { sheet: { inventory: [
    { name: 'Rope (50 feet)', quantity: 3, source: 'shop' },
    { name: 'Longsword', quantity: 1, source: 'shop', equipped: true, nickname: 'Ambassador' }
  ] } });
  const brin = addCharacter(tom, 'Brin', { sheet: { inventory: [{ name: 'Rope (50 feet)', quantity: 1, source: 'shop' }] } });
  const ghost = addCharacter(tom, 'Ghost', { status: 'dead' });
  const asOla = { id: ola, role: 'player' };

  assert.throws(() => db.giveItem({ characterId: kael, user: { id: tom, role: 'player' }, request: { toCharacterId: brin, kind: 'item', index: 0, name: 'Rope (50 feet)' } }), /Forbidden/);
  assert.throws(() => db.giveItem({ characterId: kael, user: asOla, request: { toCharacterId: kael, kind: 'item', index: 0, name: 'Rope (50 feet)' } }), /themselves/);
  assert.throws(() => db.giveItem({ characterId: kael, user: asOla, request: { toCharacterId: ghost, kind: 'item', index: 0, name: 'Rope (50 feet)' } }), /no longer among the living/);
  assert.throws(() => db.giveItem({ characterId: kael, user: asOla, request: { toCharacterId: brin, kind: 'item', index: 0, name: 'Rope (50 feet)', quantity: 4 } }), /from 1 to 3/);
  assert.throws(() => db.giveItem({ characterId: kael, user: asOla, request: { toCharacterId: brin, kind: 'item', index: 1, name: 'Rope (50 feet)' } }), /list changed/);

  const result = db.giveItem({ characterId: kael, user: asOla, request: { toCharacterId: brin, kind: 'item', index: 0, name: 'Rope (50 feet)', quantity: 2, note: '  For the cliffs.  ' } });
  assert.equal(result.message, '2 × Rope (50 feet) given to Brin.');
  assert.deepEqual(sheetOf(kael).inventory[0], { name: 'Rope (50 feet)', quantity: 1, source: 'shop' });
  assert.deepEqual(sheetOf(brin).inventory, [{ name: 'Rope (50 feet)', quantity: 3, source: 'shop' }], 'stacks with what they had');
  assert.deepEqual([result.gift.from.name, result.gift.to.name, result.gift.item, result.gift.quantity, result.gift.kind, result.gift.note],
    ['Kael', 'Brin', 'Rope (50 feet)', 2, 'item', 'For the cliffs.']);

  // A named, wielded weapon: its own row on the other side, put away.
  db.giveItem({ characterId: kael, user: asOla, request: { toCharacterId: brin, kind: 'item', index: 1, name: 'Longsword' } });
  const sword = sheetOf(brin).inventory.find(row => row.name === 'Longsword');
  assert.deepEqual([sword.nickname, sword.equipped, sword.quantity], ['Ambassador', false, 1]);
  assert.ok(!sheetOf(kael).inventory.some(row => row.name === 'Longsword'));

  const log = db.listGifts();
  assert.deepEqual(log.slice(0, 2).map(gift => gift.item), ['Ambassador (Longsword)', 'Rope (50 feet)']);
  assert.ok(db.listGiftRecipients().every(entry => entry.name !== 'Ghost'), 'only the living receive gifts');

  const notes = threads.giftMessages(result.gift);
  assert.match(notes.giver.text, /gift from Kael:\* \*\*Rope \(50 feet\)\*\* ×2 for \*\*Brin\*\*\. With a note: “For the cliffs\.”/);
  assert.match(notes.recipient.text, /hands Brin a parcel from Kael/);
});

test('giving a magic item: attunement ends, charges go with it', () => {
  const ola = createPlayer();
  const tom = createPlayer();
  let sheet = { magicItems: rules.grantMagicItem({}, { name: 'Cloak of Protection' }) };
  sheet.magicItems = rules.grantMagicItem(sheet, { name: 'Wand of Magic Missiles' });
  const cloakUid = sheet.magicItems[0].uid;
  sheet.magicItems[0] = { ...sheet.magicItems[0], attuned: true, equipped: true };
  sheet.magicItems[1] = { ...sheet.magicItems[1], charges: 3 };
  const kael = addCharacter(ola, 'Kael', { sheet });
  const brin = addCharacter(tom, 'Brin');
  const asOla = { id: ola, role: 'player' };

  assert.throws(() => db.giveItem({ characterId: kael, user: asOla, request: { toCharacterId: brin, kind: 'magic', uid: 'nope' } }), /does not have that magic item/);
  db.giveItem({ characterId: kael, user: asOla, request: { toCharacterId: brin, kind: 'magic', uid: cloakUid } });
  assert.deepEqual(sheetOf(kael).magicItems.map(entry => entry.name), ['Wand of Magic Missiles']);
  const cloak = sheetOf(brin).magicItems[0];
  assert.deepEqual([cloak.name, cloak.attuned, cloak.equipped, cloak.source], ['Cloak of Protection', false, false, 'gift']);
  assert.notEqual(cloak.uid, cloakUid, 'a fresh id on the new sheet');

  const wandUid = sheetOf(kael).magicItems[0].uid;
  const result = db.giveItem({ characterId: kael, user: { id: 0, role: 'admin' }, request: { toCharacterId: brin, kind: 'magic', uid: wandUid } });
  assert.equal(sheetOf(brin).magicItems.find(entry => entry.name === 'Wand of Magic Missiles').charges, 3);
  assert.equal(result.gift.kind, 'magic');
  assert.equal(result.gift.givenBy, null, 'the Root DM has no player row');
});

test('buying a gift at the counter: the buyer pays, the other sheet gets it', () => {
  const ola = createPlayer();
  const tom = createPlayer();
  const kael = addCharacter(ola, 'Kael', { goldCp: 1000 });
  const brin = addCharacter(tom, 'Brin');
  db.addItem({ name: 'Gift Candle', category: 'Gear', price: 300, stock: 5, description: 'Smells of pine.' });

  assert.throws(() => shop.purchaseItem({ itemName: 'Gift Candle', characterId: kael, playerId: ola, giftToCharacterId: kael }), /themselves/);
  const result = shop.purchaseItem({ itemName: 'Gift Candle', quantity: 2, characterId: kael, playerId: ola, buyerTag: 'ola', giftToCharacterId: brin, giftNote: 'Happy name day!' });
  assert.equal(result.character.gold_cp, 400);
  assert.equal(db.getCharacterById(kael).gold_cp, 400, 'the buyer pays');
  assert.equal(sheetOf(kael).inventory, undefined, 'and gets nothing');
  assert.deepEqual(sheetOf(brin).inventory, [{ name: 'Gift Candle', quantity: 2, source: 'gift' }]);
  assert.deepEqual([result.gift.kind, result.gift.costCp, result.gift.note, result.gift.to.name], ['shop', 600, 'Happy name day!', 'Brin']);
  assert.equal(db.prepare('SELECT gift_to_character_id FROM sales WHERE item_name = ?').get('Gift Candle').gift_to_character_id, brin);
  assert.match(threads.purchaseMessage(result, 'ola').text, /Gift Candle\*\* ×2 as a gift for \*\*Brin\*\*/);
  assert.match(threads.giftMessages(result.gift).recipient.text, /bought at the counter for 6 gp/);
});
