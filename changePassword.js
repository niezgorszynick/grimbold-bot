// changePassword.js — The login page's frame, and the Change password page:
// reached from the login page (username and current password) or signed in
// (the username is theirs). The current password is always asked. The
// emergency admin has no players row and keeps ADMIN_PASSWORD.

'use strict';

const express = require('express');
const db = require('./db');
const { LOGIN_BACKDROP, LOGIN_BACKDROP_STYLE } = require('./views/loginBackdrop');

const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// The dark card with Grimbold's title (login and change password).
function authPage(title, body) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Grimbold's Vault — ${title}</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body { background-color: #0b1024; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
        .login-card { background-color: rgba(20, 26, 48, 0.82); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(201, 163, 74, 0.45); border-radius: 12px; width: 100%; max-width: 400px; padding: 2rem; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
        ${LOGIN_BACKDROP_STYLE}
      </style>
    </head>
    <body>
      ${LOGIN_BACKDROP}
      <main class="login-card">
        <div class="text-center mb-4">
          <h3 class="fw-bold text-warning mb-1">Grimbold's Vault</h3>
          <p class="small" style="color: #a9a3c9">Campaign Hub &amp; Provisions</p>
        </div>
        ${body}
      </main>
    </body>
    </html>
  `;
}

const ERRORS = {
  wrong: 'The username or current password is wrong.',
  short: 'The new password needs at least 8 characters.',
  long: 'The new password can be at most 256 characters.',
  mismatch: 'The two new passwords are not the same.',
  same: 'The new password is the same as the current one.',
  root: 'The emergency admin password is set on the server (ADMIN_PASSWORD).'
};
const field = (id, label, type, autocomplete, extra = '') => `
          <div class="mb-3">
            <label for="${id}" class="form-label text-light small fw-bold">${label}</label>
            <input id="${id}" type="${type}" name="${id}" class="form-control bg-dark text-light border-secondary" autocomplete="${autocomplete}" required ${extra}>
          </div>`;

// A signed-in player (not the emergency admin), and their tag read fresh.
function signedInPlayer(req) {
  const user = req.session && req.session.user;
  if (!user || !(Number(user.id) > 0)) return null;
  const row = db.prepare('SELECT id, discord_tag FROM players WHERE id = ?').get(user.id);
  return row || null;
}

function changePasswordRouter({ startPage }) {
  const router = express.Router();

  router.get('/change-password', (req, res) => {
    const player = signedInPlayer(req);
    const error = ERRORS[req.query.error];
    res.send(authPage('Change password', `
        <h5 class="text-light mb-3">Change password</h5>
        ${error ? `<div class="alert alert-danger py-2 small mb-3">${error}</div>` : ''}
        <form method="POST" action="/change-password">
          ${player
            ? `<p class="small text-light mb-3">Signed in as <strong>${escapeAttr(player.discord_tag)}</strong></p>`
            : field('username', 'Discord Tag', 'text', 'username', 'autofocus')}
          ${field('current', 'Current password', 'password', 'current-password', player ? 'autofocus' : '')}
          ${field('password', 'New password', 'password', 'new-password', 'minlength="8" maxlength="256"')}
          ${field('confirm', 'New password again', 'password', 'new-password', 'minlength="8" maxlength="256"')}
          <button type="submit" class="btn btn-warning w-100 fw-bold">Change password</button>
        </form>
        <p class="text-center small mt-3 mb-0"><a href="${player ? startPage : '/login'}" class="link-secondary">${player ? 'Back to the panel' : 'Back to login'}</a></p>
    `));
  });

  router.post('/change-password', (req, res) => {
    const player = signedInPlayer(req);
    const { username, current, password, confirm } = req.body || {};
    const fail = code => res.redirect('/change-password?error=' + code);
    if (!player && typeof username === 'string' && username.trim().toLowerCase() === 'admin') return fail('root');
    if (typeof password !== 'string' || password.trim().length < 8) return fail('short');
    if (password.length > 256) return fail('long');
    if (password !== confirm) return fail('mismatch');
    const tag = player ? player.discord_tag : username;
    const account = typeof tag === 'string' && typeof current === 'string' ? db.authenticatePlayer(tag, current) : null;
    if (!account) return fail('wrong');
    if (password.trim() === current.trim()) return fail('same');
    db.setPlayerCredentials(account.id, password.trim(), account.role);
    return player ? res.redirect(startPage + '&status=password_changed') : res.redirect('/login?changed=1');
  });

  return router;
}

module.exports = { authPage, changePasswordRouter };
