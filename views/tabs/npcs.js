// views/tabs/npcs.js — "Notable NPCs" tab: Kevah, Arleta and the rest. Players
// see who they are (name, role, portrait, adventures); DMs also see the lore,
// personality, status, stats, notes, and which DM looks after each
// NPC and whether they have plans for them. DMs add and edit NPCs here.

'use strict';

const db = require('../../db');
const rules = require('../../rules');
const { escapeHtml } = require('../helpers');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const STATUS_TAGS = { alive: '', dead: '<span class="tag red">Dead</span>', unknown: '<span class="tag">Whereabouts unknown</span>' };
const PLAN_LABELS = { '': 'Not said', reserved: '🔒 Reserved (ask me first)', free: 'Free to use (one-off)' };
const signed = n => (n >= 0 ? `+${n}` : String(n));

function hasStats(stats) {
  return Boolean(stats.baseMonster) || stats.armorClass !== null || stats.hpMax !== null || Boolean(stats.speed) || Object.keys(stats.abilities).length > 0;
}

function statsHtml(stats) {
  const hp = Number.isInteger(stats.hpMax)
    ? `${stats.hpCurrent ?? stats.hpMax} / ${stats.hpMax}${stats.hpTemp ? ` (+${stats.hpTemp} temp)` : ''}`
    : '—';
  const abilities = ABILITIES.filter(ability => stats.abilities[ability]);
  const base = stats.baseMonster;
  return `
    ${base ? `<div class="small">Statblock: ${base.found
      ? `<a href="/admin?tab=monsters&monster=${encodeURIComponent(base.name)}">${escapeHtml(base.name)}</a> <span class="muted">(CR ${escapeHtml(base.crText)})</span>`
      : `${escapeHtml(base.name)} <span class="muted">(not in the monster list on this server)</span>`}</div>` : ''}
    <div class="npc-stats">
      <span><small>AC</small><strong>${stats.armorClass ?? '—'}</strong></span>
      <span><small>HP</small><strong>${hp}</strong></span>
      ${stats.speed ? `<span><small>Speed</small><strong>${escapeHtml(stats.speed)}</strong></span>` : ''}
    </div>
    ${abilities.length ? `<div class="npc-abilities">${abilities.map(ability => `<span><small>${ability.toUpperCase()}</small> ${stats.abilities[ability].score} (${signed(stats.abilities[ability].modifier)})</span>`).join('')}</div>` : ''}`;
}

// Who looks after the NPC, and whether other DMs may use them freely.
function plansHtml(npc) {
  const owner = npc.owner ? `<span class="muted small">DM: ${escapeHtml(npc.owner.tag)}</span>` : '<span class="muted small">No owning DM</span>';
  const tag = npc.plans === 'reserved' ? '<span class="tag gold">🔒 Reserved</span>'
    : npc.plans === 'free' ? '<span class="tag green">Free to use</span>' : '';
  return `<div class="npc-plans">${tag} ${owner}${npc.plansNote ? `<p class="small">${escapeHtml(npc.plansNote)}</p>` : ''}</div>`;
}

function npcCard(npc, isAdmin) {
  return `
    <article class="card npc-card" id="npc-${npc.id}" data-search="${escapeHtml(`${npc.name} ${npc.affiliation}`.toLowerCase())}">
      <header class="npc-card-header">
        ${npc.portraitUrl ? `<img class="npc-portrait" src="${escapeHtml(npc.portraitUrl)}" alt="" loading="lazy">` : ''}
        <div class="npc-card-title">
          <h3>${escapeHtml(npc.name)} ${isAdmin ? STATUS_TAGS[npc.status] || '' : ''}</h3>
          ${npc.affiliation ? `<div class="muted small">${escapeHtml(npc.affiliation)}</div>` : ''}
        </div>
        ${isAdmin ? `<a class="btn btn-small" href="/admin?tab=npcs&edit_npc=${npc.id}">Edit</a>` : ''}
      </header>
      ${isAdmin ? plansHtml(npc) : ''}
      ${isAdmin && npc.personality ? `<p class="npc-personality"><strong>Personality:</strong> ${escapeHtml(npc.personality)}</p>` : ''}
      ${isAdmin && npc.description ? `<details class="npc-dm-notes"><summary>Lore</summary><p class="npc-description">${escapeHtml(npc.description)}</p></details>` : ''}
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

// Portrait upload (an existing NPC only: it needs its id).
function filesHtml(npc) {
  if (!npc) return '<p class="muted small">Save the NPC first, then add a portrait.</p>';
  const slot = (kind, title, hint, accept, current) => `
    <div class="npc-file" data-kind="${kind}">
      <strong>${title}</strong> <span class="muted small">${hint}</span>
      <div class="npc-file-current">${current}</div>
      <div class="vitals-actions">
        <input type="file" accept="${accept}" aria-label="${title} file">
        <button type="button" class="btn btn-small" data-upload>Upload</button>
        ${current ? '<button type="button" class="btn btn-small btn-secondary" data-remove>Remove</button>' : ''}
      </div>
    </div>`;
  return `
    <div class="npc-files" data-npc-id="${npc.id}">
      ${slot('portrait', 'Portrait / token', '(players see it; PNG, JPG, WebP or GIF, up to 5 MB)', 'image/png,image/jpeg,image/webp,image/gif',
    npc.portraitUrl ? `<img class="npc-portrait" src="${escapeHtml(npc.portraitUrl)}" alt="Current portrait">` : '')}
      <p class="sheet-message" role="status" data-file-message></p>
    </div>
    <script>
      (() => {
        const root = document.querySelector('.npc-files');
        if (!root) return;
        const message = root.querySelector('[data-file-message]');
        const report = (text, isError) => { message.textContent = text; message.classList.toggle('is-error', Boolean(isError)); };
        root.querySelectorAll('.npc-file').forEach(slot => {
          const kind = slot.dataset.kind;
          const url = '/api/npcs/' + root.dataset.npcId + '/files/' + kind;
          const send = async (method, body) => {
            const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/octet-stream' } : {}, body });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || (response.status === 413 ? 'The server refused a file this size. Try a smaller image (under 1 MB), or ask the admin to raise the upload limit.' : 'Upload failed (error ' + response.status + ').'));
            window.location.reload();
          };
          slot.querySelector('[data-upload]').addEventListener('click', async () => {
            const file = slot.querySelector('input[type=file]').files[0];
            if (!file) return report('Choose a file first.', true);
            if (file.size > ${db.NPC_FILE_MAX_BYTES}) return report('Files can be 5 MB at most.', true);
            report('Uploading…');
            try { await send('POST', file); } catch (error) { report(error.message, true); }
          });
          const remove = slot.querySelector('[data-remove]');
          if (remove) remove.addEventListener('click', async () => {
            if (!confirm('Remove this file?')) return;
            try { await send('DELETE'); } catch (error) { report(error.message, true); }
          });
        });
      })();
    </script>`;
}

// The adventures an NPC appeared in: chips to remove, a dropdown (newest first,
// type to jump) to add. Each chip carries a hidden adventure_ids input.
function adventurePicker(adventures, appeared) {
  const chip = adventure => `<span class="tag npc-chip" data-id="${adventure.id}">${escapeHtml(adventure.title)}<input type="hidden" name="adventure_ids" value="${adventure.id}"><button type="button" class="npc-chip-remove" aria-label="Remove ${escapeHtml(adventure.title)}">×</button></span>`;
  return `
    <div class="npc-adventure-picker">
      <span class="npc-picker-label">Adventures they appeared in</span>
      <div class="npc-chips">${adventures.filter(adventure => appeared.has(adventure.id)).map(chip).join('') || '<span class="muted small npc-chips-empty">None yet.</span>'}</div>
      ${adventures.length ? `<select class="npc-add-adventure" aria-label="Add an adventure">
        <option value="">+ Add an adventure…</option>
        ${adventures.map(adventure => `<option value="${adventure.id}" ${appeared.has(adventure.id) ? 'hidden disabled' : ''}>${escapeHtml(adventure.title)}</option>`).join('')}
      </select>` : '<span class="muted small">No adventures yet.</span>'}
    </div>
    <script>
      (() => {
        const picker = document.querySelector('.npc-adventure-picker');
        const select = picker && picker.querySelector('.npc-add-adventure');
        if (!select) return;
        const chips = picker.querySelector('.npc-chips');
        const option = id => select.querySelector('option[value="' + id + '"]');
        const removeChip = chipNode => {
          const entry = option(chipNode.dataset.id);
          if (entry) { entry.hidden = false; entry.disabled = false; }
          chipNode.remove();
        };
        chips.addEventListener('click', event => {
          const button = event.target.closest('.npc-chip-remove');
          if (button) removeChip(button.closest('.npc-chip'));
        });
        select.addEventListener('change', () => {
          const entry = option(select.value);
          if (!entry) return;
          const empty = chips.querySelector('.npc-chips-empty');
          if (empty) empty.remove();
          const chipNode = document.createElement('span');
          chipNode.className = 'tag npc-chip';
          chipNode.dataset.id = entry.value;
          const hidden = document.createElement('input');
          Object.assign(hidden, { type: 'hidden', name: 'adventure_ids', value: entry.value });
          const remove = document.createElement('button');
          Object.assign(remove, { type: 'button', className: 'npc-chip-remove', textContent: '×' });
          remove.setAttribute('aria-label', 'Remove ' + entry.textContent);
          chipNode.append(entry.textContent, hidden, remove);
          chips.append(chipNode);
          entry.hidden = true;
          entry.disabled = true;
          select.value = '';
        });
      })();
    </script>`;
}

// A new NPC started from a statblock (Monsters tab): its stats filled in.
function statsFromMonster(monster) {
  return {
    baseMonster: { name: monster.name },
    armorClass: monster.armorClass,
    hpMax: monster.hitPoints,
    hpCurrent: null,
    speed: monster.speed.slice(0, 60),
    abilities: Object.fromEntries(Object.entries(monster.abilities).map(([ability, score]) => [ability, { score }]))
  };
}

function npcForm(npc, adventures, owners, currentUserId, startMonster) {
  const value = (key, fallback = '') => escapeHtml(npc && npc[key] !== undefined && npc[key] !== null ? npc[key] : fallback);
  const stats = (npc && npc.stats) || (startMonster ? statsFromMonster(startMonster) : { abilities: {} });
  const monsters = rules.listMonsters();
  const stat = key => (stats[key] === null || stats[key] === undefined ? '' : stats[key]);
  const appeared = new Set(((npc && npc.adventures) || []).map(adventure => adventure.id));
  // A new NPC belongs to the DM adding it; an older one may have no owner yet.
  const ownerId = npc ? (npc.owner ? npc.owner.id : null) : currentUserId;
  return `
    <section class="card npc-form-card">
      <h3>${npc ? `Edit ${escapeHtml(npc.name)}` : 'New NPC'}</h3>
      <form method="POST" action="/admin/npcs/save" class="npc-form">
        ${npc ? `<input type="hidden" name="id" value="${npc.id}">` : ''}
        <h4>What players see</h4>
        <div class="npc-form-grid">
          <label>Name<input name="name" required maxlength="100" value="${value('name')}"></label>
          <label>Role / affiliation<input name="affiliation" maxlength="100" placeholder="e.g. Captain of the guard, Harpers" value="${value('affiliation')}"></label>
        </div>
        <p class="muted small">Players also see the portrait and the adventures the NPC appeared in.</p>
        <h4>DMs only</h4>
        <div class="npc-form-grid">
          <label>Status<select name="status">
            ${['alive', 'dead', 'unknown'].map(status => `<option value="${status}" ${npc && npc.status === status ? 'selected' : ''}>${{ alive: 'Alive', dead: 'Dead', unknown: 'Unknown' }[status]}</option>`).join('')}
          </select></label>
          <label>Owning DM<select name="owner_player_id">
            <option value="">— nobody —</option>
            ${owners.map(owner => `<option value="${owner.id}" ${owner.id === ownerId ? 'selected' : ''}>${escapeHtml(owner.tag)}</option>`).join('')}
          </select></label>
          <label>Plans<select name="plans">
            ${Object.entries(PLAN_LABELS).map(([plan, label]) => `<option value="${plan}" ${(npc ? npc.plans : '') === plan ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select></label>
        </div>
        <label>Plans note<input name="plans_note" maxlength="500" placeholder="e.g. Becomes the villain of the Ashfall arc, keep them alive" value="${value('plansNote')}"></label>
        <label>Personality (short)<textarea name="personality" rows="2" maxlength="1000" placeholder="Gruff, loyal to a fault, hates elves">${value('personality')}</textarea></label>
        <label>Lore<textarea name="description" rows="4" maxlength="5000">${value('description')}</textarea></label>
        <h4>Stats</h4>
        <label>Based on a statblock${monsters.length ? '' : ' <span class="muted small">(no monster list on this server)</span>'}
          <input name="base_monster" list="npc-monster-list" maxlength="100" placeholder="e.g. Mage, Bandit Captain (optional)" value="${escapeHtml(stats.baseMonster ? stats.baseMonster.name : '')}">
        </label>
        ${monsters.length ? `<datalist id="npc-monster-list">${monsters.filter(monster => !monster.summon).map(monster => `<option value="${escapeHtml(monster.name)}">CR ${escapeHtml(monster.crText)} ${escapeHtml(monster.typeText)}</option>`).join('')}</datalist>` : ''}
        <p class="muted small">Stats you leave empty are taken from the statblock when you save. DMs see the full statblock from the NPC's card.</p>
        <div class="npc-form-grid">
          <label>AC<input name="armor_class" type="number" min="0" max="40" value="${stat('armorClass')}"></label>
          <label>Max HP<input name="hp_max" type="number" min="1" max="5000" value="${stat('hpMax')}"></label>
          <label>Current HP<input name="hp_current" type="number" min="0" max="5000" value="${stat('hpCurrent')}" placeholder="= max"></label>
          <label>Speed<input name="speed" maxlength="60" placeholder="30 ft." value="${escapeHtml(stats.speed || '')}"></label>
        </div>
        <div class="npc-form-grid npc-form-abilities">
          ${ABILITIES.map(ability => `<label>${ability.toUpperCase()}<input name="${ability}" type="number" min="1" max="30" value="${stats.abilities[ability] ? stats.abilities[ability].score : ''}"></label>`).join('')}
        </div>
        <label>DM notes<textarea name="dm_notes" rows="3" maxlength="5000">${npc && npc.dmNotes ? escapeHtml(npc.dmNotes) : ''}</textarea></label>
        ${adventurePicker(adventures, appeared)}
        <div class="vitals-actions">
          <button type="submit" class="btn btn-green">${npc ? 'Save NPC' : 'Add NPC'}</button>
          <a class="btn btn-secondary" href="/admin?tab=npcs">Cancel</a>
        </div>
      </form>
      ${filesHtml(npc)}
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
  const startMonster = creating && req.query.base_monster ? rules.getMonster(req.query.base_monster) : null;
  const adventures = isAdmin && (editing || creating) ? db.prepare("SELECT id, title FROM adventures WHERE status != 'cancelled' ORDER BY id DESC").all() : [];
  const owners = isAdmin && (editing || creating) ? db.listNpcOwners() : [];
  const currentUserId = req.session && req.session.user ? Number(req.session.user.id) : null;
  const banner = status === 'npc_saved' ? '<div class="alert green">✅ NPC saved.</div>'
    : status === 'npc_deleted' ? '<div class="alert green">✅ NPC deleted.</div>' : '';
  return `
    ${banner}
    <section class="card">
      <div class="sheet-section-heading">
        <h3>Notable NPCs</h3>
        ${isAdmin && !editing && !creating ? '<a class="btn btn-green btn-small" href="/admin?tab=npcs&new_npc=1">+ Add NPC</a>' : ''}
      </div>
      <p class="muted small">The people the party keeps running into: who they are and where they turned up.${isAdmin ? ' Players see only the name, role, portrait and adventures; everything else here is for DMs. 🔒 Reserved NPCs have long-term plans: ask their DM before using them. Add an NPC to a running adventure from its table.' : ''}</p>
      ${npcs.length > 4 ? '<input type="search" id="npc-search" placeholder="Search by name or role…" aria-label="Search NPCs">' : ''}
    </section>
    ${editing || creating ? npcForm(editing, adventures, owners, currentUserId, startMonster) : ''}
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
