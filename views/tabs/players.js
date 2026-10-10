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

  const editCharId = isAdmin && req.query.edit_char ? parseInt(req.query.edit_char, 10) : null;
  const charToEdit = editCharId ? db.getCharacterById(editCharId) : null;
  const characterClasses = charToEdit ? db.getCharacterClasses(charToEdit.id) : [];
  const secondaryCharacterClasses = characterClasses.filter(classRow => classRow.is_primary !== 1);
  const characterAdventureIds = charToEdit
    ? db.getCharacterAdventureIds(charToEdit.id)
    : [];
  const availableAdventures = charToEdit && db.getAllAdventures
    ? db.getAllAdventures()
    : [];
  const classNames = Object.keys(DND_CLASSES_AND_SUBCLASSES);
  const dndClassesJson = JSON.stringify(DND_CLASSES_AND_SUBCLASSES).replace(/</g, '\\u003c');
  const dndSpeciesJson = JSON.stringify(DND_DATA.species).replace(/</g, '\\u003c');
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

  const addSpeciesOptions = DND_SPECIES.map(s =>
    `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`
  );
  const addClassOptions = [
    '<option value="" selected disabled>-- Choose Class --</option>',
    ...classNames.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
  ];
  const addSubclassOptions = ['<option value="">-- None / Base --</option>'];

  let editSpeciesOptions = [];
  let editClassOptions = [];
  let editSubclassOptions = [];

  if (charToEdit) {
    const normalizedRace = (charToEdit.race || '').toLowerCase();
    const normalizedClass = (charToEdit.class || '').toLowerCase();
    const normalizedSubclass = (charToEdit.subclass || '').toLowerCase();
    editSpeciesOptions = DND_SPECIES.map(s =>
      `<option value="${escapeHtml(s)}" ${s.toLowerCase() === normalizedRace ? 'selected' : ''}>${escapeHtml(s)}</option>`
    );
    if (charToEdit.race && !DND_SPECIES.some(s => s.toLowerCase() === normalizedRace)) {
      editSpeciesOptions.unshift(`<option value="${escapeHtml(charToEdit.race)}" selected>${escapeHtml(charToEdit.race)}</option>`);
    }

    editClassOptions = classNames.map(c =>
      `<option value="${escapeHtml(c)}" ${c.toLowerCase() === normalizedClass ? 'selected' : ''}>${escapeHtml(c)}</option>`
    );
    if (charToEdit.class && !classNames.some(c => c.toLowerCase() === normalizedClass)) {
      editClassOptions.unshift(`<option value="${escapeHtml(charToEdit.class)}" selected>${escapeHtml(charToEdit.class)}</option>`);
    }

    const matchedClass = classNames.find(c => c.toLowerCase() === normalizedClass);
    const availableSubs = matchedClass ? DND_CLASSES_AND_SUBCLASSES[matchedClass] : [];
    editSubclassOptions = [
      `<option value="" ${charToEdit.subclass ? '' : 'selected'}>-- None / Base --</option>`,
      ...availableSubs.map(sub =>
        `<option value="${escapeHtml(sub)}" ${sub.toLowerCase() === normalizedSubclass ? 'selected' : ''}>${escapeHtml(sub)}</option>`
      )
    ];
    if (charToEdit.subclass && !availableSubs.some(sub => sub.toLowerCase() === normalizedSubclass)) {
      editSubclassOptions.splice(1, 0, `<option value="${escapeHtml(charToEdit.subclass)}" selected>${escapeHtml(charToEdit.subclass)}</option>`);
    }
  }

  let charFormHtml = '';
  if (charToEdit) {
    charFormHtml = `
      <div class="card" style="border: 1px solid #5865f2; margin-bottom: 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>Edit Character: ${escapeHtml(charToEdit.name)}</h3>
          <a href="/admin?tab=players" class="btn btn-small">Cancel</a>
        </div>
        <form method="POST" action="/admin/characters/update">
          <input type="hidden" name="id" value="${charToEdit.id}">
          
          <!-- Row 1: Player & Character Name -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px; margin-top: 10px;">
            <div>
              <label>Player (Discord User):</label><br>
              <select name="player_id" style="width: 100%; margin-top: 4px;" required>
                ${allPlayers.map(p => `<option value="${p.id}" ${p.id === charToEdit.player_id ? 'selected' : ''}>${escapeHtml(p.discord_tag)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>Character Name:</label><br>
              <input type="text" name="name" value="${escapeHtml(charToEdit.name)}" required style="width: 100%; margin-top: 4px;">
            </div>
          </div>

          <!-- Row 2: Species, Class, Subclass with Live Search Dropdowns -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 12px;">
            <div>
              <label style="white-space: nowrap;">Species (2024):</label><br>
              <input type="text" placeholder="Filter species..." oninput="filterDropdown('editSpeciesFilter', 'editSpeciesSelect')" id="editSpeciesFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
              <select name="race" id="editSpeciesSelect" required style="width: 100%; margin-top: 4px;" size="8">
                ${editSpeciesOptions.join('')}
              </select>
              <div id="editSpeciesTraits" class="species-traits" aria-live="polite"></div>
            </div>
            <div>
              <label style="white-space: nowrap;">Class (2024):</label><br>
              <input type="text" placeholder="Filter classes..." oninput="filterDropdown('editClassFilter', 'editClassSelect', 'editSubclassSelect', 'editSubclassFilter')" id="editClassFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
              <select name="class_name" id="editClassSelect" onchange="onClassChange(this.value, 'editSubclassSelect', 'editSubclassFilter')" required style="width: 100%; margin-top: 4px;" size="8">
                ${editClassOptions.join('')}
              </select>
            </div>
            <div>
              <label style="white-space: nowrap;">Subclass (2024):</label><br>
              <input type="text" placeholder="Filter subclasses..." oninput="filterDropdown('editSubclassFilter', 'editSubclassSelect')" id="editSubclassFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
              <select name="subclass" id="editSubclassSelect" style="width: 100%; margin-top: 4px;" size="8">
                ${editSubclassOptions.join('')}
              </select>
            </div>
          </div>

          <!-- Row 3: Manual XP Override, Level Override Option & Status -->
          <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
            <h4 style="margin: 0 0 8px 0; color: #d4af37; font-size: 13px;">Progression & Level Override:</h4>
            <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; align-items: flex-end;">
              <div>
                <label style="font-size: 12px;">Adventure XP (Override):</label><br>
                <input type="number" name="xp" min="0" value="${charToEdit.xp}" required style="width: 100%; margin-top: 4px;">
              </div>
              <div>
                <label style="font-size: 12px;">Purse:</label><br>
                <span class="purse-inputs">
                  <label><input type="number" name="purse_gp" min="0" step="1" value="${Math.floor(charToEdit.gold_cp / 100)}" aria-label="Gold pieces"> gp</label>
                  <label><input type="number" name="purse_sp" min="0" step="1" value="${Math.floor((charToEdit.gold_cp % 100) / 10)}" aria-label="Silver pieces"> sp</label>
                  <label><input type="number" name="purse_cp" min="0" step="1" value="${charToEdit.gold_cp % 10}" aria-label="Copper pieces"> cp</label>
                </span>
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
                  <input type="checkbox" id="overrideLvlCheck" name="override_level" value="1" onchange="toggleLevelInput(this)">
                  <strong>Override auto level calculation</strong>
                </label>
                <div style="font-size: 11px; color: #949ba4; margin-top: 4px;">
                  Unchecked = auto-calculates level from XP ($0$–$2 = 3$, $3 = 4$, $+4$ per level).
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

          <button type="submit" class="btn btn-green">Save Character Changes</button>
        </form>
      </div>

      <script>
        const multiclassNames = ${classNamesJson};
        function toggleLevelInput(cb) {
          const input = document.getElementById('editCharLevel');
          if (!cb.checked) {
            input.style.opacity = '0.6';
          } else {
            input.style.opacity = '1';
          }
        }
        document.addEventListener('DOMContentLoaded', () => {
          const cb = document.getElementById('overrideLvlCheck');
          if (cb) toggleLevelInput(cb);

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
    `;
  }

 const rosterHtml = `
    ${charFormHtml}

    <!-- Top Forms Grid: 1fr (Player Registration) to 2fr (Character Creation) -->
   ${isAdmin ? `<div style="display: ${charToEdit ? 'none' : 'grid'}; grid-template-columns: 1fr 2fr; gap: 20px; margin-bottom: 20px;">
      
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
            <th class="sortable">Discord ID</th>
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
          ${playerRows.length === 0 ? `<tr><td colspan="${9 + (isAdmin ? 1 : 0)}">${isAdmin ? 'No players or characters registered yet.' : 'No characters are linked to your player account yet.'}</td></tr>` : playerRows.map(row => `
            <tr class="${row.player_id === currentUser.id ? 'player-self' : ''}">
              <td data-sort="${escapeHtml(row.discord_tag)}"><strong>${escapeHtml(row.discord_tag)}</strong></td>
              <td data-sort="${escapeHtml(row.discord_id)}"><small style="color: #949ba4;">${escapeHtml(row.discord_id)}</small></td>
              <td data-sort="${escapeHtml(row.character_name || '')}">
                ${row.character_name ? `<strong>${escapeHtml(row.character_name)}</strong>` : '<em style="color: #949ba4;">(No character)</em>'}
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
                  <a href="/admin?tab=players&edit_char=${row.character_id}" class="btn btn-small">Edit Character</a>
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
            goldModalFeedback.textContent = 'Purse set to ' + data.formatted + '. Grimbold notes it in the character thread.';
            window.setTimeout(() => window.location.reload(), 700);
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
