// views/tabs/chronicles.js — "Chronicles" tab: the Google Docs about
// characters (diaries, letters, short stories) shared in the Discord docs
// channel, filterable by character and kind. A doc opens inside the panel
// (Google's own view, or Grimbold's saved copy when it's gone or private).
// DMs import the channel's history and sort what Grimbold couldn't place.

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

const date = value => (value ? String(value).slice(0, 10) : '');

function when(value) {
  if (!value) return '';
  const text = String(value).replace('T', ' ').slice(0, 16);
  return `${text} UTC`;
}

function scanStatusHtml() {
  const status = db.getDocsScanStatus() || {};
  const imported = status.import;
  const poll = status.poll;
  const running = require('../../chronicles').isRunning();
  const lines = [];
  if (imported && imported.running && running) lines.push(`⏳ Importing the channel's history (started ${escapeHtml(when(imported.startedAt))})… reload in a minute.`);
  else if (imported && imported.at) {
    lines.push(imported.error
      ? `⚠️ Last import (${escapeHtml(when(imported.at))}) failed: ${escapeHtml(imported.error)}`
      : `Last import ${escapeHtml(when(imported.at))}${imported.by ? ` by ${escapeHtml(imported.by)}` : ''}: ${Number(imported.messages) || 0} messages read, ${Number(imported.found) || 0} new docs.`);
  } else lines.push('The channel\'s history hasn\'t been imported yet.');
  if (poll && poll.at) {
    lines.push(poll.error
      ? `⚠️ Looking for new posts failed (${escapeHtml(when(poll.at))}): ${escapeHtml(poll.error)}`
      : `Grimbold last looked for new posts ${escapeHtml(when(poll.at))}${poll.found ? ` and found ${Number(poll.found)}` : ''}.`);
  }
  const missing = (poll && poll.at && (!imported || poll.at > (imported.at || '')) ? poll : imported) || {};
  const warning = missing.contentMissing
    ? `<p class="alert red">⚠️ Discord sends Grimbold the messages but not what they say. Switch on <strong>Message Content Intent</strong> in the Discord Developer Portal (your app → Bot → Privileged Gateway Intents), then import again.</p>`
    : '';
  return `${warning}<p class="muted small">${lines.join('<br>')}</p>`;
}

function characterOptions(characters, selected, { blank } = {}) {
  return `${blank ? `<option value="">${blank}</option>` : ''}${characters.map(character =>
    `<option value="${character.id}"${String(selected) === String(character.id) ? ' selected' : ''}>${escapeHtml(character.name)}${character.status === 'dead' ? ' †' : ''}</option>`).join('')}`;
}

function kindOptions(selected, { all } = {}) {
  return `${all ? '<option value="">All kinds</option>' : ''}${Object.entries(db.DOC_KINDS).map(([value, label]) =>
    `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('')}`;
}

// The saved copy as paragraphs.
function savedTextHtml(text) {
  return String(text || '').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('');
}

function viewerHtml(doc, { isAdmin, characters }) {
  const restricted = doc.access === 'restricted';
  const hasCopy = Boolean(doc.saved_length);
  // The saved copy opens first (quicker, and kept when a doc goes private);
  // the live doc loads only when asked for.
  const showCopyFirst = hasCopy;
  return `
    <section class="card chronicle-viewer" id="chronicle-viewer" data-doc-id="${doc.id}">
      <div class="chronicle-viewer-head">
        <div>
          <h3>${escapeHtml(doc.title || 'Untitled document')}</h3>
          <p class="muted small">
            <span class="tag">${escapeHtml(doc.kindLabel)}</span>
            ${doc.character_id ? `<a href="/admin?tab=chronicles&character=${doc.character_id}">${escapeHtml(doc.character_name)}</a>` : '<span class="tag red">Unsorted</span>'}
            ${doc.posted_by_tag ? ` · shared by ${escapeHtml(doc.posted_by_tag)}` : ''}${doc.posted_at ? ` on ${escapeHtml(date(doc.posted_at))}` : ''}
            ${doc.hidden ? ' · <span class="tag">hidden</span>' : ''}
          </p>
        </div>
        <div class="chronicle-actions">
          <button type="button" class="btn btn-small${showCopyFirst ? ' btn-secondary' : ''}" data-show="live">Live doc</button>
          ${hasCopy ? `<button type="button" class="btn btn-small${showCopyFirst ? '' : ' btn-secondary'}" data-show="copy">Saved copy</button>` : ''}
          <button type="button" class="btn btn-small btn-secondary" id="chronicle-refresh" title="Grimbold fetches the doc from Google again and keeps a new copy">↻ Refresh copy</button>
          <a class="btn btn-small btn-secondary" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener">Open in Google Docs ↗</a>
          ${doc.messageUrl ? `<a class="btn btn-small btn-secondary" href="${escapeHtml(doc.messageUrl)}" target="_blank" rel="noopener">Discord post ↗</a>` : ''}
        </div>
      </div>
      <p id="chronicle-refresh-status" class="muted small" role="status">${restricted
        ? `🔒 This doc isn't shared with “Anyone with the link”, so Google shows a sign-in box here.${hasCopy ? ' The saved copy is from before it was closed.' : ' Ask its author to share it with anyone with the link, then press Refresh.'}`
        : doc.saved_at ? `Copy saved ${escapeHtml(when(doc.saved_at))}.` : ''}</p>
      <iframe class="chronicle-frame" data-pane="live" ${showCopyFirst ? 'data-src' : 'src'}="${escapeHtml(doc.embedUrl)}" title="${escapeHtml(doc.title || 'Document')}" loading="lazy" referrerpolicy="no-referrer"${showCopyFirst ? ' hidden' : ''}></iframe>
      ${hasCopy ? `<article class="chronicle-text" data-pane="copy"${showCopyFirst ? '' : ' hidden'}>${doc.saved_html ? `<div class="chronicle-rich">${doc.saved_html}</div>` : savedTextHtml(doc.saved_text)}</article>` : ''}
      ${isAdmin ? `
      <details class="chronicle-dm">
        <summary><strong>🛡 Sort this document</strong>${doc.matched_by ? ` <span class="muted small">(${doc.matched_by === 'dm' ? 'set by a DM' : doc.matched_by === 'poster' ? 'the poster\'s only character' : 'named in the post or title'})</span>` : ''}</summary>
        <form method="POST" action="/admin/chronicles/update" class="chronicle-dm-form">
          <input type="hidden" name="id" value="${doc.id}">
          <label>Title<input type="text" name="title" maxlength="300" value="${escapeHtml(doc.title || '')}"></label>
          <label>Character<select name="character_id">${characterOptions(characters, doc.character_id || '', { blank: '— Unsorted —' })}</select></label>
          <label>Kind<select name="kind">${kindOptions(doc.kind)}</select></label>
          <label class="chronicle-hidden"><input type="hidden" name="hidden" value="0"><input type="checkbox" name="hidden" value="1"${doc.hidden ? ' checked' : ''}> Hidden (not a character doc)</label>
          <button type="submit" class="btn btn-small btn-green">Save</button>
        </form>
      </details>` : ''}
    </section>
    <script>
      (() => {
        const viewer = document.getElementById('chronicle-viewer');
        const panes = viewer.querySelectorAll('[data-pane]');
        const buttons = viewer.querySelectorAll('[data-show]');
        buttons.forEach(button => button.addEventListener('click', () => {
          panes.forEach(pane => { pane.hidden = pane.dataset.pane !== button.dataset.show; });
          const frame = viewer.querySelector('iframe[data-src]');
          if (button.dataset.show === 'live' && frame) { frame.src = frame.dataset.src; frame.removeAttribute('data-src'); }
          buttons.forEach(other => other.classList.toggle('btn-secondary', other !== button));
        }));
        const refresh = document.getElementById('chronicle-refresh');
        const status = document.getElementById('chronicle-refresh-status');
        refresh.addEventListener('click', () => {
          refresh.disabled = true;
          status.textContent = 'Grimbold is fetching the doc…';
          fetch('/api/chronicles/' + viewer.dataset.docId + '/refresh', { method: 'POST', credentials: 'same-origin' })
            .then(response => response.json().then(body => { if (!response.ok) throw new Error(body.error || 'Refresh failed.'); return body; }))
            .then(body => {
              if (body.access === 'restricted') { status.textContent = '🔒 Google still asks for a sign-in: the doc isn\\'t shared with anyone with the link.'; refresh.disabled = false; return; }
              location.reload();
            })
            .catch(error => { status.textContent = error.message; refresh.disabled = false; });
        });
      })();
    </script>`;
}

function listHtml(docs, { query, showCharacter }) {
  if (!docs.length) return '<p class="muted">No documents here yet.</p>';
  const keep = Object.entries(query).filter(([key, value]) => value && key !== 'doc' && key !== 'tab' && key !== 'status' && key !== 'err')
    .map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('');
  return `
    <ul class="chronicle-list">
      ${docs.map(doc => `
        <li class="${String(query.doc) === String(doc.id) ? 'is-current' : ''}${doc.hidden ? ' is-hidden' : ''}">
          <a href="/admin?tab=chronicles${keep}&doc=${doc.id}#chronicle-viewer"><strong>${escapeHtml(doc.title || 'Untitled document')}</strong></a>
          <span class="muted small">
            <span class="tag">${escapeHtml(doc.kindLabel)}</span>
            ${showCharacter ? (doc.character_id ? escapeHtml(doc.character_name) : '<span class="tag red">Unsorted</span>') : ''}
            ${doc.posted_by_tag ? ` · ${escapeHtml(doc.posted_by_tag)}` : ''}${doc.posted_at ? ` · ${escapeHtml(date(doc.posted_at))}` : ''}
            ${doc.access === 'restricted' ? ' · 🔒' : ''}${doc.hidden ? ' · hidden' : ''}
          </span>
        </li>`).join('')}
    </ul>`;
}

// The DM's quick sorting of unsorted docs: a character for each, in place.
function unsortedHtml(docs, characters) {
  if (!docs.length) return '';
  return `
    <section class="card">
      <h4>Unsorted (${docs.length})</h4>
      <p class="muted small">Grimbold couldn't tell whose these are. Pick the character, or hide what isn't a character's doc.</p>
      <ul class="chronicle-list">
        ${docs.map(doc => `
          <li>
            <a href="/admin?tab=chronicles&character=unsorted&doc=${doc.id}#chronicle-viewer"><strong>${escapeHtml(doc.title || 'Untitled document')}</strong></a>
            <span class="muted small">${doc.posted_by_tag ? escapeHtml(doc.posted_by_tag) : ''}${doc.posted_at ? ` · ${escapeHtml(date(doc.posted_at))}` : ''}</span>
            <form method="POST" action="/admin/chronicles/update" class="chronicle-quick-sort">
              <input type="hidden" name="id" value="${doc.id}">
              <input type="hidden" name="return_to" value="list">
              <select name="character_id" aria-label="Character">${characterOptions(characters, '', { blank: '— choose —' })}</select>
              <select name="kind" aria-label="Kind">${kindOptions(doc.kind)}</select>
              <button type="submit" class="btn btn-small btn-green">Save</button>
            </form>
            <form method="POST" action="/admin/chronicles/update" class="chronicle-quick-sort">
              <input type="hidden" name="id" value="${doc.id}">
              <input type="hidden" name="return_to" value="list">
              <input type="hidden" name="hidden" value="1">
              <button type="submit" class="btn btn-small btn-secondary">Hide</button>
            </form>
          </li>`).join('')}
      </ul>
    </section>`;
}

module.exports = function renderChroniclesTab(ctx) {
  const { req, isAdmin } = ctx;
  const query = req.query;
  if (!query.err) {
    const banners = {
      doc_updated: '<div class="alert green">📜 Document saved.</div>',
      docs_import_started: '<div class="alert green">📜 Grimbold is reading the channel\'s history. Reload in a minute to see what he found.</div>',
      docs_import_busy: '<div class="alert red">⏳ Grimbold is already reading the channel; try again in a minute.</div>'
    };
    if (banners[query.status]) ctx.setStatusBanner(banners[query.status]);
  }
  const characters = db.prepare('SELECT id, name, status FROM characters ORDER BY name COLLATE NOCASE').all();
  const includeHidden = isAdmin && query.hidden === '1';
  const unsorted = query.character === 'unsorted';
  const characterId = !unsorted && query.character ? Number(query.character) : null;
  const kind = db.DOC_KINDS[query.kind] ? query.kind : '';
  const docs = db.listCharacterDocs({ characterId, unsorted, kind, isAdmin, includeHidden });
  const everything = db.listCharacterDocs({ isAdmin });
  const counts = new Map();
  everything.forEach(doc => { if (doc.character_id) counts.set(doc.character_id, (counts.get(doc.character_id) || 0) + 1); });
  const withDocs = characters.filter(character => counts.has(character.id));
  const unsortedCount = db.countUnsortedDocs();
  const doc = query.doc ? db.getCharacterDoc(query.doc, { isAdmin }) : null;
  if (query.doc && !doc) ctx.setStatusBanner('<div class="alert red">⚠️ That document is not in the Chronicles.</div>');

  return `
    <section class="card chronicles">
      <div class="chronicles-head">
        <div>
          <h3>📜 Chronicles</h3>
          <p class="muted small">Diaries, letters and stories about the characters, shared as Google Docs in Discord. Grimbold picks up new links every few minutes.</p>
        </div>
        ${isAdmin ? `<form method="POST" action="/admin/chronicles/import"><button type="submit" class="btn btn-small" title="Read every message in the docs channel (and its threads) for Google Docs links">📥 Import past messages</button></form>` : ''}
      </div>
      ${isAdmin ? scanStatusHtml() : ''}
      <form method="GET" action="/admin" class="chronicle-filters">
        <input type="hidden" name="tab" value="chronicles">
        <select name="character" aria-label="Character" onchange="this.form.submit()">
          <option value="">All characters (${everything.length})</option>
          ${isAdmin && unsortedCount ? `<option value="unsorted"${unsorted ? ' selected' : ''}>Unsorted (${unsortedCount})</option>` : ''}
          ${withDocs.map(character => `<option value="${character.id}"${characterId === character.id ? ' selected' : ''}>${escapeHtml(character.name)} (${counts.get(character.id)})</option>`).join('')}
        </select>
        <select name="kind" aria-label="Kind" onchange="this.form.submit()">${kindOptions(kind, { all: true })}</select>
        ${isAdmin ? `<label class="muted small"><input type="checkbox" name="hidden" value="1"${includeHidden ? ' checked' : ''} onchange="this.form.submit()"> Show hidden</label>` : ''}
        <noscript><button type="submit" class="btn btn-small">Filter</button></noscript>
      </form>
      ${listHtml(docs, { query, showCharacter: !characterId })}
    </section>
    ${doc ? viewerHtml(doc, { isAdmin, characters }) : ''}
    ${isAdmin && !unsorted && !doc ? unsortedHtml(db.listCharacterDocs({ unsorted: true, isAdmin }), characters) : ''}
  `;
};
