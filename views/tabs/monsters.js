// views/tabs/monsters.js — "Monsters" tab (DMs only): the Monster Manual
// statblocks from rules/content/monsters.md, filtered by name, creature type,
// CR and habitat. Picking one shows its statblock above the list; a DM can
// start a Notable NPC from it.

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
    <tr data-name="${escapeHtml(monster.name.toLowerCase())}" data-type="${escapeHtml(monster.type)}" data-cr="${monster.summon ? -1 : monster.cr}" data-habitats="|${escapeHtml(habitats.join('|'))}|">
      <td><a href="${monsterHref(monster.name)}" data-monster-link="${escapeHtml(monster.name)}">${escapeHtml(monster.name)}</a></td>
      <td data-sort="${monster.summon ? -1 : monster.cr}">${escapeHtml(monster.crText)}</td>
      <td data-sort="${monster.xp}">${monster.summon ? '—' : thousands(monster.xp)}</td>
      <td>${escapeHtml(monster.typeText)}</td>
      <td>${escapeHtml(monster.size)}</td>
      <td data-sort="${monster.armorClass ?? -1}">${monster.armorClass ?? '—'}</td>
      <td data-sort="${monster.hitPoints ?? -1}">${monster.hitPoints ?? '—'}</td>
      <td class="small">${escapeHtml(monster.habitat)}</td>
    </tr>`;
}

module.exports = function renderMonstersTab(ctx) {
  const { req, isAdmin } = ctx;
  if (!isAdmin) return '<section class="card"><p class="muted">Monsters are for DMs.</p></section>';
  const monsters = rules.listMonsters();
  if (!monsters.length) {
    return `<section class="card"><h3>Monsters</h3><p class="muted">No monster statblocks on this server yet. Copy <code>rules/content/monsters.md</code> here (it stays out of Git, like <code>beasts.md</code>) and restart the panel.</p></section>`;
  }
  const chosen = req.query.monster ? rules.getMonster(req.query.monster) : null;
  const types = rules.CREATURE_TYPES.filter(type => monsters.some(monster => monster.type === type));
  const crs = [...new Map(monsters.filter(monster => !monster.summon).map(monster => [monster.cr, monster.crText])).entries()].sort((a, b) => a[0] - b[0]);
  const habitats = [...new Set(monsters.flatMap(monster => monster.habitat.split(',').map(part => part.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b));
  const crOptions = selected => crs.map(([cr, text]) => `<option value="${cr}" ${cr === selected ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('');
  return `
    <section class="card">
      <h3>Monsters</h3>
      <p class="muted small">${monsters.length} statblocks from the Monster Manual. Only DMs see this tab. Pick a monster to read its statblock, or start a Notable NPC from it.</p>
      <div class="monster-filters">
        <input type="search" id="monster-search" placeholder="Search by name…" aria-label="Search monsters by name">
        <select id="monster-type" aria-label="Creature type"><option value="">Any type</option>${types.map(type => `<option>${escapeHtml(type)}</option>`).join('')}</select>
        <label class="small">CR <select id="monster-cr-min" aria-label="Lowest CR"><option value="">any</option>${crOptions(null)}</select></label>
        <label class="small">to <select id="monster-cr-max" aria-label="Highest CR"><option value="">any</option>${crOptions(null)}</select></label>
        <select id="monster-habitat" aria-label="Habitat"><option value="">Any habitat</option>${habitats.map(habitat => `<option value="${escapeHtml(habitat.toLowerCase())}">${escapeHtml(habitat)}</option>`).join('')}</select>
        <label class="small"><input type="checkbox" id="monster-summons"> summons</label>
        <span class="muted small" id="monster-count" role="status"></span>
      </div>
    </section>
    <section class="card monster-view" id="monster-view" ${chosen ? '' : 'hidden'}>${chosen ? monsterPanel(chosen) : ''}</section>
    ${req.query.monster && !chosen ? `<div class="alert red">There is no monster called “${escapeHtml(req.query.monster)}”.</div>` : ''}
    <section class="card analytics-table-wrap">
      <table class="monster-table" id="monster-table">
        <thead><tr>
          <th class="sortable">Name</th><th class="sortable">CR</th><th class="sortable">XP</th><th class="sortable">Type</th>
          <th class="sortable">Size</th><th class="sortable">AC</th><th class="sortable">HP</th><th class="sortable">Habitat</th>
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
        try {
          const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
          controls.forEach(control => { if (Object.hasOwn(saved, control.id)) control[control.type === 'checkbox' ? 'checked' : 'value'] = saved[control.id]; });
        } catch (error) { /* filters start empty */ }
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
              && (!habitat.value || row.dataset.habitats.includes('|' + habitat.value + '|'));
            row.hidden = !visible;
            if (visible) shown += 1;
          });
          count.textContent = shown + ' shown';
          try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(controls.map(control => [control.id, control.type === 'checkbox' ? control.checked : control.value])))); } catch (error) { /* not remembered */ }
        };
        controls.forEach(control => control.addEventListener(control.type === 'search' ? 'input' : 'change', filter));
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
    </script>`;
};

module.exports.monsterPanel = monsterPanel;
