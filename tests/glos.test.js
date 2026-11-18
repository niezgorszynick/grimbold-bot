const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { db, createPlayer } = require('./helpers/tempDatabase');
const { isGlosOwner, glosOwnerDiscordId } = require('../auth');
const glos = require('../glos');
const renderAdminPage = require('../views/adminPage');

// The owner: an admin whose Discord account is the Głos owner's.
db.addPlayer({ discord_id: glosOwnerDiscordId(), discord_tag: 'voice_dm' });
const ownerId = db.prepare('SELECT id FROM players WHERE discord_id = ?').get(glosOwnerDiscordId()).id;
db.setPlayerCredentials(ownerId, 'test1234', 'admin');
const otherAdmin = createPlayer('admin');
const listener = createPlayer('player');
const closed = createPlayer('player');
const listenerDiscord = db.prepare('SELECT discord_id FROM players WHERE id = ?').get(listener).discord_id;
const closedDiscord = db.prepare('SELECT discord_id FROM players WHERE id = ?').get(closed).discord_id;

const users = {
  owner: { id: ownerId, discord_tag: 'voice_dm', role: 'admin' },
  otherAdmin: { id: otherAdmin, discord_tag: 'other', role: 'admin' },
  root: { id: 0, discord_tag: 'Root DM', role: 'admin' },
  player: { id: listener, discord_tag: 'p', role: 'player' }
};

test('only the owner is the Głos owner; other admins, Root DM and players are not', () => {
  assert.equal(isGlosOwner(users.owner), true);
  assert.equal(isGlosOwner(users.otherAdmin), false);
  assert.equal(isGlosOwner(users.root), false);
  assert.equal(isGlosOwner(users.player), false);
});

test('the tab and its menu entry exist only for the owner', () => {
  const html = renderAdminPage({ session: { user: users.owner }, query: { tab: 'glos' } });
  assert.match(html, /id="glos-app"/);
  assert.match(html, /tab=glos/);
  const json = html.match(/<script type="application\/json" id="glos-data">([\s\S]*?)<\/script>/)[1];
  assert.ok(Array.isArray(JSON.parse(json).recipients), 'the data parses');
  assert.doesNotThrow(() => new vm.Script(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'glos.js'), 'utf8')));
  for (const user of [users.otherAdmin, users.root, users.player]) {
    const page = renderAdminPage({ session: { user }, query: { tab: 'glos' } });
    assert.doesNotMatch(page, /glos|Głos/i, `${user.discord_tag} sees nothing of Głos`);
  }
});

test('Głos writes to each chosen player as an embed; closed DMs are kept as not delivered', async () => {
  const sent = {};
  glos.setGlosClient({
    isReady: () => true,
    users: {
      fetch: async id => ({
        send: async payload => {
          if (id === closedDiscord) throw Object.assign(new Error('Cannot send'), { code: 50007 });
          sent[id] = payload;
          return { id: 'msg-1' };
        }
      })
    }
  });
  const results = await glos.sendGlos({ playerIds: [listener, closed], text: 'They know what you did.', imageUrl: '' });
  assert.deepEqual(results.map(entry => entry.ok), [true, false]);
  assert.equal(results[1].error, 'their DMs are closed to Grimbold');
  const embed = sent[listenerDiscord].embeds[0];
  assert.equal(embed.author.name, 'Głos');
  assert.equal(embed.description, 'They know what you did.');
  assert.equal(sent[listenerDiscord].content, undefined, 'nothing outside the embed');

  const stored = db.getGlosMessages();
  assert.equal(stored.length, 2);
  assert.equal(stored.find(message => message.discord_id === closedDiscord).status, 'failed');
});

test('sending refuses an empty message, no recipients, a non-https image and an offline bot', async () => {
  await assert.rejects(glos.sendGlos({ playerIds: [listener], text: '  ' }), /Write something/);
  await assert.rejects(glos.sendGlos({ playerIds: [], text: 'hi' }), /Choose who/);
  await assert.rejects(glos.sendGlos({ playerIds: [listener], text: 'hi', imageUrl: 'javascript:alert(1)' }), /https/);
  glos.setGlosClient({ isReady: () => false });
  await assert.rejects(glos.sendGlos({ playerIds: [listener], text: 'hi' }), /not connected/);
});

test('replies are kept from people Głos reached, not from anyone else or from servers', () => {
  const dm = (authorId, content, extra = {}) => ({ id: `in-${Math.random()}`, guild: null, guildId: null, author: { id: authorId, bot: false }, content, ...extra });
  assert.equal(glos.handleDirectMessage(dm(listenerDiscord, 'Who is this?')), true);
  assert.equal(glos.handleDirectMessage(dm(closedDiscord, 'hello?')), false, 'never reached');
  assert.equal(glos.handleDirectMessage(dm('stranger', 'hi')), false);
  assert.equal(glos.handleDirectMessage(dm(listenerDiscord, 'in a server', { guildId: 'g1' })), false);
  assert.equal(glos.handleDirectMessage(dm(listenerDiscord, 'bot', { author: { id: listenerDiscord, bot: true } })), false);
  const replies = db.getGlosMessages().filter(message => message.direction === 'in');
  assert.deepEqual(replies.map(message => [message.player_id, message.text]), [[listener, 'Who is this?']]);
  assert.equal(db.getGlosMessages({ afterId: replies[0].id }).length, 0);
});
