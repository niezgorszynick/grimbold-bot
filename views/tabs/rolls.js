// views/tabs/rolls.js — "rolls" tab of the admin panel: the weekly shop d20s
// and the rolls made in the panel, one sub-tab per die (?die=20, ?die=6, ...).

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

// "4, ~~2~~" — dice dropped by advantage or "keep highest" struck through.
function facesHtml(faces) {
  return faces.map(face => (face.kept ? `<strong>${face.value}</strong>` : `<s class="muted">${face.value}</s>`)).join(', ');
}

function weeklyRollsCard(rolls) {
  return `
    <div class="card">
      <h3>Player Discount Rolls (Last 100)</h3>
      <table>
        <thead>
          <tr>
            <th class="sortable">Week Start</th>
            <th class="sortable">Player</th>
            <th class="sortable">d20 Result</th>
            <th class="sortable">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          ${rolls.length === 0 ? '<tr><td colspan="4">No rolls recorded yet.</td></tr>' : rolls.map(r => `
            <tr>
              <td data-sort="${r.week_start}">${r.week_start}</td>
              <td data-sort="${escapeHtml(r.display_name || r.user_id)}">
                <strong>${escapeHtml(r.display_name || r.user_id)}</strong>${r.display_name && r.display_name !== r.user_id ? `<br><small style="color:#949ba4;">${r.user_id}</small>` : ''}
              </td>
              <td data-sort="${r.roll_value}"><strong>d20 = ${r.roll_value}</strong></td>
              <td data-sort="${r.created_at}">${r.created_at}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function sheetRollsCard(sides, sheetRolls) {
  const d20 = sides === 20;
  const intro = d20
    ? 'Checks, saves, attacks and initiative rolled in the panel. These count towards the d20 stats on the Analytics tab.'
    : `Every panel roll with a d${sides}: damage, custom formulas and critical hits. Each die counts towards the d${sides} chart on the Analytics tab.`;
  return `
    <div class="card">
      <h3>Character Sheet Rolls with a d${sides} (Last 100)</h3>
      <p class="muted small">${intro}</p>
      <table id="sheet-rolls-d${sides}" data-filter="player" data-page-size="50" data-item-label="rolls" data-search-placeholder="Search character, player or roll…">
        <thead>
          <tr>
            <th class="sortable">When</th>
            <th class="sortable">Character</th>
            <th class="sortable">Player</th>
            <th class="sortable">Roll</th>
            <th class="sortable">d${sides}</th>
            <th class="sortable">Total</th>
          </tr>
        </thead>
        <tbody>
          ${sheetRolls.length === 0 ? `<tr><td colspan="6">No d${sides} rolled on character sheets yet.</td></tr>` : sheetRolls.map(roll => {
            const kept = roll.faces.filter(face => face.kept);
            const natural = d20 && kept.length ? kept[0].value : null;
            const sortValue = kept.length ? kept.reduce((sum, face) => sum + face.value, 0) : -1;
            return `
            <tr data-search="${escapeHtml(`${roll.character} ${roll.player || ''} ${roll.label}`.toLowerCase())}" data-player="${escapeHtml(roll.player || '')}">
              <td data-sort="${roll.id}">${escapeHtml(String(roll.createdAt || '').slice(0, 16))}</td>
              <td data-sort="${escapeHtml(roll.character)}"><strong>${escapeHtml(roll.character)}</strong></td>
              <td data-sort="${escapeHtml(roll.player || '')}">${escapeHtml(roll.player || '—')}</td>
              <td data-sort="${escapeHtml(roll.label)}">${escapeHtml(roll.label)}${roll.mode !== 'normal' ? ` <span class="muted small">(${escapeHtml(roll.mode)})</span>` : ''}${roll.private ? ' <span class="tag gold">GM only</span>' : ''}${!d20 && roll.formula ? `<br><span class="muted small">${escapeHtml(roll.formula)}</span>` : ''}</td>
              <td data-sort="${sortValue}">${roll.faces.length ? facesHtml(roll.faces) : '<span class="muted">hidden</span>'}${natural === 20 ? ' <span class="tag green">nat 20</span>' : natural === 1 ? ' <span class="tag red">nat 1</span>' : ''}</td>
              <td data-sort="${roll.total === null ? -1 : roll.total}">${roll.total === null ? '<span class="muted">—</span>' : `<strong>${roll.total}</strong>`}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

module.exports = function renderRollsTab(ctx) {
  const { req, rolls, isAdmin, currentUser } = ctx;
  const requested = Number.parseInt(req.query.die, 10);
  const sides = db.TRACKED_DICE.includes(requested) ? requested : 20;
  const sheetRolls = db.getSheetRollsByDie({ sides, limit: 100, showPrivate: isAdmin, viewerId: currentUser && currentUser.id });
  const subtabs = `
    <nav class="player-subtabs" aria-label="Dice">
      ${db.TRACKED_DICE.map(die => `<a href="/admin?tab=rolls&die=${die}"${die === sides ? ' class="active" aria-current="page"' : ''}>d${die}</a>`).join('')}
    </nav>`;
  return `
    ${subtabs}
    ${sides === 20 ? weeklyRollsCard(rolls) : ''}
    ${sheetRollsCard(sides, sheetRolls)}
  `;
};
