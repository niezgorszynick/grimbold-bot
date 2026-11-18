// views/tabs/glos.js — "Głos" tab (one DM's alone, auth.js isGlosOwner): write
// to chosen players as The Voice in their Discord DMs, and read what they
// write back, one conversation per player. public/glos.js does the work.

'use strict';

const db = require('../../db');
const { MAX_TEXT } = require('../../glos');

// JSON inside <script>: nothing in it may close the tag.
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

module.exports = function renderGlosTab() {
  const data = {
    recipients: db.getGlosRecipients().map(({ id, discord_tag, characters }) => ({ id, tag: discord_tag, characters })),
    messages: db.getGlosMessages(),
    maxText: MAX_TEXT
  };
  return `
    <div class="glos-page">
      <section class="card glos-compose">
        <h3>👁 Głos</h3>
        <p class="muted small">Grimbold delivers it to each player's Discord DMs, under Głos's name in a dark embed. Only you see this tab, the messages and the replies. Whatever a player writes back to Grimbold's DMs shows up here.</p>
        <div id="glos-app"><p class="muted">Loading…</p></div>
      </section>
      <section id="glos-history" aria-label="Conversations"></section>
    </div>
    <script type="application/json" id="glos-data">${safeJson(data)}</script>
    <script src="/admin/assets/discord-editor.js" defer></script>
    <script src="/admin/assets/glos.js" defer></script>
  `;
};
