// views/tabs/rolls.js — "rolls" tab of the admin panel.

'use strict';

const { escapeHtml } = require('../helpers');

module.exports = function renderRollsTab(ctx) {
  const { rolls } = ctx;
  let contentHtml = '';
  contentHtml = `
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
    </div>
  `;
  return contentHtml;
};
