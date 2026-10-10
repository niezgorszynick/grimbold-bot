const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const { loadSessionUser, isAdmin, isRootAdmin, ROOT_ADMIN } = require('../auth');

const session = user => ({ session: { user } });

test('no session or a malformed one is rejected', () => {
  assert.equal(loadSessionUser({}), null);
  assert.equal(loadSessionUser(session(undefined)), null);
  assert.equal(loadSessionUser(session({ id: 'abc', role: 'player' })), null);
  assert.equal(loadSessionUser(session({ id: -1, role: 'player' })), null);
});

test('the emergency admin needs no players row', () => {
  const user = loadSessionUser(session({ id: 0, role: 'admin' }));
  assert.deepEqual(user, ROOT_ADMIN);
  assert.ok(isRootAdmin(user));
  // A forged id 0 without the admin role is not the emergency admin.
  assert.equal(loadSessionUser(session({ id: 0, role: 'player' })), null);
});

test('players are re-read from the database on every request', () => {
  const id = createPlayer();
  // A stale session claiming admin does not grant admin.
  const user = loadSessionUser(session({ id, role: 'admin' }));
  assert.equal(user.role, 'player');
  assert.equal(isAdmin(user), false);

  db.setPlayerCredentials(id, 'test1234', 'admin');
  assert.equal(isAdmin(loadSessionUser(session({ id, role: 'player' }))), true);
});

test('removed accounts or passwords end the session', () => {
  const revoked = createPlayer();
  db.prepare('UPDATE players SET password_hash = NULL WHERE id = ?').run(revoked);
  assert.equal(loadSessionUser(session({ id: revoked, role: 'player' })), null);

  const deleted = createPlayer();
  db.deletePlayer(deleted);
  assert.equal(loadSessionUser(session({ id: deleted, role: 'player' })), null);
});
