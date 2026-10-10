// views/tabs/characterSheet.js — "character-sheet" tab of the admin panel.

'use strict';

const db = require('../../db');
const { DND_SPECIES, DND_DATA, DND_CLASSES_AND_SUBCLASSES } = require('../../dndData');
const { escapeHtml } = require('../helpers');

// The DM's view of every character: one sortable, filterable row each, with
// the numbers looked up during play.
function renderRoster() {
  const rows = db.getCampaignRoster();
  const players = new Set(rows.map(row => row.player)).size;
  const alive = rows.filter(row => row.status === 'alive').length;
  const waiting = rows.filter(row => row.pendingLevels > 0).length;
  const dash = '<span class="muted">—</span>';
  const classText = row => row.classes.map(entry => `${escapeHtml(entry.className)}${row.classes.length > 1 ? ` ${entry.level}` : ''}${entry.subclassName ? ` <span class="muted">(${escapeHtml(entry.subclassName)})</span>` : ''}`).join(' / ');
  const hpCell = row => {
    if (row.status !== 'alive') return `<td data-sort="-1">${dash}</td>`;
    if (!row.hp) return `<td data-sort="-1">${dash}</td>`;
    const ratio = row.hp.max ? row.hp.current / row.hp.max : 0;
    const state = row.hp.current === 0 ? 'down' : ratio <= 0.5 ? 'hurt' : 'ok';
    const label = row.hp.current === 0 ? (row.hp.stable ? 'stable' : 'down') : '';
    return `<td data-sort="${ratio.toFixed(3)}"><span class="roster-hp roster-hp-${state}">${row.hp.current}</span><span class="muted">/${row.hp.max}</span>${row.hp.temp ? ` <span class="tag" title="Temporary HP">+${row.hp.temp}</span>` : ''}${label ? ` <span class="tag red">${label}</span>` : ''}</td>`;
  };
  const number = value => (value === null || value === undefined ? `<td data-sort="-1">${dash}</td>` : `<td data-sort="${value}">${value}</td>`);
  return `
    <section class="card roster">
      <div class="roster-heading">
        <h3>Campaign Roster</h3>
        <p class="muted small">${rows.length} characters · ${players} players · ${alive} alive${waiting ? ` · <span class="tag gold">${waiting} level-up${waiting > 1 ? 's' : ''} waiting</span>` : ''}</p>
      </div>
      <table id="campaign-roster" class="roster-table" data-filter="player,class,status" data-page-size="100" data-item-label="characters" data-search-placeholder="Search character, player, class or species…">
        <thead>
          <tr>
            <th class="sortable">Character</th>
            <th class="sortable">Player</th>
            <th class="sortable">Class</th>
            <th class="sortable">Lvl</th>
            <th class="sortable">HP</th>
            <th class="sortable" title="Armor Class">AC</th>
            <th class="sortable" title="Passive Perception">PP</th>
            <th class="sortable" title="Spell save DC">DC</th>
            <th class="sortable">Gold</th>
            <th class="sortable">XP</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr class="${row.status === 'alive' ? '' : 'roster-dead'}"
                data-search="${escapeHtml(`${row.name} ${row.player} ${row.species} ${row.classes.map(entry => `${entry.className} ${entry.subclassName || ''}`).join(' ')}`.toLowerCase())}"
                data-player="${escapeHtml(row.player)}" data-class="${escapeHtml(row.classes[0].className)}"
                data-status="${row.status === 'alive' ? 'Alive' : 'Dead'}">
              <td data-sort="${escapeHtml(row.name)}">
                <a href="/admin?tab=character-sheet&edit_char=${row.id}" class="roster-name">${escapeHtml(row.name)}</a>
                <div class="muted small">${escapeHtml(row.species || 'Unknown')}${row.status === 'alive' ? '' : ' · <span class="tag red">Dead</span>'}</div>
              </td>
              <td data-sort="${escapeHtml(row.player)}">${escapeHtml(row.player)}</td>
              <td data-sort="${escapeHtml(row.classes[0].className)}">${classText(row)}</td>
              <td data-sort="${row.level}">${row.level}${row.pendingLevels ? ` <span class="tag gold" title="Earned from XP, not applied yet">+${row.pendingLevels}</span>` : ''}</td>
              ${hpCell(row)}
              ${number(row.armorClass)}
              ${number(row.passivePerception)}
              ${number(row.spellDc)}
              <td data-sort="${row.goldCp}">${formatGold(row.goldCp)}</td>
              <td data-sort="${row.xp}">${row.xp}</td>
              <td class="roster-actions"><a href="/admin?tab=character-sheet&edit_char=${row.id}" class="btn btn-small">${row.pendingLevels ? 'Level up' : 'Open'}</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>`;
}

// Whole gold pieces for the roster ("1,250 gp"); exact coins are on the sheet.
function formatGold(cp) {
  const gp = Math.floor((Number(cp) || 0) / 100);
  return `${gp.toLocaleString('en-US')} gp`;
}

module.exports = function renderCharacterSheetTab(ctx) {
  const { req, currentUser, isAdmin, status } = ctx;
  let contentHtml = '';
  const characters = db.getAllPlayersWithCharacters()
    .filter(row => row.character_id && (isAdmin || row.player_id === currentUser.id));
  const requestedEditId = Number.parseInt(req.query.edit_char, 10);
  const characterToEdit = Number.isSafeInteger(requestedEditId)
    ? db.getCharacterById(requestedEditId)
    : null;
  const canManageOwnCharacters = currentUser.id > 0;
  const canEditRequestedCharacter = characterToEdit &&
    (isAdmin || (canManageOwnCharacters && characterToEdit.player_id === currentUser.id));
  const classNames = Object.keys(DND_CLASSES_AND_SUBCLASSES);
  const sheetClassTreeJson = JSON.stringify(DND_CLASSES_AND_SUBCLASSES).replace(/</g, '\\u003c');
  const sheetSpeciesJson = JSON.stringify(DND_DATA.species).replace(/</g, '\\u003c');
  const sheetBackgroundsJson = JSON.stringify(DND_DATA.backgrounds).replace(/</g, '\\u003c');
  const sheetClassRulesJson = JSON.stringify({
    ...DND_DATA.classes,
    ...DND_DATA.supplementalClasses
  }).replace(/</g, '\\u003c');
  const editFormHtml = req.query.edit_char
    ? canEditRequestedCharacter
      ? `
        <section id="cs_levelup" class="sheet-card levelup" data-character-id="${Number(characterToEdit.id)}" hidden></section>
        <script src="/admin/assets/character-levelup.js" defer></script>
        <section id="fullCharacterSheetContainer" class="character-sheet-full">
          <header class="sheet-header">
            <div class="sheet-identity">
              <h2 id="cs_header_name">Character Sheet</h2>
              <span id="cs_header_sub">Loading character...</span>
              <div class="sheet-identity-fields">
                <label>Name<input id="cs_name" type="text" maxlength="100" required></label>
                <label>Species<select id="cs_species" required>${DND_SPECIES.map(species => `<option value="${escapeHtml(species)}">${escapeHtml(species)}</option>`).join('')}</select></label>
                <label>Class<select id="cs_class" required>${classNames.map(className => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('')}</select></label>
                <label>Subclass<select id="cs_subclass"><option value="">-- None / Base --</option></select></label>
                <label>Background<select id="cs_background"><option value="">Choose background</option>${Object.keys(DND_DATA.backgrounds).map(background => `<option value="${escapeHtml(background)}">${escapeHtml(background)}</option>`).join('')}</select></label>
              </div>
            </div>
            <div class="sheet-header-actions">
              <a href="/admin?tab=character-sheet" class="btn btn-secondary">Back / Cancel</a>
              <button id="cs_save" class="btn btn-success" type="button" disabled>Save Sheet</button>
            </div>
          </header>
          <p id="cs_message" class="sheet-message" role="status" aria-live="polite"></p>
          <section class="sheet-card point-buy-card">
            <div class="point-buy-header">
              <div>
              <h3>Ability Scores</h3>
              <span>Scores from character creation plus Ability Score Improvements and feats.</span>
              </div>
            </div>
            <div id="cs_ability_container" class="sheet-abilities point-buy-grid"></div>
            <p id="cs_point_buy_error" class="point-buy-error" role="status" aria-live="polite" hidden></p>
            <div class="point-buy-actions">
              <span>Ability modifiers update automatically.</span>
            </div>
          </section>
          <div class="sheet-layout">
            <div class="sheet-col">
              <section class="sheet-card">
                <h4>Saving Throws</h4>
                <div id="cs_saves_container" class="sheet-check-list"></div>
              </section>
              <section class="sheet-card">
                <h4>Skills</h4>
                <p id="cs_skill_guidance" class="muted small" aria-live="polite"></p>
                <div id="cs_species_skill_choices"></div>
                <div id="cs_skills_container" class="sheet-check-list sheet-skills"></div>
              </section>
            </div>
            <div class="sheet-col">
              <div class="sheet-combat-stats">
                <label class="sheet-stat"><span>Armor Class</span><input type="number" id="cs_ac" min="0" max="100"></label>
                <label class="sheet-stat"><span>Initiative</span><input type="text" id="cs_initiative" maxlength="20"></label>
                <label class="sheet-stat"><span>Speed</span><input type="text" id="cs_speed" maxlength="40"></label>
                <div class="sheet-stat"><span>Proficiency Bonus</span><strong id="cs_prof_bonus">+2</strong></div>
              </div>
              <div id="cs_ac_details" class="ac-details" aria-live="polite"></div>
              <section class="sheet-card">
                <h4>Hit Points &amp; Vitality</h4>
                <div id="cs_vitals" class="vitals" data-character-id="${Number(characterToEdit.id)}" aria-live="polite">Loading hit points...</div>
                <script src="/admin/assets/character-vitals.js" defer></script>
              </section>
              <section class="sheet-card">
                <h4>Weapons &amp; Attacks</h4>
                <div id="cs_attacks_auto" data-character-id="${Number(characterToEdit.id)}">Loading attacks...</div>
                <script src="/admin/assets/character-combat.js" defer></script>
                <div class="sheet-section-heading sheet-other-attacks">
                  <h5>Other attacks <span class="muted small">(typed in; saved with the sheet)</span></h5>
                  <button id="cs_add_attack" class="btn btn-small" type="button">+ Add attack</button>
                </div>
                <div>
                  <table class="sheet-attacks" id="cs_attacks_table">
                    <thead><tr><th>Name</th><th>Atk Bonus</th><th>Damage / Type</th><th>Notes</th><th><span class="sr-only">Actions</span></th></tr></thead>
                    <tbody id="cs_attacks_tbody"></tbody>
                  </table>
                </div>
              </section>
              <section class="sheet-card">
                <h4>Class Features &amp; Species Traits</h4>
                <div id="cs_auto_features" class="sheet-auto-features" aria-live="polite"></div>
                <label class="sheet-notes-label">Additional notes<textarea id="cs_features" rows="5" maxlength="10000" placeholder="Record additional features, choices, or reminders..."></textarea></label>
              </section>
            </div>
          </div>
          <section class="sheet-card sheet-equipment">
            <h4>Equipment &amp; Items</h4>
            <div id="cs_inventory" class="inventory" data-character-id="${Number(characterToEdit.id)}">Loading items...</div>
            <script src="/admin/assets/character-inventory.js" defer></script>
            <label class="sheet-notes-label">Other notes (saved with the sheet)<textarea id="cs_equipment" rows="3" maxlength="10000" placeholder="Coins on the side, borrowed gear, things left at the inn..."></textarea></label>
          </section>
          <section id="cs_spells" class="sheet-card spells" data-character-id="${Number(characterToEdit.id)}" hidden></section>
          <script src="/admin/assets/character-spells.js" defer></script>
          <section id="cs_magic_items" class="sheet-card magic-items" data-character-id="${Number(characterToEdit.id)}" hidden></section>
          <script src="/admin/assets/character-magic-items.js" defer></script>
        </section>
      `
      : '<div class="alert red">Character not found or you do not have permission to edit it.</div>'
    : '';
  contentHtml = `
    <section class="card">
      <h3>${isAdmin ? 'Campaign Characters' : 'Your Characters'}</h3>
      ${canManageOwnCharacters
        ? `${isAdmin ? '' : '<p class="muted">Create a character or edit your existing character details below.</p>'}${req.query.edit_char ? '' : `<button id="open-character-creator" class="btn btn-green" type="button">+ Create New Character</button><section id="character-creator-view" class="card" hidden><div class="sheet-section-heading"><h4>Create New Character</h4><button id="close-character-creator" class="btn btn-secondary" type="button">Cancel</button></div><div id="character-creator-root"></div><script src="/admin/assets/character-creator.js" defer></script></section>`}`
        : '<p class="muted">All campaign characters are visible to DMs and admins.</p>'}
    </section>
    ${editFormHtml}
    ${characters.length === 0
      ? `<section class="card"><p class="muted">${isAdmin ? 'No characters have been created yet.' : 'You have not created any characters yet.'}</p></section>`
      : isAdmin ? renderRoster() : `
        <section class="character-sheet-grid" aria-label="Character sheets">
          ${characters.map(character => {
            const classRows = db.getCharacterClasses(character.character_id);
            const classesHtml = classRows.length > 0
              ? classRows.map(classRow => `
                <li>
                  <strong>${escapeHtml(classRow.class_name)}</strong>${classRow.subclass_name ? ` <span class="muted">(${escapeHtml(classRow.subclass_name)})</span>` : ''}
                  <span class="muted"> · Level ${classRow.class_level}</span>
                </li>
              `).join('')
              : `<li>${escapeHtml(character.character_class || 'Unknown')}</li>`;
            const canEdit = isAdmin || (canManageOwnCharacters && character.player_id === currentUser.id);
            // Levels earned from XP that the player has not applied yet.
            const appliedLevels = classRows.reduce((sum, classRow) => sum + classRow.class_level, 0);
            const pendingLevels = character.character_status === 'alive' && classRows.length > 0
              ? Math.max(0, (character.character_level || 0) - appliedLevels)
              : 0;
            const editButton = canEdit
              ? `<a href="/admin?tab=character-sheet&edit_char=${character.character_id}" class="btn btn-small">Edit Character Sheet</a>${pendingLevels > 0 ? ` <a href="/admin?tab=character-sheet&edit_char=${character.character_id}" class="btn btn-small btn-gold">Level Up${pendingLevels > 1 ? ` (${pendingLevels})` : ''}</a>` : ''}`
              : '';
            return `
              <article class="card character-sheet">
                <div class="character-sheet-header">
                  <h3>${escapeHtml(character.character_name)}</h3>
                  <span class="tag ${character.character_status === 'alive' ? 'green' : 'red'}">${character.character_status === 'alive' ? 'Alive' : 'Dead'}</span>
                </div>
                ${isAdmin ? `<p class="muted small">Player: ${escapeHtml(character.discord_tag)}</p>` : ''}
                <dl class="character-sheet-details">
                  <div><dt>Race</dt><dd>${escapeHtml(character.character_race || 'Unknown')}</dd></div>
                  <div><dt>Level</dt><dd>${character.character_level || 3}${pendingLevels > 0 ? ` <span class="tag gold" title="Earned but not yet applied">+${pendingLevels} pending</span>` : ''}</dd></div>
                  <div><dt>XP</dt><dd>${character.character_xp ?? 0}</dd></div>
                </dl>
                <h4>Classes</h4>
                <ul class="character-sheet-classes">${classesHtml}</ul>
                ${editButton ? `<div class="character-sheet-actions">${editButton}</div>` : ''}
              </article>
            `;
          }).join('')}
        </section>
      `}
    <script>
      const sheetClassTree = ${sheetClassTreeJson};
      const sheetSpecies = ${sheetSpeciesJson};
      const sheetBackgrounds = ${sheetBackgroundsJson};
      const sheetClassRules = ${sheetClassRulesJson};
      const fullSheetCharacterId = ${canEditRequestedCharacter ? Number(characterToEdit.id) : 'null'};
      const sheetViewerIsAdmin = ${isAdmin ? 'true' : 'false'};

      function initFullCharacterSheet() {
        const container = document.getElementById('fullCharacterSheetContainer');
        if (!container) return;

        const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        const skills = [
          ['Acrobatics', 'dex'], ['Animal Handling', 'wis'], ['Arcana', 'int'],
          ['Athletics', 'str'], ['Deception', 'cha'], ['History', 'int'],
          ['Insight', 'wis'], ['Intimidation', 'cha'], ['Investigation', 'int'],
          ['Medicine', 'wis'], ['Nature', 'int'], ['Perception', 'wis'],
          ['Performance', 'cha'], ['Persuasion', 'cha'], ['Religion', 'int'],
          ['Sleight of Hand', 'dex'], ['Stealth', 'dex'], ['Survival', 'wis']
        ];
        const abilityContainer = document.getElementById('cs_ability_container');
        const classSelect = document.getElementById('cs_class');
        const subclassSelect = document.getElementById('cs_subclass');
        const speciesSelect = document.getElementById('cs_species');
        const backgroundSelect = document.getElementById('cs_background');
        const autoFeatures = document.getElementById('cs_auto_features');
        const speciesSkillChoicesContainer = document.getElementById('cs_species_skill_choices');
        abilities.forEach(ability => {
          const row = document.createElement('div');
          row.className = 'sheet-ability';
          const name = document.createElement('strong');
          name.textContent = ability.toUpperCase();
          const score = document.createElement('input');
          score.type = 'number';
          score.min = '1';
          score.max = '30';
          score.step = '1';
          score.dataset.ability = ability;
          score.setAttribute('aria-label', ability.toUpperCase() + ' score');
          score.value = '8';
          const modifier = document.createElement('span');
          modifier.className = 'sheet-ability-modifier';
          modifier.dataset.modifier = ability;
          row.append(name, score, modifier);
          abilityContainer.appendChild(row);
        });

        const savesContainer = document.getElementById('cs_saves_container');
        const skillsContainer = document.getElementById('cs_skills_container');
        abilities.forEach(ability => {
          const row = document.createElement('label');
          row.className = 'sheet-check-row';
          row.innerHTML = '<input type="checkbox" data-save="' + ability + '"><span>' +
            ability.toUpperCase() + '</span><strong class="sheet-check-modifier"></strong>';
          savesContainer.appendChild(row);
        });
        skills.forEach(([skill, ability]) => {
          const row = document.createElement('label');
          row.className = 'sheet-check-row';
          row.innerHTML = '<input type="checkbox" data-skill="' + skill + '"><span>' + skill +
            '</span><small>' + ability.toUpperCase() + '</small><strong class="sheet-check-modifier"></strong>';
          skillsContainer.appendChild(row);
        });

        const message = document.getElementById('cs_message');
        const pointBuyError = document.getElementById('cs_point_buy_error');
        const abilityScores = [...abilityContainer.querySelectorAll('[data-ability]')];
        const proficiencyBonus = document.getElementById('cs_prof_bonus');
        let sheetCharacterLevel = 1;
        let classLevel = 1;
        let classLevels = {};
        let selectedClassSkills = [];
        let selectedSpeciesSkills = [];
        let savedSpeciesSkills = [];
        // Saving throws stored on the sheet (class saves plus feats such as Resilient).
        let savedSaves = [];

        // Species, class, subclass and background come from creation and level-ups
        // (the DM changes them in the Players tab). For characters built with the
        // creator, ability scores, skills and saves are also set by the rules, so
        // only a DM edits them here. The server enforces the same rules.
        function lockRuleOwnedFields(character, data) {
          const reason = 'Set at character creation and by level-ups';
          [speciesSelect, classSelect, backgroundSelect].forEach(select => {
            select.disabled = true;
            select.title = reason;
          });
          // An older character may still pick a missing subclass.
          subclassSelect.disabled = Boolean(character.subclass);
          if (subclassSelect.disabled) subclassSelect.title = reason;
          if (!data.background) {
            backgroundSelect.disabled = false;
            backgroundSelect.title = '';
          }
          const rulesManaged = Array.isArray(data.originFeats) || Array.isArray(data.levelHistory);
          if (!rulesManaged || sheetViewerIsAdmin) return;
          abilityContainer.querySelectorAll('input').forEach(input => {
            input.disabled = true;
            input.title = reason;
          });
          skillsContainer.querySelectorAll('input').forEach(input => { input.disabled = true; });
          speciesSkillChoicesContainer.querySelectorAll('select').forEach(select => { select.disabled = true; });
          const note = document.createElement('p');
          note.className = 'muted small';
          note.textContent = 'Ability scores, skills and saving throws come from character creation and level-ups.';
          abilityContainer.after(note);
        }

        function updateRuleDrivenFields() {
          const classData = sheetClassRules[classSelect.value] || {};
          const backgroundData = sheetBackgrounds[backgroundSelect.value] || {};
          const speciesData = sheetSpecies[speciesSelect.value] || {};
          const fixedSkills = new Set([
            ...(backgroundData.skillProficiencies || []),
            ...(speciesData.skillProficiencies || []),
            ...selectedSpeciesSkills,
            ...savedSpeciesSkills
          ]);
          const classOptions = new Set(
            classData.skillChoices ? classData.skillChoices.options : []
          );
          selectedClassSkills = selectedClassSkills.filter(skill =>
            classOptions.has(skill) && !fixedSkills.has(skill)
          );
          const classChoiceCount = classData.skillChoices ? classData.skillChoices.count : 0;
          speciesSkillChoicesContainer.replaceChildren();
          if (speciesData.skillChoiceCount) {
            const label = document.createElement('label');
            label.className = 'sheet-species-skill-choice';
            label.textContent = 'Choose ' + speciesData.skillChoiceCount + ' species skill proficiency';
            for (let index = 0; index < speciesData.skillChoiceCount; index += 1) {
              const select = document.createElement('select');
              select.setAttribute('aria-label', 'Species skill choice ' + (index + 1));
              select.add(new Option('Choose a skill', ''));
              skills.forEach(([skill]) => select.add(new Option(skill, skill)));
              select.value = selectedSpeciesSkills[index] || '';
              select.addEventListener('change', () => {
                selectedSpeciesSkills = [...speciesSkillChoicesContainer.querySelectorAll('select')]
                  .map(item => item.value)
                  .filter(Boolean);
                updateRuleDrivenFields();
              });
              label.appendChild(select);
            }
            speciesSkillChoicesContainer.appendChild(label);
          }
          skills.forEach(([skill]) => {
            const checkbox = skillsContainer.querySelector('[data-skill="' + skill + '"]');
            const automatic = fixedSkills.has(skill);
            checkbox.checked = automatic || selectedClassSkills.includes(skill);
            checkbox.disabled = automatic || !classOptions.has(skill);
            const row = checkbox.closest('.sheet-check-row');
            row.classList.toggle('is-automatic-proficiency', automatic);
            const source = (backgroundData.skillProficiencies || []).includes(skill)
              ? 'Background'
              : (speciesData.skillProficiencies || []).includes(skill)
                ? 'Species'
                : 'Character feature';
            row.title = automatic
              ? 'Granted by ' + source
              : classOptions.has(skill) ? 'Choose as a class proficiency' : 'Not available from this class';
          });
          abilities.forEach(ability => {
            const checkbox = savesContainer.querySelector('[data-save="' + ability + '"]');
            checkbox.checked = (classData.savingThrows || []).includes(ability) || savedSaves.includes(ability);
            checkbox.disabled = true;
            checkbox.closest('.sheet-check-row').classList.toggle('is-automatic-proficiency', checkbox.checked);
          });
          const chosenCount = selectedClassSkills.length;
          const speciesChoiceCount = speciesData.skillChoiceCount || 0;
          document.getElementById('cs_skill_guidance').textContent = classChoiceCount
            ? 'Choose ' + classChoiceCount + ' skill proficiencies for ' + classSelect.value +
              ' (' + chosenCount + ' selected). Background and species proficiencies are automatic.'
            : 'Background and species proficiencies are automatic.';
          const classFeatures = [];
          Object.entries(classData.featuresByLevel || {})
            .filter(([level]) => Number(level) <= classLevel)
            .forEach(([, names]) => classFeatures.push(...names));
          const autoLines = [
            ...classFeatures.map(name => 'Class: ' + name),
            ...(subclassSelect.value && classLevel >= 3
              ? ['Subclass selected: ' + subclassSelect.value]
              : []),
            ...(backgroundData.skillProficiencies || []).map(skill => 'Background proficiency: ' + skill),
            ...(speciesData.traits || []).map(trait => trait.name + ': ' + trait.description)
          ];
          autoFeatures.replaceChildren();
          if (autoLines.length) {
            const list = document.createElement('ul');
            autoLines.forEach(line => {
              const item = document.createElement('li');
              item.textContent = line;
              list.appendChild(item);
            });
            autoFeatures.appendChild(list);
          } else {
            autoFeatures.textContent = 'Choose a class, species, and background to see features and proficiencies.';
          }
          updateDerivedStats(sheetCharacterLevel);
          updateAbilityValidation();
        }

        function updateSubclasses(selected = subclassSelect.value) {
          subclassSelect.replaceChildren(new Option('-- None / Base --', ''));
          (sheetClassTree[classSelect.value] || []).forEach(subclass => {
            subclassSelect.add(new Option(subclass, subclass));
          });
          if ([...subclassSelect.options].some(option => option.value === selected)) {
            subclassSelect.value = selected;
          }
        }

        function updateDerivedStats(level) {
          const bonus = Math.ceil(Math.max(1, Number(level) || 1) / 4) + 1;
          proficiencyBonus.textContent = '+' + bonus;
          abilityScores.forEach(input => {
            const ability = input.dataset.ability;
            const base = Number(input.value);
            const modifier = Number.isInteger(base) && base >= 1 && base <= 30
              ? Math.floor((base - 10) / 2)
              : null;
            const label = document.querySelector('[data-modifier="' + ability + '"]');
            label.textContent = modifier === null
              ? '—'
              : (modifier >= 0 ? '+' : '') + modifier;
          });
          abilities.forEach(ability => {
            const scoreInput = abilityContainer.querySelector('[data-ability="' + ability + '"]');
            const score = Number(scoreInput.value);
            const modifier = Number.isInteger(score) && score >= 1 && score <= 30
              ? Math.floor((score - 10) / 2)
              : 0;
            const saveRow = savesContainer.querySelector('[data-save="' + ability + '"]').closest('.sheet-check-row');
            const saveTotal = modifier + (saveRow.querySelector('input').checked ? bonus : 0);
            saveRow.querySelector('.sheet-check-modifier').textContent =
              (saveTotal >= 0 ? '+' : '') + saveTotal;
          });
          skills.forEach(([skill, ability]) => {
            const scoreInput = abilityContainer.querySelector('[data-ability="' + ability + '"]');
            const score = Number(scoreInput.value);
            const modifier = Number.isInteger(score) && score >= 1 && score <= 30
              ? Math.floor((score - 10) / 2)
              : 0;
            const skillRow = skillsContainer.querySelector('[data-skill="' + skill + '"]').closest('.sheet-check-row');
            const total = modifier + (skillRow.querySelector('input').checked ? bonus : 0);
            skillRow.querySelector('.sheet-check-modifier').textContent =
              (total >= 0 ? '+' : '') + total;
          });
        }

        function updateAbilityValidation() {
          const inputs = abilityScores.map(input => Number(input.value));
          const validAbilities = inputs.every(score =>
            Number.isInteger(score) && score >= 1 && score <= 30
          );
          const classData = sheetClassRules[classSelect.value] || {};
          const requiredSkills = classData.skillChoices ? classData.skillChoices.count : 0;
          const speciesChoiceCount = (sheetSpecies[speciesSelect.value] || {}).skillChoiceCount || 0;
          const validClassSkills = selectedClassSkills.length === requiredSkills &&
            selectedSpeciesSkills.length === speciesChoiceCount &&
            new Set(selectedSpeciesSkills).size === selectedSpeciesSkills.length;
          const error = !validAbilities
            ? 'Ability scores must be whole numbers from 1 to 30.'
            : !validClassSkills
              ? 'Choose exactly ' + requiredSkills + ' skill proficiencies for ' + classSelect.value +
                (speciesChoiceCount ? ' and ' + speciesChoiceCount + ' species skill proficiency.' : '.')
              : '';
          pointBuyError.textContent = error;
          pointBuyError.classList.toggle('is-error', Boolean(error));
          pointBuyError.hidden = !error;
          document.getElementById('cs_save').disabled = Boolean(error);
          return !error;
        }

        function getAbilityScores() {
          if (!updateAbilityValidation()) {
            throw new Error(pointBuyError.textContent || 'Ability scores must be whole numbers from 1 to 30.');
          }
          return Object.fromEntries(abilityScores.map(input => [
            input.dataset.ability, Number(input.value)
          ]));
        }

        // Notes boxes grow to fit their text, so the sheet has no inner scroll bars.
        const notesBoxes = ['cs_features', 'cs_equipment'].map(id => document.getElementById(id));
        function autosize(box) {
          box.style.height = 'auto';
          box.style.height = (box.scrollHeight + 2) + 'px';
        }
        function autosizeNotes() {
          notesBoxes.forEach(autosize);
        }
        notesBoxes.forEach(box => {
          box.classList.add('is-autosized');
          box.addEventListener('input', () => autosize(box));
        });

        // Typed-in attacks; worn weapons are listed above them automatically.
        const attacksTable = document.getElementById('cs_attacks_table');
        function syncAttacksTable() {
          attacksTable.hidden = document.getElementById('cs_attacks_tbody').children.length === 0;
        }
        function addAttackRow(attack = {}) {
          const row = document.createElement('tr');
          [
            ['name', 'Weapon name'], ['bonus', 'Attack bonus'],
            ['damage', 'Damage / type'], ['notes', 'Notes']
          ].forEach(([field, placeholder]) => {
            const cell = document.createElement('td');
            cell.dataset.label = placeholder;
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = field === 'notes' ? 300 : 100;
            input.dataset.attackField = field;
            input.setAttribute('aria-label', placeholder);
            input.placeholder = placeholder;
            input.value = typeof attack[field] === 'string' ? attack[field] : '';
            cell.appendChild(input);
            row.appendChild(cell);
          });
          const actionCell = document.createElement('td');
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'btn btn-small btn-secondary sheet-remove-attack';
          remove.textContent = '✕';
          remove.title = 'Remove';
          remove.setAttribute('aria-label', 'Remove attack');
          actionCell.appendChild(remove);
          row.appendChild(actionCell);
          document.getElementById('cs_attacks_tbody').appendChild(row);
          syncAttacksTable();
        }

        document.getElementById('cs_add_attack').addEventListener('click', () => {
          addAttackRow();
          const inputs = document.querySelectorAll('#cs_attacks_tbody tr:last-child input');
          if (inputs.length) inputs[0].focus();
        });
        document.getElementById('cs_attacks_tbody').addEventListener('click', event => {
          if (event.target.matches('.sheet-remove-attack')) {
            event.target.closest('tr').remove();
            syncAttacksTable();
          }
        });
        abilityContainer.addEventListener('input', event => {
          if (event.target.matches('[data-ability]')) {
            updateAbilityValidation();
            updateDerivedStats(sheetCharacterLevel);
          }
        });
        savesContainer.addEventListener('change', () => updateDerivedStats(sheetCharacterLevel));
        skillsContainer.addEventListener('change', () => updateDerivedStats(sheetCharacterLevel));
        skillsContainer.addEventListener('change', () => {
          const classData = sheetClassRules[classSelect.value] || {};
          const classOptions = new Set(classData.skillChoices ? classData.skillChoices.options : []);
          const backgroundData = sheetBackgrounds[backgroundSelect.value] || {};
          const speciesData = sheetSpecies[speciesSelect.value] || {};
          const fixedSkills = new Set([
            ...(backgroundData.skillProficiencies || []),
            ...(speciesData.skillProficiencies || []),
            ...savedSpeciesSkills
          ]);
          selectedClassSkills = skills
            .map(([skill]) => skill)
            .filter(skill => classOptions.has(skill) && !fixedSkills.has(skill) &&
              skillsContainer.querySelector('[data-skill="' + skill + '"]').checked);
          updateRuleDrivenFields();
        });
        classSelect.addEventListener('change', () => {
          classLevel = classLevels[classSelect.value] || sheetCharacterLevel;
          selectedClassSkills = [];
          updateSubclasses('');
          updateRuleDrivenFields();
        });
        subclassSelect.addEventListener('change', updateRuleDrivenFields);
        speciesSelect.addEventListener('change', updateRuleDrivenFields);
        backgroundSelect.addEventListener('change', updateRuleDrivenFields);

        async function loadSheet() {
          message.textContent = 'Loading character sheet...';
          try {
            const response = await fetch('/api/characters/' + fullSheetCharacterId);
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not load character sheet.');
            const character = result.character;
            const data = result.sheetData || {};
            sheetCharacterLevel = character.level || 1;
            const classRows = Array.isArray(result.classes) ? result.classes : [];
            classLevels = Object.fromEntries(classRows.map(classRow => [
              classRow.class_name, classRow.class_level
            ]));
            classLevel = classLevels[character.class] || sheetCharacterLevel;
            document.getElementById('cs_name').value = character.name || '';
            speciesSelect.value = character.race || '';
            classSelect.value = character.class || '';
            updateSubclasses(character.subclass || '');
            const savedBackground = data.pointBuy && data.pointBuy.background
              ? data.pointBuy.background
              : data.background;
            backgroundSelect.value = Object.prototype.hasOwnProperty.call(sheetBackgrounds, savedBackground)
              ? savedBackground
              : '';
            const savedSkills = Array.isArray(data.skillProficiencies) ? data.skillProficiencies : [];
            const backgroundSkills = sheetBackgrounds[backgroundSelect.value]
              ? sheetBackgrounds[backgroundSelect.value].skillProficiencies
              : [];
            const speciesSkills = (sheetSpecies[speciesSelect.value] || {}).skillProficiencies || [];
            const classSkillOptions = (sheetClassRules[classSelect.value] || {}).skillChoices
              ? sheetClassRules[classSelect.value].skillChoices.options
              : [];
            const savedSpeciesChoices = savedSkills.filter(skill =>
              !classSkillOptions.includes(skill) &&
              !backgroundSkills.includes(skill) &&
              !speciesSkills.includes(skill)
            );
            selectedSpeciesSkills = Array.isArray(data.speciesSkillChoices)
              ? data.speciesSkillChoices
              : savedSpeciesChoices.slice(0, ((sheetSpecies[speciesSelect.value] || {}).skillChoiceCount || 0));
            savedSpeciesSkills = savedSkills.filter(skill =>
              !classSkillOptions.includes(skill) &&
              !backgroundSkills.includes(skill) &&
              !speciesSkills.includes(skill) &&
              !selectedSpeciesSkills.includes(skill)
            );
            selectedClassSkills = savedSkills.filter(skill =>
              classSkillOptions.includes(skill) &&
              !backgroundSkills.includes(skill) &&
              !speciesSkills.includes(skill)
            );
            savedSaves = Array.isArray(data.savingProficiencies) ? data.savingProficiencies : [];
            updateRuleDrivenFields();
            document.getElementById('cs_header_name').textContent = character.name || 'Character Sheet';
            document.getElementById('cs_header_sub').textContent =
              'Level ' + (character.level || 1) + ' ' + (character.race || '') + ' ' +
              (character.class || 'Adventurer') +
              (character.subclass ? ' (' + character.subclass + ')' : '');
            abilities.forEach(ability => {
              const input = abilityContainer.querySelector('[data-ability="' + ability + '"]');
              const scores = data.abilities || {};
              let value = scores[ability];
              if (value && typeof value === 'object') {
                value = value.score === undefined ? value.total : value.score;
              }
              if (value === undefined && data.abilityDetails && data.abilityDetails[ability]) {
                value = data.abilityDetails[ability].total;
              }
              if (value === undefined) {
                const pointBuy = data.pointBuy || null;
                const oldBase = pointBuy && pointBuy.baseScores
                  ? pointBuy.baseScores[ability]
                  : data.baseAbilityScores && data.baseAbilityScores[ability];
                if (oldBase !== undefined) {
                  value = Number(oldBase) + Number((data.backgroundBonuses || {})[ability] || 0);
                }
              }
              if (value === undefined) value = scores[ability.toUpperCase()];
              input.value = value === undefined || value === null
                ? 10
                : Math.max(1, Math.min(30, Number(value) || 1));
            });
            const fields = {
              cs_ac: 'armorClass', cs_initiative: 'initiative', cs_speed: 'speed',
              cs_features: 'features', cs_equipment: 'equipmentText'
            };
            Object.entries(fields).forEach(([id, key]) => {
              const legacyKey = { equipmentText: 'equipment' }[key];
              const value = data[key] === undefined && legacyKey ? data[legacyKey] : data[key];
              const defaultValue = { cs_ac: 10 }[id];
              document.getElementById(id).value = value === undefined || value === null
                ? (defaultValue === undefined ? '' : defaultValue)
                : value;
            });
            // Older characters got their starting equipment copied into the notes;
            // the item list shows it now, so drop that exact, untouched copy.
            const startingCopy = (Array.isArray(data.inventory) ? data.inventory : [])
              .map(item => (item.quantity > 1 ? item.name + ' ×' + item.quantity : item.name)).join('\\n');
            const notes = document.getElementById('cs_equipment');
            if (startingCopy && notes.value.trim().replace(/\\n\\d+ GP$/, '') === startingCopy) notes.value = '';
            document.getElementById('cs_initiative').value =
              data.initiative === undefined
                ? (Math.floor((Number(abilityContainer.querySelector('[data-ability="dex"]').value) - 10) / 2) >= 0
                  ? '+' : '') + Math.floor((Number(abilityContainer.querySelector('[data-ability="dex"]').value) - 10) / 2)
                : data.initiative;
            document.getElementById('cs_speed').value =
              data.speed === undefined ? '30 ft.' : data.speed;
            // Skip untouched placeholder rows ("+5", "1d8+3") saved by older versions.
            const attacks = (Array.isArray(data.attacks) ? data.attacks : []).filter(attack => attack &&
              !(!attack.name && !attack.notes && (!attack.bonus || attack.bonus === '+5') && (!attack.damage || attack.damage === '1d8+3')));
            attacks.forEach(addAttackRow);
            syncAttacksTable();
            updateAbilityValidation();
            updateDerivedStats(character.level);
            lockRuleOwnedFields(character, data);
            autosizeNotes();
            // Worn armor sets the Armor Class; the combat panel fills it in.
            if (window.refreshCharacterCombat) window.refreshCharacterCombat();
            message.textContent = '';
          } catch (error) {
            message.textContent = error.message;
            message.classList.add('is-error');
          }
        }

        async function saveSheet() {
          const button = document.getElementById('cs_save');
          button.disabled = true;
          message.classList.remove('is-error');
          message.textContent = 'Saving character sheet...';
          let currentScores;
          try {
            currentScores = getAbilityScores();
          } catch (error) {
            message.textContent = error.message;
            message.classList.add('is-error');
            button.disabled = false;
            return;
          }
          button.disabled = true;
          const sheetData = {
            abilities: currentScores,
            savingProficiencies: [...new Set([
              ...((sheetClassRules[classSelect.value] || {}).savingThrows || []),
              ...savedSaves
            ])],
            skillProficiencies: [...new Set([
              ...selectedClassSkills,
              ...selectedSpeciesSkills,
              ...savedSpeciesSkills,
              ...((sheetBackgrounds[backgroundSelect.value] || {}).skillProficiencies || []),
              ...((sheetSpecies[speciesSelect.value] || {}).skillProficiencies || [])
            ])],
            classSkillChoices: selectedClassSkills,
            speciesSkillChoices: selectedSpeciesSkills,
            background: backgroundSelect.value,
            armorClass: document.getElementById('cs_ac').value === ''
              ? null : Number(document.getElementById('cs_ac').value),
            initiative: document.getElementById('cs_initiative').value,
            speed: document.getElementById('cs_speed').value,
            attacks: [...document.querySelectorAll('#cs_attacks_tbody tr')].map(row =>
              Object.fromEntries([...row.querySelectorAll('[data-attack-field]')].map(input =>
                [input.dataset.attackField, input.value.trim()]
              ))
            ).filter(attack => Object.values(attack).some(Boolean)),
            features: document.getElementById('cs_features').value,
            equipmentText: document.getElementById('cs_equipment').value
          };
          try {
            const response = await fetch('/api/characters/' + fullSheetCharacterId + '/sheet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: document.getElementById('cs_name').value,
                species: document.getElementById('cs_species').value,
                character_class: classSelect.value,
                subclass: subclassSelect.value,
                background: backgroundSelect.value,
                sheetData
              })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not save character sheet.');
            // Ability changes (CON) can change max HP and hit point recovery.
            if (window.refreshCharacterVitals) window.refreshCharacterVitals();
            // Ability changes move Armor Class and attack bonuses.
            if (window.refreshCharacterCombat) window.refreshCharacterCombat();
            document.getElementById('cs_header_name').textContent =
              document.getElementById('cs_name').value;
            document.getElementById('cs_header_sub').textContent =
              'Level ' + sheetCharacterLevel + ' ' +
              document.getElementById('cs_species').value + ' ' + classSelect.value +
              (subclassSelect.value ? ' (' + subclassSelect.value + ')' : '');
            message.textContent = result.message || 'Character sheet saved.';
            message.classList.remove('is-error');
          } catch (error) {
            message.textContent = error.message;
            message.classList.add('is-error');
          } finally {
            updateAbilityValidation();
          }
        }

        document.getElementById('cs_save').addEventListener('click', saveSheet);
        loadSheet();
      }

      initFullCharacterSheet();
      const creatorView = document.getElementById('character-creator-view');
      const openCreatorButton = document.getElementById('open-character-creator');
      const closeCreatorButton = document.getElementById('close-character-creator');
      if (creatorView && openCreatorButton && closeCreatorButton) {
        openCreatorButton.addEventListener('click', () => {
          creatorView.hidden = false;
          creatorView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        closeCreatorButton.addEventListener('click', () => {
          creatorView.hidden = true;
          openCreatorButton.focus();
        });
      }
    </script>
  `;
  return contentHtml;
};
