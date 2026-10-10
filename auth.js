// auth.js — Session authentication shared by the admin panel and the API.

const db = require('./db');

// The emergency admin logs in with ADMIN_PASSWORD and has no players row.
const ROOT_ADMIN = { id: 0, discord_tag: 'Root DM', role: 'admin' };

// Returns the logged-in user, re-read from the database on every request, or
// null when there is no session or the account was removed or lost its password.
function loadSessionUser(req) {
  const sessionUser = req.session && req.session.user;
  if (!sessionUser) return null;
  if (sessionUser.id === 0 && sessionUser.role === 'admin') return ROOT_ADMIN;
  if (!Number.isSafeInteger(sessionUser.id) || sessionUser.id <= 0) return null;

  const player = db.prepare(`
    SELECT id, discord_id, discord_tag, role, password_hash
    FROM players
    WHERE id = ?
  `).get(sessionUser.id);
  if (!player || !player.password_hash) return null;
  return {
    id: player.id,
    discord_id: player.discord_id,
    discord_tag: player.discord_tag,
    role: player.role || 'player'
  };
}

function isAdmin(user) {
  return Boolean(user && user.role === 'admin');
}

function isRootAdmin(user) {
  return Boolean(user && user.id === ROOT_ADMIN.id && user.role === 'admin');
}

module.exports = { ROOT_ADMIN, loadSessionUser, isAdmin, isRootAdmin };
