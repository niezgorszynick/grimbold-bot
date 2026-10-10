const test = require('node:test');
const assert = require('node:assert/strict');
const nat = require('../naturalRolls');

const roll = extra => ({ character: 'Kael', player: 'kael#1', label: 'Athletics (STR)', text: '2d20 [~~4~~, 20] + 5', total: 25, natural: 20, private: false, ...extra });

test('natural 1s and 20s from every source go to the nat-rolls channel', async () => {
  const sent = [];
  const channel = { send: async message => { sent.push(message.content); } };
  nat.setNaturalRollsClient({ channels: { fetch: async id => (id === 'nat-channel' ? channel : null) } });

  delete process.env.NAT_ROLLS_CHANNEL_ID;
  assert.match((await nat.announcePanelRoll(roll())).reason, /not set/);
  process.env.NAT_ROLLS_CHANNEL_ID = 'nat-channel';

  assert.equal((await nat.announcePanelRoll(roll())).ok, true);
  assert.equal((await nat.announcePanelRoll(roll({ natural: 1, total: 6, player: null }))).ok, true);
  assert.equal((await nat.announcePanelRoll(roll({ natural: 12 }))).ok, false);
  assert.equal((await nat.announcePanelRoll(roll({ natural: null }))).ok, false, 'damage rolls have no d20');
  assert.equal((await nat.announcePanelRoll(roll({ private: true }))).ok, false, 'GM-only rolls stay secret');
  assert.equal((await nat.announceWeeklyRoll(20, 'mira#2')).ok, true);
  assert.equal((await nat.announceWeeklyRoll(7, 'mira#2')).ok, false);

  assert.equal(sent.length, 3);
  assert.equal(sent[0], '✨ **NATURAL 20!** **Kael** (kael#1) — Athletics (STR): 2d20 [~~4~~, 20] + 5 = **25**');
  assert.match(sent[1], /^💀 \*\*Natural 1\.\.\.\*\* \*\*Kael\*\* \(rolled by the DM\)/);
  assert.match(sent[2], /\*\*mira#2\*\* on the weekly shop roll/);

  // Discord refusing never throws.
  channel.send = async () => { throw new Error('Missing Access'); };
  assert.deepEqual(await nat.announceWeeklyRoll(1, 'mira#2'), { ok: false, reason: 'Missing Access' });
  nat.setNaturalRollsClient(null);
  delete process.env.NAT_ROLLS_CHANNEL_ID;
});
