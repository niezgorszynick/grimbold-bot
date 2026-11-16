const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers/tempDatabase');
const invites = require('../loginInvites');

test('the message has the login link, the username, the password and the features', () => {
  const text = invites.inviteMessage({ username: 'bard_of_doom', password: 'ember-otter-quill-42', base: 'https://panel.test' });
  assert.match(text, /https:\/\/panel\.test\/login/);
  assert.match(text, /`bard_of_doom`/);
  assert.match(text, /\|\|`ember-otter-quill-42`\|\|/);
  assert.match(text, /Character Sheet/);
  assert.ok(text.length < 2000, 'fits one Discord message');
  assert.match(invites.newPassword(), /^[a-z]+-[a-z]+-[a-z]+-\d\d$/);
});

test('players without a password get a DM, and the password works; closed DMs set nothing', async () => {
  db.addPlayer({ discord_id: 'invite-open', discord_tag: 'openDMs' });
  db.addPlayer({ discord_id: 'invite-closed', discord_tag: 'closedDMs' });
  const messages = {};
  invites.setLoginInvitesClient({
    isReady: () => true,
    users: {
      fetch: async id => ({
        send: async ({ content }) => {
          if (id === 'invite-closed') throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
          messages[id] = content;
        }
      })
    }
  });
  const { sent, failed } = await invites.sendLoginInvites();
  assert.deepEqual(sent, ['openDMs']);
  assert.deepEqual(failed, [{ tag: 'closedDMs', reason: 'their DMs are closed' }]);

  const password = messages['invite-open'].match(/\|\|`([^`]+)`\|\|/)[1];
  assert.ok(db.authenticatePlayer('openDMs', password), 'the sent password logs in');
  const closed = db.getAllPlayers().find(player => player.discord_tag === 'closedDMs');
  assert.equal(closed.has_password, 0, 'no password nobody knows');

  // Running it again only tries the one still without a password.
  const again = await invites.sendLoginInvites();
  assert.deepEqual(again.sent, []);
  assert.deepEqual(again.failed.map(entry => entry.tag), ['closedDMs']);
});

test('nothing is sent while Grimbold is offline', async () => {
  invites.setLoginInvitesClient({ isReady: () => false });
  await assert.rejects(invites.sendLoginInvites(), /not connected/);
});
