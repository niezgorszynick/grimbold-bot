const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { db, createPlayer } = require('./helpers/tempDatabase');
const { changePasswordRouter } = require('../changePassword');

// The router behind a fake session: signedIn = a player id, or none.
async function withServer(sessionUser, run) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => { req.session = sessionUser ? { user: sessionUser } : null; next(); });
  app.use(changePasswordRouter({ startPage: '/admin?tab=changelog' }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await run({
      page: () => fetch(base + '/change-password').then(response => response.text()),
      post: fields => fetch(base + '/change-password', { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' })
        .then(response => response.headers.get('location'))
    });
  } finally {
    server.close();
  }
}
const tagOf = id => db.prepare('SELECT discord_tag FROM players WHERE id = ?').get(id).discord_tag;

test('from the login page: username and current password, then log in with the new one', async () => {
  const id = createPlayer();
  const tag = tagOf(id);
  await withServer(null, async ({ page, post }) => {
    assert.match(await page(), /name="username"/);
    assert.equal(await post({ username: tag, current: 'wrong', password: 'newsecret1', confirm: 'newsecret1' }), '/change-password?error=wrong');
    assert.equal(await post({ username: tag, current: 'test1234', password: 'short', confirm: 'short' }), '/change-password?error=short');
    assert.equal(await post({ username: tag, current: 'test1234', password: 'newsecret1', confirm: 'newsecret2' }), '/change-password?error=mismatch');
    assert.equal(await post({ username: 'admin', current: 'x', password: 'newsecret1', confirm: 'newsecret1' }), '/change-password?error=root');
    assert.ok(db.authenticatePlayer(tag, 'test1234'), 'nothing changed yet');
    assert.equal(await post({ username: tag, current: 'test1234', password: 'newsecret1', confirm: 'newsecret1' }), '/login?changed=1');
  });
  assert.equal(db.authenticatePlayer(tag, 'test1234'), null);
  assert.ok(db.authenticatePlayer(tag, 'newsecret1'));
});

test('signed in: only their own account, still with the current password; the role stays', async () => {
  const id = createPlayer('admin');
  const other = createPlayer();
  await withServer({ id, role: 'admin' }, async ({ page, post }) => {
    const html = await page();
    assert.doesNotMatch(html, /name="username"/);
    assert.match(html, new RegExp(tagOf(id)));
    // A username in the form is ignored: it changes the signed-in account.
    assert.equal(await post({ username: tagOf(other), current: 'test1234', password: 'mysecret99', confirm: 'mysecret99' }), '/admin?tab=changelog&status=password_changed');
  });
  const account = db.authenticatePlayer(tagOf(id), 'mysecret99');
  assert.equal(account.role, 'admin');
  assert.ok(db.authenticatePlayer(tagOf(other), 'test1234'), 'the other account is untouched');
});
