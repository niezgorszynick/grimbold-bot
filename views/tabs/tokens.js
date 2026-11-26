// views/tabs/tokens.js — "Tokens" tab (DM Tools): the token base. DMs
// upload token images and link each to a character, a Notable NPC, a catalog
// monster type or a custom name; a subject can have several (each labelled),
// one of them main. Each token can be downloaded or its link copied (for
// Owlbear). tokenStripHtml shows a subject's tokens on its own page (the NPC
// form, the monster's statblock, the character sheet).

'use strict';

const db = require('../../db');
const rules = require('../../rules');
const { escapeHtml } = require('../helpers');

const KIND_OPTIONS = { character: 'Character', npc: 'Notable NPC', monster: 'Monster (every one of its kind)', custom: 'Custom name', later: 'I’ll choose later' };

// Where a token's subject lives in the panel.
function subjectHref(token) {
  if (token.kind === 'character' && token.characterId) return `/admin?tab=character-sheet&edit_char=${token.characterId}`;
  if (token.kind === 'npc' && token.npcId) return `/admin?tab=npcs&edit_npc=${token.npcId}`;
  if (token.kind === 'monster') return `/admin?tab=monsters&monster=${encodeURIComponent(token.monster)}`;
  return null;
}

// The upload link for a subject, its fields filled in.
function uploadHref({ kind, characterId, npcId, monster, name }) {
  const params = new URLSearchParams({ tab: 'tokens', kind });
  if (characterId) params.set('character', characterId);
  if (npcId) params.set('npc', npcId);
  if (monster) params.set('monster', monster);
  if (name) params.set('name', name);
  return `/admin?${params}#token-upload`;
}

// What the token is of: the kind and the field for it (the others hide).
function subjectFieldsHtml(subjects, selected = {}) {
  const kind = KIND_OPTIONS[selected.kind] ? selected.kind : 'character';
  const field = (forKind, html) => `<span class="token-subject-field" data-for-kind="${forKind}"${kind === forKind ? '' : ' hidden'}>${html}</span>`;
  return `
    <div class="token-subject" data-subject>
      <label class="art-form-label">Token of
        <select name="kind" data-kind>${Object.entries(KIND_OPTIONS).map(([value, label]) => `<option value="${value}"${kind === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
      </label>
      ${field('character', `<label class="art-form-label">Character
        <select name="character_id">
          <option value="">Choose…</option>
          ${subjects.characters.map(character => `<option value="${character.id}"${Number(selected.characterId) === character.id ? ' selected' : ''}>${escapeHtml(character.name)}${character.player ? ` (${escapeHtml(character.player)})` : ''}${character.status === 'dead' ? ' †' : ''}</option>`).join('')}
        </select></label>`)}
      ${field('npc', `<label class="art-form-label">Notable NPC
        <select name="npc_id">
          <option value="">Choose…</option>
          ${subjects.npcs.map(npc => `<option value="${npc.id}"${Number(selected.npcId) === npc.id ? ' selected' : ''}>${escapeHtml(npc.name)}${npc.private ? ' 🔒' : ''}${npc.dead ? ' †' : ''}</option>`).join('')}
        </select></label>`)}
      ${field('monster', `<label class="art-form-label">Monster <span class="muted small">(from the Monsters tab; one token for all of them)</span>
        <input type="text" name="monster" list="token-monster-list" value="${escapeHtml(selected.monster || '')}" placeholder="Goblin Warrior" autocomplete="off" maxlength="200"></label>`)}
      ${field('later', '<p class="muted small token-later-hint">It waits under <strong>To choose later</strong>, named after its file, until you link it with ✏️ Edit.</p>')}
      ${field('custom', `<label class="art-form-label">Name <span class="muted small">(anyone else: a one-off, a mount, a summon)</span>
        <input type="text" name="name" list="token-custom-list" value="${escapeHtml(selected.name || '')}" placeholder="Captain Ruvo's parrot" autocomplete="off" maxlength="100"></label>`)}
    </div>`;
}

// Download, copy the link (whole, for Owlbear), and open.
function tokenActionsHtml(token) {
  const fileName = `${token.name}${token.label ? ` - ${token.label}` : ''}`.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'token';
  return `
    <div class="token-actions">
      <a class="btn btn-small btn-secondary" href="${escapeHtml(token.url)}" download="${escapeHtml(fileName)}" title="Download the image">⬇</a>
      <button type="button" class="btn btn-small btn-secondary" data-copy-token="${escapeHtml(token.url)}" title="Copy the image's link (for Owlbear)">🔗</button>
      <a class="btn btn-small btn-secondary" href="${escapeHtml(token.url)}" target="_blank" rel="noopener" title="Open full size">↗</a>
    </div>`;
}

const COPY_SCRIPT = `
  <script>
    if (!window.tokenCopyReady) document.addEventListener('click', event => {
      const button = event.target.closest('[data-copy-token]');
      if (!button) return;
      const url = new URL(button.dataset.copyToken, location.origin).href;
      const done = () => { const was = button.textContent; button.textContent = '✓'; setTimeout(() => { button.textContent = was; }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy the link:', url));
      else window.prompt('Copy the link:', url);
    });
    window.tokenCopyReady = true;
  </script>`;

// A subject's tokens on its own page: main first, with links to manage and add.
function tokenStripHtml(tokens, subject) {
  return `
    <div class="token-strip">
      <div class="token-strip-head">
        <strong>🎭 Tokens</strong>
        <a class="small" href="${escapeHtml(uploadHref(subject))}">+ Upload a token</a>
        ${tokens.length ? `<a class="small" href="/admin?tab=tokens&q=${encodeURIComponent(subject.monster || subject.name || '')}">Manage</a>` : ''}
      </div>
      ${tokens.length ? `<div class="token-strip-list">${tokens.map(token => `
        <figure class="token-mini${token.main ? ' is-main' : ''}">
          <a href="${escapeHtml(token.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(token.url)}" alt="${escapeHtml(token.label || token.name)}" loading="lazy"></a>
          <figcaption class="small">${token.main ? '★ ' : ''}${escapeHtml(token.label || 'Token')}</figcaption>
          ${tokenActionsHtml(token)}
        </figure>`).join('')}</div>` : '<p class="muted small">No token yet.</p>'}
    </div>
    ${COPY_SCRIPT}`;
}

function tokenCardHtml(token, subjects) {
  return `
    <figure class="token-card${token.main ? ' is-main' : ''}" data-token-search="${escapeHtml(`${token.name} ${token.label}`.toLowerCase())}">
      <div class="token-image"><img src="${escapeHtml(token.url)}" alt="${escapeHtml(token.label || token.name)}" loading="lazy"></div>
      <figcaption>
        <span>${token.kind === 'later' ? `<strong>${escapeHtml(token.name)}</strong>${token.label ? ` · ${escapeHtml(token.label)}` : ''}` : `${token.main ? '<span class="token-main" title="The main token">★ Main</span> ' : ''}${escapeHtml(token.label || (token.main ? '' : 'Variant'))}`}</span>
        ${tokenActionsHtml(token)}
      </figcaption>
      <details class="token-edit">
        <summary class="small">${token.kind === 'later' ? '✏️ Choose who it is of' : '✏️ Edit'}</summary>
        <form method="POST" action="/admin/tokens/update" class="art-tag-form">
          <input type="hidden" name="id" value="${token.id}">
          <input type="hidden" name="return_to" value="/admin?tab=tokens#token-${token.id}">
          <label class="art-form-label">Label <input type="text" name="label" value="${escapeHtml(token.label)}" maxlength="60" placeholder="Disguised, wild shape…"></label>
          ${subjectFieldsHtml(subjects, token)}
          <label class="small"><input type="checkbox" name="main" value="1"${token.main ? ' checked' : ''}> The main token</label>
          <div class="art-form-actions"><button type="submit" class="btn btn-small btn-green">Save</button></div>
        </form>
        <form method="POST" action="/admin/tokens/delete" class="art-form-actions" onsubmit="return confirm('Delete this token for good?')">
          <input type="hidden" name="id" value="${token.id}">
          <button type="submit" class="btn btn-small btn-red">🗑 Delete</button>
        </form>
      </details>
    </figure>`;
}

function uploadFormHtml(subjects, query) {
  const preset = {
    kind: query.kind,
    characterId: query.character,
    npcId: query.npc,
    monster: query.monster,
    name: query.name
  };
  return `
    <details class="card token-upload" id="token-upload"${query.kind ? ' open' : ''}>
      <summary><strong>⬆ Upload tokens</strong> <span class="muted small">PNG, JPG, WebP or GIF, 5 MB each at most; a transparent PNG works best</span></summary>
      <form class="art-tag-form" id="token-upload-form">
        <label class="art-form-label">Images <span class="muted small">(several at once: each becomes a token of the same subject)</span>
          <input type="file" name="files" accept="image/png,image/jpeg,image/webp,image/gif" multiple required>
        </label>
        ${subjectFieldsHtml(subjects, preset)}
        <div class="token-form-row">
          <label class="art-form-label">Label <span class="muted small">(optional: disguised, wild shape, mounted…)</span> <input type="text" name="label" maxlength="60"></label>
          <label class="small token-main-check"><input type="checkbox" name="main" value="1"> Make it the main token <span class="muted">(the first one of a subject always is)</span></label>
        </div>
        <div class="art-form-actions">
          <span class="muted small" id="token-upload-status" role="status"></span>
          <button type="submit" class="btn btn-green">Upload</button>
        </div>
      </form>
    </details>
    <script>
      (() => {
        const form = document.getElementById('token-upload-form');
        const status = document.getElementById('token-upload-status');
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const files = [...form.elements.files.files];
          if (!files.length) return;
          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          const meta = {
            kind: form.elements.kind.value,
            characterId: form.elements.character_id.value,
            npcId: form.elements.npc_id.value,
            monster: form.elements.monster.value,
            name: form.elements.name.value,
            label: form.elements.label.value
          };
          const ids = [];
          try {
            for (const [index, file] of files.entries()) {
              status.textContent = 'Uploading ' + (index + 1) + ' of ' + files.length + '…';
              const response = await fetch('/api/tokens/upload', {
                method: 'POST', credentials: 'same-origin', body: file,
                headers: { 'Content-Type': 'application/octet-stream', 'X-Token': encodeURIComponent(JSON.stringify({ ...meta, name: meta.kind === 'later' ? file.name.replace(/\\.[^.]+$/, '') : meta.name, main: index === 0 && form.elements.main.checked })) }
              });
              const body = await response.json().catch(() => null);
              if (!body) throw new Error(file.name + ': ' + (response.status === 413 ? 'the server refused it as too large' : 'the server answered ' + response.status));
              if (!response.ok) throw new Error(file.name + ': ' + (body.error || 'upload failed'));
              ids.push(body.id);
            }
            // The new id in the query too: an address that differs only after # would not reload the page.
            location.href = '/admin?tab=tokens&status=token_uploaded&n=' + ids.length + '&new=' + ids[0] + '#token-' + ids[0];
          } catch (error) {
            status.textContent = error.message + (ids.length ? ' (' + ids.length + ' uploaded before it)' : '');
            button.disabled = false;
          }
        });
      })();
    </script>`;
}

// The kind select shows its own field, in every subject picker on the page.
const SUBJECT_SCRIPT = `
  <script>
    document.addEventListener('change', event => {
      const select = event.target.closest('[data-kind]');
      if (!select) return;
      select.closest('[data-subject]').querySelectorAll('[data-for-kind]').forEach(field => { field.hidden = field.dataset.forKind !== select.value; });
    });
  </script>`;

function renderTokensTab(ctx) {
  const { req, isAdmin, currentUser } = ctx;
  if (!isAdmin) return '<section class="card"><p class="muted">Tokens are for DMs.</p></section>';
  const query = req.query;
  if (!query.err) {
    const banners = {
      token_uploaded: `<div class="alert green">🎭 Uploaded ${Number(query.n) || 0} token${Number(query.n) === 1 ? '' : 's'}.</div>`,
      token_saved: '<div class="alert green">🎭 Token saved.</div>',
      token_deleted: '<div class="alert green">🗑 Token deleted.</div>'
    };
    if (banners[query.status]) ctx.setStatusBanner(banners[query.status]);
  }
  const subjects = db.listTokenSubjects(currentUser);
  const tokens = db.listTokens(currentUser);
  const kind = db.TOKEN_KINDS.includes(query.show) ? query.show : '';
  const shown = kind ? tokens.filter(token => token.kind === kind) : tokens;
  // Grouped by kind, then by subject.
  const groups = db.TOKEN_KINDS.map(groupKind => {
    const subjectsOf = new Map();
    for (const token of shown.filter(entry => entry.kind === groupKind)) {
      const key = token.kind === 'later' ? 'later' : token.characterId ? `c${token.characterId}` : token.npcId ? `n${token.npcId}` : `${token.kind}:${token.name.toLowerCase()}`;
      if (!subjectsOf.has(key)) subjectsOf.set(key, []);
      subjectsOf.get(key).push(token);
    }
    return { kind: groupKind, subjects: [...subjectsOf.values()] };
  }).filter(group => group.subjects.length);
  const count = groupKind => tokens.filter(token => token.kind === groupKind).length;
  const monsterNames = rules.listMonsters().map(monster => monster.name);

  return `
    <section class="card">
      <h3>🎭 Tokens</h3>
      <p class="muted small">Token images for characters, Notable NPCs, monsters and anyone else. Only DMs see this tab; the tokens of a private NPC only its DM and the Root DM. 🔗 copies a link Owlbear can load (anyone with the link can open the picture). A subject can have several tokens; ★ marks the main one.</p>
      <form method="GET" action="/admin" class="chronicle-filters">
        <input type="hidden" name="tab" value="tokens">
        <input type="search" id="token-search" value="${escapeHtml(query.q || '')}" placeholder="Search by name or label…" aria-label="Search tokens">
        <select name="show" aria-label="Show" onchange="this.form.submit()">
          <option value="">All (${tokens.length})</option>
          ${db.TOKEN_KINDS.map(value => `<option value="${value}"${kind === value ? ' selected' : ''}>${db.TOKEN_KIND_LABELS[value]} (${count(value)})</option>`).join('')}
        </select>
        <noscript><button type="submit" class="btn btn-small">Filter</button></noscript>
      </form>
    </section>
    ${uploadFormHtml(subjects, query)}
    ${groups.length ? groups.map(group => `
      <section class="card token-group" data-token-group>
        <h3>${db.TOKEN_KIND_LABELS[group.kind]}</h3>
        <div class="token-subjects">
        ${group.subjects.map(list => {
          const first = list[0];
          const href = subjectHref(first);
          if (first.kind === 'later') {
            return `
          <div class="token-subject-row is-later" data-token-subject>
            <h4 class="muted small">Uploaded without saying who they are of: open ✏️ on each to link it to a character, an NPC, a monster or a name.</h4>
            <div class="token-grid">${list.map(token => `<div id="token-${token.id}">${tokenCardHtml(token, subjects)}</div>`).join('')}</div>
          </div>`;
          }
          return `
          <div class="token-subject-row" data-token-subject>
            <h4>${href ? `<a href="${escapeHtml(href)}">${escapeHtml(first.name)}</a>` : escapeHtml(first.name)}${first.privateNpc ? ' <span class="tag gold">🔒 Private</span>' : ''}${first.orphaned ? ` <span class="tag" title="Its ${first.kind === 'npc' ? 'NPC' : 'character'} was deleted">deleted</span>` : ''}
              <a class="small" href="${escapeHtml(uploadHref(first))}">+ another</a></h4>
            <div class="token-grid">${list.map(token => `<div id="token-${token.id}">${tokenCardHtml(token, subjects)}</div>`).join('')}</div>
          </div>`;
        }).join('')}
        </div>
      </section>`).join('') : `<section class="card"><p class="muted">${tokens.length ? 'No tokens of that kind yet.' : 'No tokens yet: upload the first above.'}</p></section>`}
    <datalist id="token-monster-list">${monsterNames.map(name => `<option value="${escapeHtml(name)}"></option>`).join('')}</datalist>
    <datalist id="token-custom-list">${subjects.customNames.map(name => `<option value="${escapeHtml(name)}"></option>`).join('')}</datalist>
    ${SUBJECT_SCRIPT}
    ${COPY_SCRIPT}
    <script>
      (() => {
        const search = document.getElementById('token-search');
        const filter = () => {
          const words = search.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
          document.querySelectorAll('[data-token-subject]').forEach(row => {
            const cards = [...row.querySelectorAll('[data-token-search]')];
            const subject = row.querySelector('h4').textContent.toLowerCase();
            let any = false;
            cards.forEach(card => {
              const text = subject + ' ' + card.dataset.tokenSearch;
              const show = words.every(word => text.includes(word));
              card.parentElement.hidden = !show;
              any = any || show;
            });
            row.hidden = !any;
          });
          document.querySelectorAll('[data-token-group]').forEach(group => { group.hidden = !group.querySelector('[data-token-subject]:not([hidden])'); });
        };
        search.addEventListener('input', filter);
        search.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
        filter();
      })();
    </script>`;
}

module.exports = renderTokensTab;
module.exports.tokenStripHtml = tokenStripHtml;
module.exports.TOKEN_COPY_SCRIPT = COPY_SCRIPT;
