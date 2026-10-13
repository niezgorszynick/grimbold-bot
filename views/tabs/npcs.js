// views/tabs/npcs.js — "Notable NPCs" tab: Kevah, Arleta and the rest. Everyone
// reads the lore (affiliation, description, sheet link, adventures); DMs also
// see stats and notes, and add or edit NPCs here.

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const STATUS_TAGS = { alive: '', dead: '<span class="tag red">Dead</span>', unknown: '<span class="tag">Whereabouts unknown</span>' };
const signed = n => (n >= 0 ? `+${n}` : String(n));

function hasStats(stats) {
  return stats.armorClass !== null || stats.hpMax !== null || Boolean(stats.speed) || Object.keys(stats.abilities).length > 0;
}

function statsHtml(stats) {
  const hp = Number.isInteger(stats.hpMax)
    ? `${stats.hpCurrent ?? stats.hpMax} / ${stats.hpMax}${stats.hpTemp ? ` (+${stats.hpTemp} temp)` : ''}`
    : '—';
  const abilities = ABILITIES.filter(ability => stats.abilities[ability]);
  return `
    <div class="npc-stats">
      <span><small>AC</small><strong>${stats.armorClass ?? '—'}</strong></span>
      <span><small>HP</small><strong>${hp}</strong></span>
      ${stats.speed ? `<span><small>Speed</small><strong>${escapeHtml(stats.speed)}</strong></span>` : ''}
    </div>
    ${abilities.length ? `<div class="npc-abilities">${abilities.map(ability => `<span><small>${ability.toUpperCase()}</small> ${stats.abilities[ability].score} (${signed(stats.abilities[ability].modifier)})</span>`).join('')}</div>` : ''}`;
}

function npcCard(npc, isAdmin) {
  return `
    <article class="card npc-card" id="npc-${npc.id}" data-search="${escapeHtml(`${npc.name} ${npc.affiliation}`.toLowerCase())}">
      <header class="npc-card-header">
        <div>
          <h3>${escapeHtml(npc.name)} ${STATUS_TAGS[npc.status] || ''}</h3>
          ${npc.affiliation ? `<div class="muted small">${escapeHtml(npc.affiliation)}</div>` : ''}
        </div>
        ${isAdmin ? `<a class="btn btn-small" href="/admin?tab=npcs&edit_npc=${npc.id}">Edit</a>` : ''}
      </header>
      ${npc.description ? `<p class="npc-description">${escapeHtml(npc.description)}</p>` : ''}
      ${npc.sheetUrl ? `<p><a href="${escapeHtml(npc.sheetUrl)}" target="_blank" rel="noopener">Sheet ↗</a></p>` : ''}
      ${isAdmin && npc.stats && hasStats(npc.stats) ? statsHtml(npc.stats) : ''}
      ${isAdmin && npc.dmNotes ? `<details class="npc-dm-notes"><summary>DM notes</summary><p>${escapeHtml(npc.dmNotes)}</p></details>` : ''}
      <div class="npc-adventures">
        <small class="muted">Appeared in:</small>
        ${npc.adventures.length
          ? npc.adventures.map(adventure => `<a class="tag" href="/admin?tab=adventures&table=${adventure.id}">${escapeHtml(adventure.title)}</a>`).join(' ')
          : '<span class="muted small">no adventures yet</span>'}
      </div>
    </article>`;
}

function npcForm(npc, adventures) {
  const value = (key, fallback = '') => escapeHtml(npc && npc[key] !== undefined && npc[key] !== null ? npc[key] : fallback);
  const stats = (npc && npc.stats) || { abilities: {} };
  const stat = key => (stats[key] === null || stats[key] === undefined ? '' : stats[key]);
  const appeared = new Set(((npc && npc.adventures) || []).map(adventure => adventure.id));
  return `
    <section class="card npc-form-card">
      <h3>${npc ? `Edit ${escapeHtml(npc.name)}` : 'New NPC'}</h3>
      <form method="POST" action="/admin/npcs/save" class="npc-form">
        ${npc ? `<input type="hidden" name="id" value="${npc.id}">` : ''}
        <div class="npc-form-grid">
          <label>Name<input name="name" required maxlength="100" value="${value('name')}"></label>
          <label>Affiliation<input name="affiliation" maxlength="100" placeholder="e.g. Harpers, the Iron Guild" value="${value('affiliation')}"></label>
          <label>Status<select name="status">
            ${['alive', 'dead', 'unknown'].map(status => `<option value="${status}" ${npc && npc.status === status ? 'selected' : ''}>${{ alive: 'Alive', dead: 'Dead', unknown: 'Unknown' }[status]}</option>`).join('')}
          </select></label>
          <label>Sheet link<input name="sheet_url" type="url" maxlength="500" placeholder="https://…" value="${value('sheetUrl')}"></label>
        </div>
        <label>Description (everyone sees this)<textarea name="description" rows="4" maxlength="5000">${value('description')}</textarea></label>
        <h4>Stats (DMs only)</h4>
        <div class="npc-form-grid">
          <label>AC<input name="armor_class" type="number" min="0" max="40" value="${stat('armorClass')}"></label>
          <label>Max HP<input name="hp_max" type="number" min="1" max="5000" value="${stat('hpMax')}"></label>
          <label>Current HP<input name="hp_current" type="number" min="0" max="5000" value="${stat('hpCurrent')}" placeholder="= max"></label>
          <label>Speed<input name="speed" maxlength="60" placeholder="30 ft." value="${escapeHtml(stats.speed || '')}"></label>
        </div>
        <div class="npc-form-grid npc-form-abilities">
          ${ABILITIES.map(ability => `<label>${ability.toUpperCase()}<input name="${ability}" type="number" min="1" max="30" value="${stats.abilities[ability] ? stats.abilities[ability].score : ''}"></label>`).join('')}
        </div>
        <label>DM notes (DMs only)<textarea name="dm_notes" rows="3" maxlength="5000">${npc && npc.dmNotes ? escapeHtml(npc.dmNotes) : ''}</textarea></label>
        <details class="npc-form-adventures" ${appeared.size ? 'open' : ''}>
          <summary>Adventures they appeared in (${appeared.size})</summary>
          <div class="npc-adventure-list">
            ${adventures.map(adventure => `<label class="creator-check"><input type="checkbox" name="adventure_ids" value="${adventure.id}" ${appeared.has(adventure.id) ? 'checked' : ''}> ${escapeHtml(adventure.title)}</label>`).join('') || '<span class="muted small">No adventures yet.</span>'}
          </div>
        </details>
        <div class="vitals-actions">
          <button type="submit" class="btn btn-green">${npc ? 'Save NPC' : 'Add NPC'}</button>
          <a class="btn btn-secondary" href="/admin?tab=npcs">Cancel</a>
        </div>
      </form>
      ${npc ? `
        <form method="POST" action="/admin/npcs/delete" data-name="${escapeHtml(npc.name)}" onsubmit="return confirm('Delete ' + this.dataset.name + ' for good? Their adventure history goes too.');" class="npc-delete">
          <input type="hidden" name="id" value="${npc.id}">
          <button type="submit" class="btn btn-small btn-red">Delete NPC</button>
        </form>` : ''}
    </section>`;
}

module.exports = function renderNpcsTab(ctx) {
  const { req, isAdmin, status } = ctx;
  const npcs = db.listNpcs({ showStats: isAdmin });
  const editing = isAdmin && req.query.edit_npc ? db.getNpc(req.query.edit_npc, { showStats: true }) : null;
  const creating = isAdmin && req.query.new_npc && !editing;
  const adventures = isAdmin && (editing || creating) ? db.prepare("SELECT id, title FROM adventures WHERE status != 'cancelled' ORDER BY id DESC").all() : [];
  const banner = status === 'npc_saved' ? '<div class="alert green">✅ NPC saved.</div>'
    : status === 'npc_deleted' ? '<div class="alert green">✅ NPC deleted.</div>' : '';
  return `
    ${banner}
    <section class="card">
      <div class="sheet-section-heading">
        <h3>Notable NPCs</h3>
        ${isAdmin && !editing && !creating ? '<a class="btn btn-green btn-small" href="/admin?tab=npcs&new_npc=1">+ Add NPC</a>' : ''}
      </div>
      <p class="muted small">The people the party keeps running into: who they are, who they answer to, and where they turned up.${isAdmin ? ' Stats and DM notes are visible to DMs only; add an NPC to a running adventure from its table.' : ''}</p>
      ${npcs.length > 4 ? '<input type="search" id="npc-search" placeholder="Search by name or affiliation…" aria-label="Search NPCs">' : ''}
    </section>
    ${editing || creating ? npcForm(editing, adventures) : ''}
    ${npcs.length
      ? `<section class="npc-grid">${npcs.map(npc => npcCard(npc, isAdmin)).join('')}</section>`
      : '<section class="card"><p class="muted">No NPCs yet.</p></section>'}
    <script>
      (() => {
        const search = document.getElementById('npc-search');
        if (!search) return;
        search.addEventListener('input', () => {
          const query = search.value.trim().toLowerCase();
          document.querySelectorAll('.npc-card').forEach(card => { card.hidden = Boolean(query) && !card.dataset.search.includes(query); });
        });
      })();
    </script>`;
};
