// views/tabs/adventures.js — "adventures" tab of the admin panel.

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

// The live table of one adventure's party (filled in by adventure-table.js).
function renderAdventureTable(adventureId, isAdmin) {
  return `
    <div class="adventure-table-page">
      <a href="/admin?tab=adventures" class="btn btn-small btn-secondary">← All adventures</a>
      <section id="adventure-table" data-adventure-id="${adventureId}" data-is-admin="${isAdmin ? 'true' : 'false'}" aria-live="polite">Loading adventure…</section>
      <script src="/admin/assets/adventure-table.js" defer></script>
    </div>`;
}

// Adventures that are running, from Discord threads or started by hand.
function renderActiveAdventures({ isAdmin, currentUser, allPlayers }) {
  const active = isAdmin ? db.getActiveAdventures() : db.getAdventuresForUser(currentUser);
  if (!isAdmin && !active.length) return '';
  const date = text => escapeHtml(String(text || '').slice(0, 16));
  return `
    <div class="card">
      <div class="roster-heading">
        <h3>Active Adventures (${active.length})</h3>
        <p class="muted small">Grimbrandt writes every new thread in ❗┆zlecenia into his chronicle. Its DM puts the party together here and finishes the adventure to award XP; the thread is then marked [ZAMKNIĘTE].</p>
      </div>
      ${active.length ? `
        <table class="roster-table">
          <thead><tr><th>Adventure</th><th>DM</th><th>Started</th><th>Party</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            ${active.map(adventure => `
              <tr>
                <td><a class="roster-name" href="/admin?tab=adventures&table=${adventure.id}">${escapeHtml(adventure.title)}</a>
                  ${adventure.thread_url ? ` <a class="muted small" href="${escapeHtml(adventure.thread_url)}" target="_blank" rel="noopener">Discord thread ↗</a>` : ''}</td>
                <td>${adventure.dm_name ? escapeHtml(adventure.dm_name) : '<span class="muted">Unknown — not linked to a player</span>'}</td>
                <td>${date(adventure.created_at)}</td>
                <td>${adventure.party_size}</td>
                <td class="roster-actions"><a class="btn btn-small btn-gold" href="/admin?tab=adventures&table=${adventure.id}">Open table</a></td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p class="muted">No adventures running right now.</p>'}
      ${isAdmin ? `
        <form method="POST" action="/admin/adventures/start" class="table-filter adventure-start">
          <input type="text" name="title" maxlength="200" placeholder="Start an adventure by hand: title…" required aria-label="Adventure title">
          <select name="dm_player_id" aria-label="Dungeon Master">
            <option value="">-- DM --</option>
            ${allPlayers.map(player => `<option value="${player.id}">${escapeHtml(player.discord_tag)}</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-small btn-green">Start adventure</button>
        </form>` : ''}
    </div>`;
}

module.exports = function renderAdventuresTab(ctx) {
  const { req, isAdmin, currentUser } = ctx;
  let contentHtml = '';
  const tableId = Number.parseInt(req.query.table, 10);
  if (Number.isSafeInteger(tableId) && tableId > 0) return renderAdventureTable(tableId, isAdmin);
  const allAdventures = db.getAllAdventures ? db.getAllAdventures() : [];
  const allPlayers = db.getAllPlayers ? db.getAllPlayers() : [];
  const editAdvId = isAdmin && req.query.edit_adv ? Number(req.query.edit_adv) : null;
  let editingAdventure = null;
  let editingParticipantIds = [];

  if (Number.isSafeInteger(editAdvId) && editAdvId > 0) {
    editingAdventure = db.getAdventureById(editAdvId) || null;
    if (editingAdventure) {
      editingParticipantIds = db.getAdventureParticipantIds(editAdvId);
    }
  }
  if (req.query.edit_adv && !editingAdventure) {
    ctx.setStatusBanner('<div class="alert red">Adventure not found. It may have been deleted.</div>');
  }

  const allCharacters = db.getAllCharacters
    ? db.getAllCharacters()
    : db.prepare('SELECT c.*, p.discord_tag, p.dm_points FROM characters c LEFT JOIN players p ON c.player_id = p.id ORDER BY c.name ASC').all();
  const playerRows = db.getAllPlayersWithCharacters ? db.getAllPlayersWithCharacters() : [];
  const activeCharacters = playerRows.filter(r => r.character_id && r.character_status === 'alive');
  const adventureCharacters = editingAdventure
    ? allCharacters
      .filter(c => c.status === 'alive' || editingParticipantIds.includes(c.id))
      .map(c => ({
        character_id: c.id,
        character_name: c.name,
        character_level: c.level,
        character_class: c.class,
        discord_tag: c.discord_tag,
        player_id: c.player_id
      }))
    : activeCharacters;
  const playersById = new Map(allPlayers.map(player => [player.id, player]));
  const charactersByPlayer = new Map();
  adventureCharacters.forEach(character => {
    if (!charactersByPlayer.has(character.player_id)) {
      charactersByPlayer.set(character.player_id, []);
    }
    charactersByPlayer.get(character.player_id).push(character);
  });
  const characterGroupsHtml = Array.from(charactersByPlayer.entries()).map(([playerId, characters]) => {
    const player = playersById.get(playerId);
    const playerName = player ? player.discord_tag : (characters[0].discord_tag || 'Unknown');
    return `
      <div class="player-group" data-player="${escapeHtml(playerName.toLowerCase())}">
        <div class="player-group-title">
          ${escapeHtml(playerName)} <span style="color: #949ba4; font-family: monospace;">(${player ? player.dm_points || 0 : 0} DM pts)</span>
        </div>
        <div class="character-grid">
          ${characters.map(c => `
            <div class="char-item" data-name="${escapeHtml(c.character_name.toLowerCase())}" data-player="${escapeHtml(playerName.toLowerCase())}">
              <label>
                <input class="char-checkbox" type="checkbox" name="character_ids" value="${c.character_id}" id="adventure_char_${c.character_id}" ${editingParticipantIds.includes(c.character_id) ? 'checked' : ''}>
                <strong>${escapeHtml(c.character_name)}</strong> <span style="color: #949ba4;">(Lvl ${c.character_level} ${escapeHtml(c.character_class)})</span>
              </label>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
  const adventureFormAction = editingAdventure ? '/admin/adventures/edit' : '/admin/adventures/add';

  contentHtml = `
    ${renderActiveAdventures({ isAdmin, currentUser, allPlayers })}
    <div class="adventure-layout" style="${isAdmin ? '' : 'grid-template-columns: minmax(0, 1fr);'}">
      
      ${isAdmin ? `
          <!-- Adventure Record Form -->
          <div class="card" style="margin-bottom: 0;">
            <h3>${editingAdventure ? 'Edit Completed Adventure' : 'Record Completed Adventure'}</h3>
            <p style="font-size: 13px; color: #949ba4; margin-top: -5px; margin-bottom: 14px;">
              ${editingAdventure
                ? 'Updating this adventure adjusts participant XP and the DM reward.'
                : 'Finalizing an adventure awards XP to all selected characters and grants +1 DM Point to the host.'}
            </p>

            <form method="POST" action="${adventureFormAction}">
              ${editingAdventure ? `<input type="hidden" name="adventure_id" value="${editingAdventure.id}">` : ''}
              <div style="margin-bottom: 10px;">
                <label>Adventure Title:</label><br>
                <input type="text" name="title" value="${editingAdventure ? escapeHtml(editingAdventure.title) : ''}" placeholder="e.g. Seekers of the Lost Tomb - Part 1" required style="width: 100%; margin-top: 4px;">
              </div>
          
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div>
                  <label>Dungeon Master (Host):</label><br>
                  <select name="dm_player_id" style="width: 100%; margin-top: 4px;">
                    <option value="">-- No DM Point awarded --</option>
                ${allPlayers.map(p => `<option value="${p.id}" ${editingAdventure && Number(p.id) === Number(editingAdventure.dm_player_id) ? 'selected' : ''}>${escapeHtml(p.discord_tag)}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label>Adventure XP Points:</label><br>
                  <input type="number" name="xp_awarded" min="1" value="${editingAdventure ? editingAdventure.xp_awarded : 1}" required style="width: 100%; margin-top: 4px;">
                </div>
              </div>

              <div style="margin-bottom: 10px;">
                <label>Direct DM Character Reward (+1 XP):</label><br>
                <select name="dm_character_id" style="width: 100%; margin-top: 4px;">
                  <option value="">-- Bank +1 Point to DM Bank --</option>
                  ${allCharacters.map(c => `<option value="${c.id}" ${editingAdventure && Number(c.id) === Number(editingAdventure.dm_character_id) ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.discord_tag || 'Unknown')}, Lvl ${c.level}, ${c.xp} XP)</option>`).join('')}
                </select>
                <small style="display: block; color: #949ba4; margin-top: 4px;">Choose a DM character to award +1 XP directly, or leave empty to bank +1 DM Point with the selected host.</small>
              </div>

              <div style="margin-bottom: 10px;">
                <label>Session Summary / Notes:</label><br>
                <textarea name="description" rows="2" placeholder="Brief chronicle of the adventure..." style="width: 100%; margin-top: 4px;">${editingAdventure ? escapeHtml(editingAdventure.description || '') : ''}</textarea>
              </div>

              <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
                <label style="display: flex; justify-content: space-between; font-weight: bold; color: #d4af37; font-size: 13px;">
                  <span>Participating Characters</span>
                  <span id="selected-count" style="color: #949ba4; font-weight: normal;">Selected: 0</span>
                </label>
                <input type="text" id="character-search" placeholder="Filter by player or character name..." style="width: 100%; margin-top: 8px;">
                <div id="characters-container" style="max-height: 240px; overflow-y: auto; margin-top: 8px; padding: 8px; border: 1px solid #3b3e45; border-radius: 4px;">
                  ${characterGroupsHtml || '<p style="color: #949ba4; font-size: 12px;">No active characters available.</p>'}
                </div>
                <div id="selected-badges-container" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px;">
                  <span style="color: #949ba4; font-size: 12px;">Party:</span>
                </div>
              </div>

              <button type="submit" class="btn btn-green" style="padding: 10px 16px;">${editingAdventure ? 'Save Adventure Changes' : '⚔️ Finalize Adventure & Award Rewards'}</button>
              ${editingAdventure ? '<a href="/admin?tab=adventures" class="btn" style="display: inline-block; margin-top: 8px;">Cancel Edit</a>' : ''}
            </form>
      </div>
      ` : ''}

      <!-- Leveling Rules Card -->
      <div class="card" style="margin-bottom: 0;">
        <h3>Campaign Leveling & Milestone Rules</h3>
        <div style="font-size: 13px; line-height: 1.6; color: #dbdee1;">
          <p><strong>• Starting Baseline:</strong> Every newly registered adventurer starts at <strong>Level 3</strong> (0 Adventure XP).</p>
          <p><strong>• Milestone Thresholds:</strong></p>
          <ul style="padding-left: 20px; margin-top: 4px;">
            <li><strong>Level 3 &rarr; Level 4:</strong> Requires <strong>3 Completed Adventures</strong> (3 XP).</li>
            <li><strong>Level 4 &rarr; Level 5:</strong> Requires <strong>4 Completed Adventures</strong> (7 total XP).</li>
            <li><strong>Level 5+ Progression:</strong> Requires <strong>4 Completed Adventures</strong> per subsequent level.</li>
          </ul>
          <p><strong>• Dungeon Master Bonus:</strong> Hosting an adventure automatically awards +1 DM Adventure Point into the DM's bank, assignable to any of their own characters in the <em>Players</em> tab as +1 XP.</p>
        </div>
      </div>
    </div>

    <!-- Adventures History Table -->
    <div class="card">
      <h3>Completed Adventures History (${allAdventures.length})</h3>
      <div class="adventure-table-wrap">
      <table>
        <thead>
          <tr>
            <th class="sortable">Date</th>
            <th class="sortable">Title</th>
            <th class="sortable">Dungeon Master</th>
            <th class="sortable">XP Granted</th>
            <th>Notes</th>
            ${isAdmin ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${allAdventures.length === 0 ? `<tr><td colspan="${isAdmin ? 6 : 5}">No completed adventures recorded yet.</td></tr>` : allAdventures.map(adv => `
            <tr>
              <td data-sort="${adv.created_at}">${adv.created_at}</td>
              <td data-sort="${escapeHtml(adv.title)}"><strong>${escapeHtml(adv.title)}</strong></td>
              <td data-sort="${escapeHtml(adv.dm_name || '')}">${adv.dm_name ? escapeHtml(adv.dm_name) : '<em>None</em>'}</td>
              <td data-sort="${adv.xp_awarded}"><span class="tag green">+${adv.xp_awarded} XP</span></td>
              <td>${escapeHtml(adv.description || '—')}</td>
              ${isAdmin ? `<td style="text-align: right;"><a class="btn btn-small btn-gold" href="/admin?tab=adventures&edit_adv=${adv.id}">Edit</a></td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  return contentHtml;
};
