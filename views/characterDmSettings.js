// views/characterDmSettings.js — The "DM settings" card at the foot of a
// character sheet (admins): who owns the character, XP and a level override,
// alive or dead (and how they died), the Discord thread, multiclass levels and
// the adventures log. Name, species, class and the purse are edited on the
// sheet itself. Posts to /admin/characters/update, which keeps what it isn't sent.

'use strict';

const db = require('../db');
const { DND_CLASSES_AND_SUBCLASSES } = require('../dndData');
const { escapeHtml } = require('./helpers');

module.exports = function dmSettingsHtml(charToEdit) {
  const allPlayers = db.getAllPlayers ? db.getAllPlayers() : [];
  const characterClasses = db.getCharacterClasses(charToEdit.id);
  const secondaryCharacterClasses = characterClasses.filter(classRow => classRow.is_primary !== 1);
  const characterAdventureIds = db.getCharacterAdventureIds(charToEdit.id);
  const availableAdventures = db.getAllAdventures ? db.getAllAdventures() : [];
  const classNames = Object.keys(DND_CLASSES_AND_SUBCLASSES);
  const classNamesJson = JSON.stringify(classNames).replace(/</g, '\\u003c');
  const secondaryClassAllocationRows = secondaryCharacterClasses.map(classRow => {
    const options = [...classNames];
    if (!options.some(className => className.toLowerCase() === classRow.class_name.toLowerCase())) {
      options.unshift(classRow.class_name);
    }
    return `
      <div class="class-allocation-row" data-subclass="${escapeHtml(classRow.subclass_name || '')}" style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
        <select class="class-allocation-name" aria-label="Multiclass name" style="flex: 2;">
          ${options.map(className => `<option value="${escapeHtml(className)}" ${className.toLowerCase() === classRow.class_name.toLowerCase() ? 'selected' : ''}>${escapeHtml(className)}</option>`).join('')}
        </select>
        <input class="class-allocation-level" type="number" min="1" max="20" value="${classRow.class_level}" aria-label="Class levels" style="width: 90px;">
        <button class="remove-class-allocation btn btn-small" type="button">Remove</button>
      </div>
    `;
  }).join('');

  return `
      <details class="card sheet-dm-settings">
        <summary><strong>🛡 DM settings</strong> <span class="muted small">owner, XP &amp; level, alive or dead, Discord thread, multiclass levels, adventures</span></summary>
        <form method="POST" action="/admin/characters/update">
          <input type="hidden" name="id" value="${charToEdit.id}">
          <input type="hidden" name="return_to" value="sheet">
          
          <div style="margin: 10px 0 12px;">
            <label>Player (Discord User):</label><br>
            <select name="player_id" style="width: 100%; max-width: 360px; margin-top: 4px;" required>
              ${allPlayers.map(p => `<option value="${p.id}" ${p.id === charToEdit.player_id ? 'selected' : ''}>${escapeHtml(p.discord_tag)}</option>`).join('')}
            </select>
          </div>

          <!-- Row 3: Manual XP Override, Level Override Option & Status -->
          <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
            <h4 style="margin: 0 0 8px 0; color: #d4af37; font-size: 13px;">Progression & Level Override:</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; align-items: flex-end;">
              <div>
                <label style="font-size: 12px;">Adventure XP (Override):</label><br>
                <input type="number" id="editCharXp" name="xp" min="0" value="${charToEdit.xp}" required style="width: 100%; margin-top: 4px;">
              </div>
              <div>
                <label style="font-size: 12px;">Discord thread (🧝┆soh-postaci):</label><br>
                <input type="text" name="discord_thread" value="${escapeHtml(charToEdit.discord_thread_id || '')}" placeholder="Paste the thread link, or leave empty to find it by name" style="width: 100%; margin-top: 4px;">
              </div>
              <div>
                <label style="font-size: 12px;">Level (1–20):</label><br>
                <input type="number" id="editCharLevel" name="level" min="1" max="20" value="${charToEdit.level}" style="width: 100%; margin-top: 4px;">
              </div>
              <div>
                <label style="font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="overrideLvlCheck" name="override_level" value="1" onchange="toggleLevelInput(this)"${charToEdit.level !== db.calculateLevelFromXp(charToEdit.xp) ? ' checked' : ''}>
                  <strong>Override auto level calculation</strong>
                </label>
                <div style="font-size: 11px; color: #949ba4; margin-top: 4px;">
                  Unchecked = level from XP (0–2 XP = 3, 3 XP = 4, then +1 level per 4 XP). Untick and save to go back to it.
                </div>
              </div>
              <div>
                <label style="font-size: 12px;">Status:</label><br>
                <select name="status" id="char-status-select" style="width: 100%; margin-top: 4px;" required>
                  <option value="alive" ${charToEdit.status === 'alive' ? 'selected' : ''}>Alive</option>
                  <option value="dead" ${charToEdit.status === 'dead' ? 'selected' : ''}>Dead</option>
                </select>
              </div>
            </div>
          </div>

          <div id="cause-of-death-box" style="display: ${charToEdit.status === 'dead' ? 'block' : 'none'}; background: #232428; border: 1px solid #f23f43; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
            <h4 style="margin: 0 0 8px 0; color: #f23f43; font-size: 13px;">Cause of Death / Demise Chronicle</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div>
                <label for="death-adventure">Fateful Adventure:</label>
                <select id="death-adventure" name="death_adventure_id" style="width: 100%; margin-top: 4px;">
                  <option value="">Unknown / not recorded</option>
                  ${availableAdventures.map(adventure => `<option value="${adventure.id}" ${Number(charToEdit.death_adventure_id) === Number(adventure.id) ? 'selected' : ''}>${escapeHtml(adventure.title)} (#${adventure.id})</option>`).join('')}
                </select>
              </div>
              <div>
                <label for="death-dm">Dungeon Master (Host):</label>
                <select id="death-dm" name="death_dm_player_id" style="width: 100%; margin-top: 4px;">
                  <option value="">Unknown / not recorded</option>
                  ${allPlayers.map(player => `<option value="${player.id}" ${Number(charToEdit.death_dm_player_id) === Number(player.id) ? 'selected' : ''}>${escapeHtml(player.discord_tag)}</option>`).join('')}
                </select>
              </div>
              <div style="grid-column: 1 / -1;">
                <label for="death-notes">Death Circumstances / Last Words:</label>
                <textarea id="death-notes" name="death_notes" rows="2" maxlength="2000" placeholder="e.g. Slain by an ancient red dragon in the fiery caverns..." style="width: 100%; margin-top: 4px;">${escapeHtml(charToEdit.death_notes || '')}</textarea>
              </div>
            </div>
          </div>

          <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
            <label style="font-weight: bold; color: #d4af37; font-size: 13px;">
              <input type="checkbox" id="edit-class-allocations">
              Redistribute multiclass levels
            </label>
            <p style="color: #949ba4; font-size: 12px; margin: 6px 0;">
              Leave unchecked to assign level-ups automatically to the primary class. You can still remove secondary classes; their levels return to the primary class. When enabled, set secondary class levels; the primary class receives the remaining XP-derived levels.
            </p>
            <div id="secondary-class-allocations">
              ${secondaryClassAllocationRows || '<p id="no-secondary-classes" style="color: #949ba4; font-size: 12px;">No secondary classes.</p>'}
            </div>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
              <select id="add-secondary-class" aria-label="Choose a secondary class" style="flex: 1;">
                <option value="">-- Add secondary class --</option>
                ${classNames.map(className => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('')}
              </select>
              <button id="add-secondary-class-button" class="btn btn-small" type="button">Add Class</button>
            </div>
            <input id="class-allocations-json" type="hidden" name="class_allocations" disabled>
          </div>

          <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
            <label style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #d4af37; font-size: 13px;">
              <span>Completed Adventures Log</span>
              <span id="selected-adventures-count" style="color: #949ba4; font-weight: normal;">Adventures: ${characterAdventureIds.length}</span>
            </label>
            ${availableAdventures.length === 0 ? '<p style="margin: 8px 0 0; color: #949ba4; font-size: 12px;">No completed adventures available.</p>' : `
              <input type="text" id="adventure-search" placeholder="Filter by title, DM, or session ID..." style="width: 100%; margin-top: 8px;">
              <div id="adventures-list-container" style="max-height: 220px; overflow-y: auto; margin-top: 8px; padding: 8px; border: 1px solid #3b3e45; border-radius: 4px;">
                ${availableAdventures.map(adventure => `
                  <div class="adventure-item" data-title="${escapeHtml(adventure.title.toLowerCase())}" data-dm="${escapeHtml((adventure.dm_name || '').toLowerCase())}" data-id="${adventure.id}" style="padding: 8px; border: 1px solid #3b3e45; border-radius: 4px; margin-bottom: 6px;">
                    <label for="character_adventure_${adventure.id}" style="display: block; font-size: 13px; cursor: pointer;">
                      <input class="adventure-checkbox" type="checkbox" name="adventure_ids" value="${adventure.id}" id="character_adventure_${adventure.id}" ${characterAdventureIds.includes(adventure.id) ? 'checked' : ''}>
                      <strong>${escapeHtml(adventure.title)}</strong>
                      <span style="display: block; color: #949ba4; font-size: 11px; margin-left: 22px;">
                        Session #${adventure.id} · DM: ${escapeHtml(adventure.dm_name || 'Unknown')} · +${adventure.xp_awarded} XP
                      </span>
                    </label>
                  </div>
                `).join('')}
              </div>
            `}
            <div id="selected-adventure-badges" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px;">
              <span style="color: #949ba4; font-size: 12px;">Selected:</span>
            </div>
            <small style="display: block; color: #949ba4; margin-top: 6px;">Selected adventures are linked to this character, and their XP rewards are synchronized when you save.</small>
          </div>

          <button type="submit" class="btn btn-green">Save DM settings</button>
        </form>
      <script>
        const multiclassNames = ${classNamesJson};
        // Same formula as calculateLevelFromXp in db/characters.js.
        function levelFromXp(xp) {
          const points = Math.max(0, parseInt(xp, 10) || 0);
          return points < 3 ? 3 : Math.min(20, 4 + Math.floor((points - 3) / 4));
        }
        // Unticked: the level follows the XP and can't be typed in.
        function toggleLevelInput(cb) {
          const input = document.getElementById('editCharLevel');
          const xpInput = document.getElementById('editCharXp');
          input.readOnly = !cb.checked;
          input.style.opacity = cb.checked ? '1' : '0.6';
          if (!cb.checked && xpInput) input.value = levelFromXp(xpInput.value);
        }
        document.addEventListener('DOMContentLoaded', () => {
          const cb = document.getElementById('overrideLvlCheck');
          if (cb) {
            toggleLevelInput(cb);
            const xpInput = document.getElementById('editCharXp');
            if (xpInput) xpInput.addEventListener('input', () => toggleLevelInput(cb));
          }

          const characterStatus = document.getElementById('char-status-select');
          const deathDetails = document.getElementById('cause-of-death-box');
          if (characterStatus && deathDetails) {
            characterStatus.addEventListener('change', () => {
              deathDetails.style.display = characterStatus.value === 'dead' ? 'block' : 'none';
            });
          }

          const searchInput = document.getElementById('adventure-search');
          const adventureItems = document.querySelectorAll('.adventure-item');
          const adventureCheckboxes = document.querySelectorAll('.adventure-checkbox');
          const adventureCount = document.getElementById('selected-adventures-count');
          const selectedBadges = document.getElementById('selected-adventure-badges');
          const allocationToggle = document.getElementById('edit-class-allocations');
          const allocationContainer = document.getElementById('secondary-class-allocations');
          const allocationJson = document.getElementById('class-allocations-json');
          const addClassSelect = document.getElementById('add-secondary-class');
          const addClassButton = document.getElementById('add-secondary-class-button');
          const characterForm = document.querySelector('form[action="/admin/characters/update"]');
          let hasRemovedClassAllocation = false;

          function updateAllocationMode() {
            const enabled = allocationToggle.checked;
            allocationJson.disabled = !enabled && !hasRemovedClassAllocation;
            allocationContainer.querySelectorAll('select, input').forEach(control => {
              control.disabled = !enabled;
            });
            allocationContainer.querySelectorAll('.remove-class-allocation').forEach(button => {
              button.disabled = false;
            });
            addClassSelect.disabled = !enabled;
            addClassButton.disabled = !enabled;
          }

          function addClassAllocation(className, level = 1) {
            const emptyMessage = document.getElementById('no-secondary-classes');
            if (emptyMessage) emptyMessage.remove();

            const row = document.createElement('div');
            row.className = 'class-allocation-row';
            row.dataset.subclass = '';
            row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 8px;';

            const classSelect = document.createElement('select');
            classSelect.className = 'class-allocation-name';
            classSelect.setAttribute('aria-label', 'Multiclass name');
            classSelect.style.flex = '2';
            multiclassNames.forEach(name => classSelect.add(new Option(name, name)));
            classSelect.value = className;
            classSelect.addEventListener('change', () => { row.dataset.subclass = ''; });

            const levelInput = document.createElement('input');
            levelInput.className = 'class-allocation-level';
            levelInput.type = 'number';
            levelInput.min = '1';
            levelInput.max = '20';
            levelInput.value = level;
            levelInput.setAttribute('aria-label', 'Class levels');
            levelInput.style.width = '90px';

            const removeButton = document.createElement('button');
            removeButton.className = 'remove-class-allocation btn btn-small';
            removeButton.type = 'button';
            removeButton.textContent = 'Remove';

            row.append(classSelect, levelInput, removeButton);
            allocationContainer.appendChild(row);
            updateAllocationMode();
          }

          allocationContainer.addEventListener('change', event => {
            if (event.target.matches('.class-allocation-name')) {
              event.target.closest('.class-allocation-row').dataset.subclass = '';
            }
          });
          allocationContainer.addEventListener('click', event => {
            if (event.target.matches('.remove-class-allocation')) {
              event.target.closest('.class-allocation-row').remove();
              hasRemovedClassAllocation = true;
              if (!allocationContainer.querySelector('.class-allocation-row')) {
                const emptyMessage = document.createElement('p');
                emptyMessage.id = 'no-secondary-classes';
                emptyMessage.style.cssText = 'color: #949ba4; font-size: 12px;';
                emptyMessage.textContent = 'No secondary classes.';
                allocationContainer.appendChild(emptyMessage);
              }
              updateAllocationMode();
            }
          });
          allocationToggle.addEventListener('change', updateAllocationMode);
          addClassButton.addEventListener('click', () => {
            const className = addClassSelect.value;
            if (!className) return;
            if ([...allocationContainer.querySelectorAll('.class-allocation-name')]
              .some(select => select.value.toLowerCase() === className.toLowerCase())) {
              return;
            }
            addClassAllocation(className);
            addClassSelect.value = '';
          });
          characterForm.addEventListener('submit', () => {
            if (allocationToggle.checked || hasRemovedClassAllocation) {
              allocationJson.value = JSON.stringify(
                [...allocationContainer.querySelectorAll('.class-allocation-row')].map(row => ({
                  class_name: row.querySelector('.class-allocation-name').value,
                  subclass_name: row.dataset.subclass || null,
                  level: row.querySelector('.class-allocation-level').value
                }))
              );
            }
          });
          updateAllocationMode();

          if (searchInput) {
            searchInput.addEventListener('input', () => {
              const query = searchInput.value.toLowerCase().trim();
              adventureItems.forEach(item => {
                const matches = item.dataset.title.includes(query) ||
                  item.dataset.dm.includes(query) ||
                  item.dataset.id.includes(query);
                item.style.display = matches ? '' : 'none';
              });
            });
          }

          function updateSelectedAdventures() {
            const selected = document.querySelectorAll('.adventure-checkbox:checked');
            if (adventureCount) adventureCount.textContent = 'Adventures: ' + selected.length;
            if (!selectedBadges) return;

            selectedBadges.replaceChildren();
            const label = document.createElement('span');
            label.style.cssText = 'color: #949ba4; font-size: 12px;';
            label.textContent = 'Selected:';
            selectedBadges.appendChild(label);

            if (selected.length === 0) {
              const empty = document.createElement('span');
              empty.style.cssText = 'color: #949ba4; font-size: 12px; font-style: italic;';
              empty.textContent = 'None';
              selectedBadges.appendChild(empty);
              return;
            }

            selected.forEach(checkbox => {
              const item = checkbox.closest('.adventure-item');
              const title = item.querySelector('strong').textContent;
              const badge = document.createElement('span');
              badge.className = 'party-badge';
              badge.appendChild(document.createTextNode(title));

              const removeButton = document.createElement('button');
              removeButton.type = 'button';
              removeButton.setAttribute('aria-label', 'Remove ' + title);
              removeButton.textContent = '×';
              removeButton.addEventListener('click', () => {
                checkbox.checked = false;
                updateSelectedAdventures();
              });
              badge.appendChild(removeButton);
              selectedBadges.appendChild(badge);
            });
          }

          adventureCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateSelectedAdventures);
          });
          updateSelectedAdventures();
        });
      </script>
      </details>`;
};
