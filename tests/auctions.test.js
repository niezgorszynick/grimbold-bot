const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

const DAY = 24 * 60 * 60 * 1000;
const start = Date.parse('2026-10-01T12:00:00Z');

function addCharacter(owner, name, goldGp, magicItems = []) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', 'Fighter', 'Champion', 5, 0, 'alive', ?, ?)
  `).run(owner, name, goldGp * 100, JSON.stringify({ magicItems })).lastInsertRowid);
}
const gold = id => db.prepare('SELECT gold_cp FROM characters WHERE id = ?').get(id).gold_cp / 100;
const items = id => JSON.parse(db.getCharacterById(id).sheet_data).magicItems || [];
const user = id => ({ id, role: 'player' });
const noNpc = () => 0.99; // never interested

test('listing takes the item off the sheet; bids are held and handed back when outbid', () => {
  const seller = createPlayer();
  const alice = createPlayer();
  const bob = createPlayer();
  const sellerChar = addCharacter(seller, 'Seller', 0, [{ uid: 'bag1', name: 'Bag of Holding', quantity: 1 }]);
  const aliceChar = addCharacter(alice, 'Alice', 500);
  const bobChar = addCharacter(bob, 'Bob', 500);

  assert.throws(() => db.createAuction({ user: user(alice), characterId: sellerChar, uid: 'bag1' }), /your own characters/);
  const auction = db.createAuction({ user: user(seller), characterId: sellerChar, uid: 'bag1', now: start, random: noNpc });
  assert.deepEqual([auction.item, auction.rarity, auction.valueCp, auction.openingBidCp], ['Bag of Holding', 'Uncommon', 40000, 20000]);
  assert.deepEqual(items(sellerChar), [], 'the item leaves the sheet');

  assert.throws(() => db.placeBid({ user: user(seller), auctionId: auction.id, characterId: sellerChar, amountCp: 20000, now: start }), /own item/);
  assert.throws(() => db.placeBid({ user: user(alice), auctionId: auction.id, characterId: aliceChar, amountCp: 10000, now: start }), /at least 200 gp/);
  db.placeBid({ user: user(alice), auctionId: auction.id, characterId: aliceChar, amountCp: 20000, now: start });
  assert.equal(gold(aliceChar), 300, 'the bid is held from the purse');
  assert.throws(() => db.placeBid({ user: user(bob), auctionId: auction.id, characterId: bobChar, amountCp: 20500, now: start }), /at least 210 gp/, '5% (at least 1 gp) more');
  db.placeBid({ user: user(bob), auctionId: auction.id, characterId: bobChar, amountCp: 25000, now: start + DAY });
  assert.equal(gold(aliceChar), 500, "Alice's bid comes back");
  assert.equal(gold(bobChar), 250);

  // Seven days later Bob wins; the seller gets 90%.
  const news = db.settleAuctions({ now: start + 7 * DAY, random: noNpc });
  assert.deepEqual(news.map(item => item.kind), ['closed']);
  assert.deepEqual(items(bobChar).map(item => [item.name, item.source]), [['Bag of Holding', 'auction']]);
  assert.equal(gold(sellerChar), 225);
  assert.equal(db.getAuction(auction.id).status, 'sold');
  assert.throws(() => db.placeBid({ user: user(alice), auctionId: auction.id, characterId: aliceChar, amountCp: 30000, now: start + 8 * DAY }), /ended/);
});

test('NPCs raise the bid up to their limit; with no bids at all Grimbold buys it', () => {
  const seller = createPlayer();
  const sellerChar = addCharacter(seller, 'Seller Two', 0, [{ uid: 'c1', name: 'Cloak of Protection', quantity: 1 }, { uid: 'h1', name: 'Hat of Wizardry', quantity: 2 }]);

  // Interested NPCs (random 0 → interest, a 0.85 × value limit, a bid every day).
  const auction = db.createAuction({ user: user(seller), characterId: sellerChar, uid: 'c1', now: start, random: () => 0 });
  const news = db.settleAuctions({ now: start + 3 * DAY + 1, random: () => 0 });
  assert.equal(news.filter(item => item.kind === 'npcBid').length, 1, 'an NPC does not outbid itself');
  const view = db.getAuction(auction.id);
  assert.equal(view.currentBidCp, 21000, '5% over the opening bid');
  assert.equal(view.highestBidder, 'a hooded collector');
  db.settleAuctions({ now: start + 7 * DAY, random: () => 0 });
  assert.equal(gold(sellerChar), 189, 'sold to the NPC: 210 gp less 10%');

  // One hat of a pair; nobody bids: Grimbold buys it for the opening bid and shelves it.
  const hat = db.createAuction({ user: user(seller), characterId: sellerChar, uid: 'h1', now: start, random: noNpc });
  assert.equal(items(sellerChar).find(item => item.uid === 'h1').quantity, 1, 'one of the stack');
  db.settleAuctions({ now: start + 7 * DAY, random: noNpc });
  assert.equal(db.getAuction(hat.id).status, 'unsold');
  assert.equal(gold(sellerChar), 189 + 50);
  assert.deepEqual(db.prepare("SELECT name, price, stock, source FROM items WHERE name = 'Hat of Wizardry'").get(), { name: 'Hat of Wizardry', price: 10000, stock: 1, source: 'resale' });
});

test('a seller can withdraw an item nobody has bid on', () => {
  const seller = createPlayer();
  const other = createPlayer();
  const sellerChar = addCharacter(seller, 'Seller Three', 0, [{ uid: 'r1', name: 'Ring of Protection', quantity: 1 }]);
  const otherChar = addCharacter(other, 'Other', 5000);
  const auction = db.createAuction({ user: user(seller), characterId: sellerChar, uid: 'r1', now: start, random: noNpc });
  db.cancelAuction({ user: user(seller), auctionId: auction.id });
  assert.deepEqual(items(sellerChar).map(item => item.name), ['Ring of Protection']);

  const again = db.createAuction({ user: user(seller), characterId: sellerChar, uid: items(sellerChar)[0].uid, now: start, random: noNpc });
  db.placeBid({ user: user(other), auctionId: again.id, characterId: otherChar, amountCp: again.openingBidCp, now: start });
  assert.throws(() => db.cancelAuction({ user: user(seller), auctionId: again.id }), /already bid/);
  db.cancelAuction({ user: { id: 0, role: 'admin' }, auctionId: again.id });
  assert.equal(gold(otherChar), 5000, 'a DM withdrawal returns the held bid');
});

test('DM test tools: an adventurer bids now, and an auction ends now', () => {
  const seller = createPlayer();
  const bidder = createPlayer();
  const sellerChar = addCharacter(seller, 'Seller Four', 0, [{ uid: 'w1', name: 'Wand of Magic Missiles', quantity: 1 }]);
  const bidderChar = addCharacter(bidder, 'Bidder Four', 1000);
  const auction = db.createAuction({ user: user(seller), characterId: sellerChar, uid: 'w1', random: noNpc });
  db.placeBid({ user: user(bidder), auctionId: auction.id, characterId: bidderChar, amountCp: 20000 });
  assert.equal(gold(bidderChar), 800);

  const news = db.forceNpcBid({ auctionId: auction.id, random: () => 0 });
  assert.deepEqual(news.map(item => [item.kind, item.npc, item.amountCp]), [['npcBid', 'a hooded collector', 21000]], 'even with no NPC interest');
  assert.equal(gold(bidderChar), 1000, "the player's bid comes back");

  const closed = db.endAuctionNow({ auctionId: auction.id });
  assert.deepEqual(closed.map(item => [item.kind, item.winner, item.sellerGetsCp]), [['closed', 'a hooded collector', 18900]]);
  assert.equal(db.getAuction(auction.id).status, 'sold');
  assert.throws(() => db.forceNpcBid({ auctionId: auction.id }), /not running/);
});
