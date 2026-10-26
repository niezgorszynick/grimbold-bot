// views/tabs/monsters.js — "Monsters" tab (DMs only): the Monster Manual
// statblocks from rules/content/monsters.md and those imported from 5etools
// files (db/monsterImports.js), filtered by name, book, creature type, CR and
// habitat. Picking one shows its statblock above the list; a DM can start a
// Notable NPC from it. The import card sends a file's creatures in batches.

'use strict';

const db = require('../../db');
const rules = require('../../rules');
const { escapeHtml } = require('../helpers');
const { renderStatblock } = require('../statblock');

const thousands = n => Number(n).toLocaleString('en-US');
const monsterHref = name => `/admin?tab=monsters&monster=${encodeURIComponent(name)}`;

// The statblock with what a DM does next. Also sent on its own by
// GET /admin/monsters/statblock when a row is picked.
function monsterPanel(monster) {
  const npcs = db.listNpcsBasedOn(monster.name);
  return `
    <div class="monster-panel-actions">
      <a class="btn btn-small btn-green" href="/admin?tab=npcs&new_npc=1&base_monster=${encodeURIComponent(monster.name)}">+ New NPC from this statblock</a>
      ${npcs.length ? `<span class="muted small">NPCs based on it: ${npcs.map(npc => `<a href="/admin?tab=npcs#npc-${npc.id}">${escapeHtml(npc.name)}</a>`).join(', ')}</span>` : ''}
      <button type="button" class="btn btn-small btn-secondary" data-close-monster>Close</button>
    </div>
    ${renderStatblock(monster)}`;
}

function monsterRow(monster) {
  const habitats = monster.habitat.split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
  return `
    <tr data-name="${escapeHtml(monster.name.toLowerCase())}" data-type="${escapeHtml(monster.type)}" data-cr="${monster.summon ? -1 : monster.cr}" data-habitats="|${escapeHtml(habitats.join('|'))}|" data-source="${escapeHtml(monster.sourceName)}">
      <td><a href="${monsterHref(monster.name)}" data-monster-link="${escapeHtml(monster.name)}">${escapeHtml(monster.name)}</a></td>
      <td data-sort="${monster.summon ? -1 : monster.cr}">${escapeHtml(monster.crText)}</td>
      <td data-sort="${monster.xp}">${monster.summon ? '—' : thousands(monster.xp)}</td>
      <td>${escapeHtml(monster.typeText)}</td>
      <td>${escapeHtml(monster.size)}</td>
      <td data-sort="${monster.armorClass ?? -1}">${monster.armorClass ?? '—'}</td>
      <td data-sort="${monster.hitPoints ?? -1}">${monster.hitPoints ?? '—'}</td>
      <td class="small">${escapeHtml(monster.habitat)}</td>
      <td class="small" title="${escapeHtml(monster.sourceName)}">${escapeHtml(monster.sourceCode || monster.sourceName)}</td>
    </tr>`;
}

// Imported 5etools files, and the form to import one. The browser reads the
// file and sends its creatures in batches under the panel's request limit.
function renderImports(imports) {
  return `
    <section class="card monster-imports">
      <h3>Import from 5etools</h3>
      <p class="muted small">A 5etools JSON file: a book's bestiary or a homebrew collection (creatures in a <code>"monster"</code> list). Its creatures join this list, encounters and NPC statblocks. They are kept on this server only; book text never goes into Git.</p>
      <div class="table-filter">
        <input type="file" id="monster-import-file" accept=".json,application/json" aria-label="5etools JSON file">
        <input type="text" id="monster-import-label" maxlength="100" placeholder="Name it, e.g. Monsters of the Multiverse" aria-label="Import name">
        <button type="button" class="btn btn-small btn-green" id="monster-import-start">Import</button>
      </div>
      <p class="sheet-message" id="monster-import-status" role="status"></p>
      ${imports.length ? `<table class="monster-import-list">
        <thead><tr><th>Import</th><th>Creatures</th><th>Skipped</th><th>By</th><th></th></tr></thead>
        <tbody>${imports.map(entry => `<tr>
          <td><strong>${escapeHtml(entry.label)}</strong><div class="muted small">${escapeHtml(entry.fileName)}${entry.sources.length ? ` · ${escapeHtml(entry.sources.join(', '))}` : ''}</div></td>
          <td>${entry.monsters}</td>
          <td>${entry.skipped.length ? `<details><summary>${entry.skipped.length}</summary><ul class="small">${entry.skipped.slice(0, 50).map(skip => `<li>${escapeHtml(skip.name)}: ${escapeHtml(skip.reason)}</li>`).join('')}</ul></details>` : '0'}</td>
          <td class="small">${escapeHtml(entry.uploadedBy || '—')}<div class="muted">${escapeHtml(String(entry.createdAt || '').slice(0, 10))}</div></td>
          <td><button type="button" class="btn btn-small btn-red monster-import-remove" data-id="${entry.id}" data-label="${escapeHtml(entry.label)}">Remove</button></td>
        </tr>`).join('')}</tbody>
      </table>` : ''}
    </section>
    <script>
      (() => {
        const file = document.getElementById('monster-import-file');
        const label = document.getElementById('monster-import-label');
        const start = document.getElementById('monster-import-start');
        const status = document.getElementById('monster-import-status');
        const say = (text, isError) => { status.textContent = text; status.classList.toggle('is-error', Boolean(isError)); };
        const post = async (url, body) => {
          const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'The panel refused it (error ' + response.status + ').');
          return result;
        };
        file.addEventListener('change', () => {
          if (file.files[0] && !label.value) label.value = file.files[0].name.replace(/\\.json$/i, '');
        });
        start.addEventListener('click', async () => {
          const chosen = file.files[0];
          if (!chosen) { say('Choose a 5etools JSON file first.', true); return; }
          let data;
          try {
            data = JSON.parse(await chosen.text());
          } catch (error) {
            say('That is not a JSON file: ' + error.message, true);
            return;
          }
          const monsters = Array.isArray(data.monster) ? data.monster : [];
          if (!monsters.length) { say('No creatures in that file: 5etools keeps them in a "monster" list.', true); return; }
          start.disabled = true;
          try {
            const { importId } = await post('/api/monster-imports', { label: label.value, fileName: chosen.name, meta: data._meta || null });
            // Batches well under the panel's 100 KB request limit.
            let batch = [];
            let size = 0;
            let sent = 0;
            const flush = async () => {
              if (!batch.length) return;
              await post('/api/monster-imports/' + importId + '/monsters', { monsters: batch });
              sent += batch.length;
              say('Sending creatures… ' + sent + ' / ' + monsters.length);
              batch = [];
              size = 0;
            };
            for (const monster of monsters) {
              const length = JSON.stringify(monster).length;
              if (length > 90000) continue;
              if (size + length > 80000 || batch.length >= 400) await flush();
              batch.push(monster);
              size += length;
            }
            await flush();
            say('Reading the statblocks…');
            const report = await post('/api/monster-imports/' + importId + '/finish', {});
            say('Imported ' + report.imported + ' creatures' + (report.skipped.length ? ' (' + report.skipped.length + ' skipped; see the list)' : '') + '. Reloading…');
            setTimeout(() => window.location.reload(), 1200);
          } catch (error) {
            say(error.message, true);
            start.disabled = false;
          }
        });
        document.querySelectorAll('.monster-import-remove').forEach(button => button.addEventListener('click', async () => {
          if (!window.confirm('Remove "' + button.dataset.label + '" and its creatures? Encounters that use them keep their HP but lose the statblock.')) return;
          try {
            await post('/api/monster-imports/' + button.dataset.id + '/delete', {});
            window.location.reload();
          } catch (error) {
            say(error.message, true);
          }
        }));
      })();
    </script>`;
}

module.exports = function renderMonstersTab(ctx) {
  const { req, isAdmin } = ctx;
  if (!isAdmin) return '<section class="card"><p class="muted">Monsters are for DMs.</p></section>';
  const monsters = rules.listMonsters();
  const importCard = renderImports(db.listMonsterImports());
  if (!monsters.length) {
    return `<section class="card"><h3>Monsters</h3><p class="muted">No monster statblocks on this server yet. Copy <code>rules/content/monsters.md</code> here (it stays out of Git, like <code>beasts.md</code>) and restart the panel, or import a 5etools file below.</p></section>${importCard}`;
  }
  const sources = [...new Set(monsters.map(monster => monster.sourceName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const chosen = req.query.monster ? rules.getMonster(req.query.monster) : null;
  const types = rules.CREATURE_TYPES.filter(type => monsters.some(monster => monster.type === type));
  const crs = [...new Map(monsters.filter(monster => !monster.summon).map(monster => [monster.cr, monster.crText])).entries()].sort((a, b) => a[0] - b[0]);
  const habitats = [...new Set(monsters.flatMap(monster => monster.habitat.split(',').map(part => part.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
  const crOptions = selected => crs.map(([cr, text]) => `<option value="${cr}" ${cr === selected ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('');
  return `
    <section class="card">
      <h3>Monsters</h3>
      <p class="muted small">${monsters.length} statblocks from ${sources.length === 1 ? escapeHtml(sources[0]) : `${sources.length} books`}. Only DMs see this tab. Pick a monster to read its statblock, or start a Notable NPC from it.</p>
      <div class="monster-filters">
        <input type="search" id="monster-search" placeholder="Search by name…" aria-label="Search monsters by name">
        <select id="monster-type" aria-label="Creature type"><option value="">Any type</option>${types.map(type => `<option>${escapeHtml(type)}</option>`).join('')}</select>
        <label class="small">CR <select id="monster-cr-min" aria-label="Lowest CR"><option value="">any</option>${crOptions(null)}</select></label>
        <label class="small">to <select id="monster-cr-max" aria-label="Highest CR"><option value="">any</option>${crOptions(null)}</select></label>
        <select id="monster-habitat" aria-label="Habitat"><option value="">Any habitat</option>${habitats.map(habitat => `<option value="${escapeHtml(habitat.toLowerCase())}">${escapeHtml(habitat)}</option>`).join('')}</select>
        <label class="small"><input type="checkbox" id="monster-summons"> summons</label>
        <span class="muted small" id="monster-count" role="status"></span>
      </div>
      ${sources.length > 1 ? `
      <details class="monster-books" id="monster-books" open>
        <summary><strong>Books</strong> <span class="muted small" id="monster-books-summary"></span></summary>
        <div class="monster-books-actions">
          <button type="button" class="btn btn-small btn-secondary" data-books="all">All</button>
          <button type="button" class="btn btn-small btn-secondary" data-books="clear">Clear</button>
          <span class="muted small">Click books to show only those; none chosen shows every book.</span>
        </div>
        <div class="monster-book-chips">
          ${sources.map(source => {
            const inBook = monsters.filter(monster => monster.sourceName === source);
            const code = inBook[0].sourceCode;
            return `<button type="button" class="monster-book-chip" data-source="${escapeHtml(source)}" aria-pressed="false" title="${escapeHtml(code && code !== source ? `${source} (${code})` : source)}">${escapeHtml(source)} <span class="monster-book-count">${inBook.length}</span></button>`;
          }).join('')}
        </div>
      </details>` : ''}
    </section>
    <section class="card monster-view" id="monster-view" ${chosen ? '' : 'hidden'}>${chosen ? monsterPanel(chosen) : ''}</section>
    ${req.query.monster && !chosen ? `<div class="alert red">There is no monster called “${escapeHtml(req.query.monster)}”.</div>` : ''}
    <section class="card analytics-table-wrap">
      <table class="monster-table" id="monster-table">
        <thead><tr>
          <th class="sortable">Name</th><th class="sortable">CR</th><th class="sortable">XP</th><th class="sortable">Type</th>
          <th class="sortable">Size</th><th class="sortable">AC</th><th class="sortable">HP</th><th class="sortable">Habitat</th><th class="sortable">Book</th>
        </tr></thead>
        <tbody>${monsters.map(monsterRow).join('')}</tbody>
      </table>
    </section>
    <script>
      (() => {
        const table = document.getElementById('monster-table');
        const view = document.getElementById('monster-view');
        const controls = ['monster-search', 'monster-type', 'monster-cr-min', 'monster-cr-max', 'monster-habitat', 'monster-summons'].map(id => document.getElementById(id));
        const [search, type, crMin, crMax, habitat, summons] = controls;
        const count = document.getElementById('monster-count');
        const KEY = 'grimbold-monster-filters';
        // Book chips (like 5etools): the chosen books, or every book when none is chosen.
        const chips = [...document.querySelectorAll('.monster-book-chip')];
        const books = new Set();
        const booksSummary = document.getElementById('monster-books-summary');
        try {
          const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
          controls.forEach(control => { if (Object.hasOwn(saved, control.id)) control[control.type === 'checkbox' ? 'checked' : 'value'] = saved[control.id]; });
          (Array.isArray(saved.books) ? saved.books : []).forEach(book => { if (chips.some(chip => chip.dataset.source === book)) books.add(book); });
          const panel = document.getElementById('monster-books');
          if (panel && saved.booksOpen === false) panel.open = false;
        } catch (error) { /* filters start empty */ }
        const showChips = () => {
          chips.forEach(chip => chip.setAttribute('aria-pressed', String(books.has(chip.dataset.source))));
          if (booksSummary) booksSummary.textContent = books.size ? books.size + ' of ' + chips.length + ' chosen' : 'all ' + chips.length + ' books';
        };
        const filter = () => {
          const query = search.value.trim().toLowerCase();
          const low = crMin.value === '' ? -Infinity : Number(crMin.value);
          const high = crMax.value === '' ? Infinity : Number(crMax.value);
          let shown = 0;
          table.querySelectorAll('tbody tr').forEach(row => {
            const cr = Number(row.dataset.cr);
            const visible = (!query || row.dataset.name.includes(query))
              && (!type.value || row.dataset.type === type.value)
              && (cr < 0 ? summons.checked && crMin.value === '' && crMax.value === '' : cr >= low && cr <= high)
              && (!habitat.value || row.dataset.habitats.includes('|' + habitat.value + '|'))
              && (!books.size || books.has(row.dataset.source));
            row.hidden = !visible;
            if (visible) shown += 1;
          });
          count.textContent = shown + ' shown';
          showChips();
          const panel = document.getElementById('monster-books');
          try {
            localStorage.setItem(KEY, JSON.stringify({
              ...Object.fromEntries(controls.map(control => [control.id, control.type === 'checkbox' ? control.checked : control.value])),
              books: [...books],
              booksOpen: panel ? panel.open : true
            }));
          } catch (error) { /* not remembered */ }
        };
        controls.forEach(control => control.addEventListener(control.type === 'search' ? 'input' : 'change', filter));
        chips.forEach(chip => chip.addEventListener('click', () => {
          if (books.has(chip.dataset.source)) books.delete(chip.dataset.source); else books.add(chip.dataset.source);
          filter();
        }));
        document.querySelectorAll('[data-books]').forEach(button => button.addEventListener('click', () => {
          books.clear();
          if (button.dataset.books === 'all') chips.forEach(chip => books.add(chip.dataset.source));
          filter();
        }));
        const booksPanel = document.getElementById('monster-books');
        if (booksPanel) booksPanel.addEventListener('toggle', filter);
        table.refreshFilter = filter;
        filter();

        const show = async name => {
          try {
            const response = await fetch('/admin/monsters/statblock?name=' + encodeURIComponent(name));
            if (!response.ok) throw new Error('Could not load ' + name + '.');
            view.innerHTML = await response.text();
          } catch (error) {
            view.innerHTML = '<p class="alert red"></p>';
            view.firstChild.textContent = error.message;
          }
          view.hidden = false;
          history.replaceState(null, '', '/admin?tab=monsters&monster=' + encodeURIComponent(name));
          view.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        table.addEventListener('click', event => {
          const link = event.target.closest('[data-monster-link]');
          if (!link || event.ctrlKey || event.metaKey || event.shiftKey) return;
          event.preventDefault();
          show(link.dataset.monsterLink);
        });
        view.addEventListener('click', event => {
          if (!event.target.closest('[data-close-monster]')) return;
          view.hidden = true;
          view.replaceChildren();
          history.replaceState(null, '', '/admin?tab=monsters');
        });
      })();
    </script>
    ${importCard}`;
};

module.exports.monsterPanel = monsterPanel;
