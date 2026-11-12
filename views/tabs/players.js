// views/tabs/players.js — "players" tab of the admin panel.

'use strict';

const db = require('../../db');
const { formatCp } = require('../../currency');
const { DND_SPECIES, DND_DATA, DND_CLASSES_AND_SUBCLASSES } = require('../../dndData');
const { escapeHtml } = require('../helpers');

module.exports = function renderPlayersTab(ctx) {
  const { req, currentUser, isAdmin, isRootAdmin, status } = ctx;
  let contentHtml = '';
  const allPlayers = (db.getAllPlayers ? db.getAllPlayers() : [])
    .filter(player => isAdmin || player.id === currentUser.id);
  const playerView = isRootAdmin && req.query.view === 'accounts' ? 'accounts' : 'roster';
  const playersSubnavHtml = isRootAdmin ? `
    <div class="player-subtabs" role="tablist" aria-label="Players sections">
      <a href="/admin?tab=players&view=roster" class="${playerView === 'roster' ? 'active' : ''}" role="tab" aria-selected="${playerView === 'roster'}">Character Roster</a>
      <a href="/admin?tab=players&view=accounts" class="${playerView === 'accounts' ? 'active' : ''}" role="tab" aria-selected="${playerView === 'accounts'}">Passwords &amp; Roles</a>
    </div>
  ` : '';
  const playerRows = (db.getAllPlayersWithCharacters ? db.getAllPlayersWithCharacters() : [])
    .filter(row => isAdmin || row.player_id === currentUser.id);

  const classNames = Object.keys(DND_CLASSES_AND_SUBCLASSES);
  const dndClassesJson = JSON.stringify(DND_CLASSES_AND_SUBCLASSES).replace(/</g, '\\u003c');
  const dndSpeciesJson = JSON.stringify(DND_DATA.species).replace(/</g, '\\u003c');
  const addSpeciesOptions = DND_SPECIES.map(s =>
    `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`
  );
  const addClassOptions = [
    '<option value="" selected disabled>-- Choose Class --</option>',
    ...classNames.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
  ];
  const addSubclassOptions = ['<option value="">-- None / Base --</option>'];


 const rosterHtml = `

    <!-- Top Forms Grid: 1fr (Player Registration) to 2fr (Character Creation) -->
   ${isAdmin ? `<div style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px; margin-bottom: 20px;">
      
      <!-- Left Card: Register Player -->
      <div class="card" style="margin-bottom: 0;">
        <h3>Register Player</h3>
        <form method="POST" action="/admin/players/add">
          <div style="margin-bottom: 12px;">
            <label>Discord Username / Tag:</label><br>
            <input type="text" name="discord_tag" placeholder="e.g. Liam#1234 or liam_rpg" required style="width: 100%; margin-top: 4px;">
          </div>
          <div style="margin-bottom: 16px;">
            <label>Discord User ID:</label><br>
            <input type="text" name="discord_id" placeholder="e.g. 289123456789012345" required style="width: 100%; margin-top: 4px;">
          </div>
          <button type="submit" class="btn btn-green">Add Player</button>
        </form>
      </div>

      <!-- Right Card: Add Character to Player -->
      <div class="card" style="margin-bottom: 0;">
        <h3>Add Character to Player</h3>
        ${allPlayers.length === 0 ? '<p style="color: #949ba4;">Register at least one player on the left before adding characters.</p>' : `
          <form method="POST" action="/admin/characters/add">
            <!-- Row 1: Player & Character Name -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
              <div>
                <label style="white-space: nowrap;">Assign to Player:</label><br>
                <select name="player_id" style="width: 100%; margin-top: 4px;" required>
                  ${allPlayers.map(p => `<option value="${p.id}">${escapeHtml(p.discord_tag)} (${p.dm_points || 0} DM pts)</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="white-space: nowrap;">Character Name:</label><br>
                <input type="text" name="name" placeholder="e.g. Thorin Oakenshield" required style="width: 100%; margin-top: 4px;">
              </div>
            </div>

            <!-- Row 2: Species, Class, Subclass with Live Search Dropdowns -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 12px;">
              <div>
                <label style="white-space: nowrap;">Species (2024):</label><br>
                <input type="text" placeholder="Filter species..." oninput="filterDropdown('addSpeciesFilter', 'addSpeciesSelect')" id="addSpeciesFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                <select name="race" id="addSpeciesSelect" required style="width: 100%; margin-top: 4px;" size="8">
                  ${addSpeciesOptions.join('')}
                </select>
                <div id="addSpeciesTraits" class="species-traits" aria-live="polite"></div>
              </div>
              <div>
                <label style="white-space: nowrap;">Class (2024):</label><br>
                <input type="text" placeholder="Filter classes..." oninput="filterDropdown('addClassFilter', 'addClassSelect', 'addSubclassSelect', 'addSubclassFilter')" id="addClassFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                <select name="class_name" id="addClassSelect" onchange="onClassChange(this.value, 'addSubclassSelect', 'addSubclassFilter')" required style="width: 100%; margin-top: 4px;" size="8">
                  ${addClassOptions.join('')}
                </select>
              </div>
              <div>
                <label style="white-space: nowrap;">Subclass (2024):</label><br>
                <input type="text" placeholder="Filter subclasses..." oninput="filterDropdown('addSubclassFilter', 'addSubclassSelect')" id="addSubclassFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                <select name="subclass" id="addSubclassSelect" style="width: 100%; margin-top: 4px;" size="8">
                  ${addSubclassOptions.join('')}
                </select>
              </div>
            </div>

            <!-- Row 3: XP, Level (Locked), Status, Submit Button -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: 14px; align-items: flex-end;">
              <div>
                <label style="white-space: nowrap; font-size: 12px;">Starting XP (0 = Lvl 3):</label><br>
                <input type="number" name="xp" min="0" value="0" required style="width: 100%; margin-top: 4px;">
              </div>
              <div>
                <label style="white-space: nowrap; font-size: 12px;">Starting Gold (gp):</label><br>
                <input type="number" name="gold_gp" min="0" step="0.01" value="0" required style="width: 100%; margin-top: 4px;">
              </div>
              <div>
                <label style="white-space: nowrap; font-size: 12px;">Starting Level:</label><br>
                <input type="text" value="Starts at Lvl 3" disabled style="width: 100%; margin-top: 4px; opacity: 0.7;">
              </div>
              <div>
                <label style="white-space: nowrap; font-size: 12px;">Status:</label><br>
                <select name="status" style="width: 100%; margin-top: 4px;" required>
                  <option value="alive" selected>Alive</option>
                  <option value="dead">Dead</option>
                </select>
              </div>
              <div>
                <button type="submit" class="btn btn-green" style="white-space: nowrap; padding: 9px 18px;">Create Character</button>
              </div>
            </div>
          </form>
        `}
      </div>
    </div>` : ''}

    <!-- Character Roster Table: Full-width container matching top grid -->
    <div class="card" style="width: 100%;">
      <h3>${isAdmin ? 'Campaign Characters & Roster' : 'My Characters'} (${playerRows.filter(r => r.character_id).length} characters)</h3>
      <table style="width: 100%;">
        <thead>
          <tr>
            <th class="sortable">Player (Discord)</th>
            <th class="sortable">Character</th>
            <th class="sortable">Race</th>
            <th class="sortable">Class</th>
            <th class="sortable">Level</th>
            <th class="sortable">XP</th>
            <th class="sortable">Purse</th>
            <th class="sortable">Status</th>
            ${isAdmin ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${playerRows.length === 0 ? `<tr><td colspan="${8 + (isAdmin ? 1 : 0)}">${isAdmin ? 'No players or characters registered yet.' : 'No characters are linked to your player account yet.'}</td></tr>` : playerRows.map(row => `
            <tr class="${row.player_id === currentUser.id ? 'player-self' : ''}">
              <td data-sort="${escapeHtml(row.discord_tag)}">
                <strong>${escapeHtml(row.discord_tag)}</strong>
                ${isAdmin ? `<details class="roster-player-edit">
                  <summary title="Edit the player's Discord name and ID">✏️</summary>
                  <form method="POST" action="/admin/players/update" class="roster-player-form">
                    <input type="hidden" name="id" value="${Number(row.player_id)}">
                    <label>Discord name<input type="text" name="discord_tag" value="${escapeHtml(row.discord_tag)}" required></label>
                    <label>Discord ID<input type="text" name="discord_id" value="${escapeHtml(row.discord_id)}" required inputmode="numeric" pattern="[0-9]{5,25}" title="The numeric Discord user ID"></label>
                    <button type="submit" class="btn btn-small btn-green">Save player</button>
                  </form>
                </details>` : ''}
              </td>
              <td data-sort="${escapeHtml(row.character_name || '')}">
                <span class="roster-character">
                  ${row.character_portrait_file ? `<img class="roster-portrait" src="/api/characters/${Number(row.character_id)}/portrait?v=${encodeURIComponent(row.character_portrait_file)}" alt="" loading="lazy">` : ''}
                  ${row.character_name
                    ? `<a href="/admin?tab=character-sheet&edit_char=${Number(row.character_id)}" class="roster-character-name" title="Open the character sheet">${escapeHtml(row.character_name)}</a>`
                    : '<em style="color: #949ba4;">(No character)</em>'}
                </span>
              </td>
              <td data-sort="${escapeHtml(row.character_race || '')}">${row.character_race ? escapeHtml(row.character_race) : '—'}</td>
              <td data-sort="${escapeHtml(row.character_class || '')}">
                ${row.character_class ? `${escapeHtml(row.character_class)}${row.character_subclass ? ` (${escapeHtml(row.character_subclass)})` : ''}` : '—'}
              </td>
              <td data-sort="${row.character_level || 0}">Lvl ${row.character_level || 3}</td>
              <td data-sort="${row.character_xp || 0}">${row.character_xp !== null && row.character_xp !== undefined ? `${row.character_xp} XP` : '—'}</td>
              <td data-sort="${row.character_gold_cp || 0}">${row.character_id ? formatCp(row.character_gold_cp || 0) : '—'}</td>
              <td data-sort="${row.character_status || ''}">
                ${row.character_status === 'alive' 
                  ? '<span class="tag green">Alive</span>' 
                  : row.character_status === 'dead' 
                    ? '<span class="tag red">Dead</span>' 
                    : '—'}
              </td>
              ${isAdmin ? `<td style="white-space: nowrap;">
                ${row.character_id ? `
                  <button type="button" class="btn btn-small btn-gold edit-character-gold" data-character-id="${row.character_id}" data-character-name="${escapeHtml(row.character_name)}" data-character-gold-cp="${row.character_gold_cp || 0}">💰 Edit purse</button>
                  <form method="POST" action="/admin/characters/delete" style="display:inline;" onsubmit="return confirm('Delete character &quot;${escapeHtml(row.character_name)}&quot;?');">
                    <input type="hidden" name="id" value="${row.character_id}">
                    <button type="submit" class="btn btn-small btn-red">Delete Char</button>
                  </form>
                ` : `
                  <form method="POST" action="/admin/players/delete" style="display:inline;" onsubmit="return confirm('Remove player &quot;${escapeHtml(row.discord_tag)}&quot;?');">
                    <input type="hidden" name="id" value="${row.player_id}">
                    <button type="submit" class="btn btn-small btn-red">Delete Player</button>
                  </form>
                `}
              </td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${isAdmin ? `
      <div id="goldEditModal" class="shop-modal" role="dialog" aria-modal="true" aria-labelledby="goldEditTitle" hidden>
        <div class="card shop-modal-card">
          <h3 id="goldEditTitle">🪙 Edit Purse</h3>
          <p>Character: <strong id="goldModalCharName"></strong></p>
          <input type="hidden" id="goldModalCharId">
          <div class="purse-inputs" style="margin: 8px 0;">
            <label><input type="number" id="goldModalGp" min="0" step="1" aria-label="Gold pieces"> gp</label>
            <label><input type="number" id="goldModalSp" min="0" step="1" aria-label="Silver pieces"> sp</label>
            <label><input type="number" id="goldModalCp" min="0" step="1" aria-label="Copper pieces"> cp</label>
          </div>
          <label for="goldModalReason">Reason (shown in the character's Discord thread)</label>
          <input type="text" id="goldModalReason" maxlength="200" placeholder="e.g. Reward from the Mayor of Phandalin" style="width: 100%; margin: 4px 0 12px;">
          <p id="goldModalFeedback" role="status" aria-live="polite"></p>
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" id="goldModalCancel" class="btn">Cancel</button>
            <button type="button" id="goldModalSave" class="btn btn-gold">Update Gold</button>
          </div>
        </div>
      </div>
    ` : ''}

    <script>
      const classTree = ${dndClassesJson};
      const speciesData = ${dndSpeciesJson};

      const goldEditModal = document.getElementById('goldEditModal');
      if (goldEditModal) {
        const goldModalFeedback = document.getElementById('goldModalFeedback');
        const goldModalSave = document.getElementById('goldModalSave');

        document.querySelectorAll('.edit-character-gold').forEach(button => {
          button.addEventListener('click', () => {
            document.getElementById('goldModalCharId').value = button.dataset.characterId;
            document.getElementById('goldModalCharName').textContent = button.dataset.characterName;
            const purseCp = Number(button.dataset.characterGoldCp) || 0;
            document.getElementById('goldModalGp').value = Math.floor(purseCp / 100);
            document.getElementById('goldModalSp').value = Math.floor((purseCp % 100) / 10);
            document.getElementById('goldModalCp').value = purseCp % 10;
            document.getElementById('goldModalReason').value = '';
            goldModalFeedback.textContent = '';
            goldEditModal.hidden = false;
          });
        });
        document.getElementById('goldModalCancel').addEventListener('click', () => {
          goldEditModal.hidden = true;
        });
        goldModalSave.addEventListener('click', async () => {
          const characterId = document.getElementById('goldModalCharId').value;
          const coins = {
            gp: document.getElementById('goldModalGp').value,
            sp: document.getElementById('goldModalSp').value,
            cp: document.getElementById('goldModalCp').value,
            reason: document.getElementById('goldModalReason').value
          };
          goldModalSave.disabled = true;
          goldModalFeedback.textContent = 'Updating the purse...';
          try {
            const response = await fetch('/api/characters/' + encodeURIComponent(characterId) + '/gold', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(coins)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not update the purse.');
            const note = data.note || {};
            goldModalFeedback.textContent = 'Purse set to ' + data.formatted + '. ' + (note.ok ? 'Grimbold noted it in the character thread.' : note.ok === null ? note.reason : 'Not posted to Discord: ' + (note.reason || 'unknown reason') + '.');
            window.setTimeout(() => window.location.reload(), note.ok ? 1500 : 4000);
          } catch (error) {
            goldModalFeedback.textContent = error.message;
            goldModalSave.disabled = false;
          }
        });
      }

      function updateSpeciesTraits(selectId, displayId) {
        const select = document.getElementById(selectId);
        const display = document.getElementById(displayId);
        if (!select || !display) return;

        const species = speciesData[select.value];
        if (!species) {
          display.replaceChildren();
          return;
        }

        const heading = document.createElement('strong');
        heading.textContent = 'Traits';
        const details = document.createElement('p');
        details.className = 'muted small';
        details.textContent = 'Size: ' + species.size + ' · Speed: ' + species.speed + ' ft.';
        const list = document.createElement('ul');
        species.traits.forEach(trait => {
          const item = document.createElement('li');
          const name = document.createElement('strong');
          name.textContent = trait.name;
          item.append(name, document.createTextNode(' — ' + trait.description));
          list.appendChild(item);
        });
        display.replaceChildren(heading, details, list);
      }

      document.getElementById('addSpeciesSelect')?.addEventListener('change', () => {
        updateSpeciesTraits('addSpeciesSelect', 'addSpeciesTraits');
      });
      document.getElementById('editSpeciesSelect')?.addEventListener('change', () => {
        updateSpeciesTraits('editSpeciesSelect', 'editSpeciesTraits');
      });
      updateSpeciesTraits('addSpeciesSelect', 'addSpeciesTraits');
      updateSpeciesTraits('editSpeciesSelect', 'editSpeciesTraits');

      function filterDropdown(filterInputId, selectId) {
        const filterEl = document.getElementById(filterInputId);
        const selectEl = document.getElementById(selectId);
        if (!filterEl || !selectEl) return;

        const filterText = filterEl.value.trim().toLowerCase();
        const options = selectEl.querySelectorAll('option');
        let firstMatch = null;

        options.forEach(option => {
          const isMatch = option.text.toLowerCase().includes(filterText);
          option.style.display = isMatch ? '' : 'none';
          if (isMatch && !firstMatch) firstMatch = option;
        });

        if (firstMatch && filterText.length > 0) {
          selectEl.value = firstMatch.value;
          if (selectId.includes('SpeciesSelect')) {
            const isEdit = selectId.startsWith('edit');
            updateSpeciesTraits(
              selectId,
              isEdit ? 'editSpeciesTraits' : 'addSpeciesTraits'
            );
          }
          if (selectId.includes('ClassSelect')) {
            const isEdit = selectId.startsWith('edit');
            onClassChange(
              firstMatch.value,
              isEdit ? 'editSubclassSelect' : 'addSubclassSelect',
              isEdit ? 'editSubclassFilter' : 'addSubclassFilter'
            );
          }
        }
      }

      function onClassChange(className, subSelectId, subFilterId) {
        const subSelect = document.getElementById(subSelectId);
        const subFilter = document.getElementById(subFilterId);
        if (subFilter) subFilter.value = '';
        if (!subSelect) return;

        subSelect.innerHTML = '<option value="">-- None / Base --</option>';

        if (className && classTree[className]) {
          classTree[className].forEach(subclass => {
            const option = document.createElement('option');
            option.value = subclass;
            option.textContent = subclass;
            subSelect.appendChild(option);
          });
        }
      }
    </script>
  `;

  const accountAccessHtml = `
    <section class="card">
      <h3>Passwords &amp; Roles (${allPlayers.length} accounts)</h3>
      <p class="muted">Set or reset a player's password and choose whether they can manage the campaign as a DM.</p>
      <div class="analytics-table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable">Player (Discord Tag)</th>
              <th class="sortable">Discord ID</th>
              <th class="sortable">Current Role</th>
              <th>Account Access</th>
            </tr>
          </thead>
          <tbody>
            ${allPlayers.length === 0 ? '<tr><td colspan="4" class="analytics-empty">No players registered yet.</td></tr>' : allPlayers.map(player => `
              <tr>
                <td><strong>${escapeHtml(player.discord_tag)}</strong></td>
                <td><small class="muted">${escapeHtml(player.discord_id)}</small></td>
                <td><span class="analytics-badge ${player.role === 'admin' ? 'primary' : ''}">${player.role === 'admin' ? 'Admin (DM)' : 'Player'}</span></td>
                <td>
                  <form method="POST" action="/admin/players/set-access" class="player-credentials-form">
                    <input type="hidden" name="player_id" value="${player.id}">
                    <input type="password" name="password" placeholder="${player.has_password ? 'New Password' : 'Set Password'}" aria-label="Set password for ${escapeHtml(player.discord_tag)}" autocomplete="new-password" minlength="4" required>
                    <select name="role" aria-label="Role for ${escapeHtml(player.discord_tag)}">
                      <option value="player" ${player.role !== 'admin' ? 'selected' : ''}>Player</option>
                      <option value="admin" ${player.role === 'admin' ? 'selected' : ''}>Admin (DM)</option>
                    </select>
                    <button type="submit" class="btn btn-small btn-gold">Save</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;

  contentHtml = `${playersSubnavHtml}${playerView === 'accounts' ? accountAccessHtml : rosterHtml}`;
  return contentHtml;
};
