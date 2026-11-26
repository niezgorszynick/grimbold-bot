// views/tabs/legends.js — "Legends" tab: docs and art about characters that
// have no sheet (db/legends.js, legends.js), seen only by the players on its
// list and the Root DM. A row of the characters on top (each opens their
// page: who they are, their docs and art), then everything, or what is still
// to sort. Anyone who sees the tab imports, sorts and adds characters; only
// the Root DM changes who sees it.

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

const date = value => (value ? String(value).slice(0, 10) : '');
const when = value => (value ? `${String(value).replace('T', ' ').slice(0, 16)} UTC` : '');
const VIEWS = { all: 'Everything', art: '🎨 Art', docs: '📜 Docs', picks: '⭐ Top 4 picks', unsorted: 'To sort', hidden: '🚫 Hidden' };

function scanStatusHtml() {
  const status = db.getLegendsScanStatus() || {};
  const imported = status.import;
  const poll = status.poll;
  const lines = [];
  if (imported && imported.running && require('../../legends').isRunning()) lines.push(`⏳ Importing both channels (started ${escapeHtml(when(imported.startedAt))})… reload in a minute.`);
  else if (imported && imported.at) {
    lines.push(`Last import ${escapeHtml(when(imported.at))}${imported.by ? ` by ${escapeHtml(imported.by)}` : ''}: ${Number(imported.messages) || 0} messages read, ${Number(imported.docs) || 0} new docs, ${Number(imported.images) || 0} new images.`);
    if (imported.error) lines.push(`⚠️ ${escapeHtml(imported.error)}`);
  } else lines.push('The channels\' history hasn\'t been imported yet: press Import.');
  if (poll && poll.at) {
    lines.push(poll.error && !poll.messages
      ? `⚠️ Looking for new posts failed (${escapeHtml(when(poll.at))}): ${escapeHtml(poll.error)}`
      : `Grimbold last looked for new posts ${escapeHtml(when(poll.at))}${poll.docs || poll.images ? ` and found ${Number(poll.docs) || 0} docs, ${Number(poll.images) || 0} images` : ''}.`);
  }
  const latest = (poll && poll.at && (!imported || poll.at > (imported.at || '')) ? poll : imported) || {};
  const warning = latest.contentMissing
    ? '<p class="alert red">⚠️ Discord sends Grimbold the messages but not what is in them. Switch on <strong>Message Content Intent</strong> in the Discord Developer Portal (your app → Bot → Privileged Gateway Intents), then import again.</p>'
    : '';
  return `${warning}<p class="muted small">${lines.join('<br>')}</p>`;
}

const namesOf = item => item.characters.map(character => escapeHtml(character.name)).join(', ');

// Ticked chips, one per character, for the forms.
function chipsHtml(characters, selected) {
  const chosen = new Set(selected.map(String));
  return `
    <div class="art-picker-list legend-chips">
      <input type="hidden" name="tag_form" value="1">
      ${characters.map(character => `<label class="art-chip"><input type="checkbox" name="character_ids" value="${character.id}"${chosen.has(String(character.id)) ? ' checked' : ''}><span>${escapeHtml(character.name)}</span></label>`).join('')}
      ${characters.length ? '' : '<span class="muted small">No characters yet: add one above.</span>'}
    </div>`;
}

function kindOptions(selected, { all } = {}) {
  return `${all ? '<option value="">All kinds</option>' : ''}${Object.entries(db.DOC_KINDS).map(([value, label]) =>
    `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('')}`;
}

// rank: where the viewer put it in their top 4 (a ⭐ badge), if they did.
function thumb(image, href, rank) {
  const picture = image.thumbUrl
    ? `<img src="${escapeHtml(image.thumbUrl)}" alt="${namesOf(image) || 'Art'}" loading="lazy">`
    : `<span class="art-missing" title="${escapeHtml(image.download_error || 'Not copied yet')}">🖼<br><span class="small">${image.download_error ? 'No copy' : 'Copying…'}</span></span>`;
  const credit = image.artist_name ? `<span class="art-credit-badge">🖌 ${escapeHtml(image.artist_name)}</span>` : '';
  const star = rank ? `<span class="legend-pick-badge" title="#${rank} in your top 4">⭐${rank}</span>` : '';
  return `<a class="art-thumb" href="${href}">${picture}${credit}${star}</a>`;
}

const TAGGED_BY = { name: 'named in the post', hand: 'set by hand' };

// Who has a picture in their top 4: chips, "you" for the viewer, best place first.
function pickersHtml(pickedBy, picker) {
  return [...pickedBy].sort((a, b) => a.rank - b.rank).map(entry => `<span class="legend-picker${entry.playerId === picker ? ' is-own' : ''}">${entry.playerId === picker ? 'you' : escapeHtml(entry.tag)} <strong>#${entry.rank}</strong></span>`).join(' ');
}

// A pick's note as paragraphs.
const noteHtml = note => escapeHtml(note).replace(/\n/g, '<br>');

// The form for a pick's note (a few sentences on why).
function pickNoteForm(imageId, note, returnTo, { open = false } = {}) {
  return `
    <details class="legend-pick-note-edit"${open ? ' open' : ''}>
      <summary class="small">${note ? '✏️ Edit your note' : '✏️ Add a note'}</summary>
      <form method="POST" action="/admin/legends/picks" class="art-tag-form">
        <input type="hidden" name="image_id" value="${imageId}">
        <input type="hidden" name="return_to" value="${returnTo}">
        <textarea name="note" rows="3" maxlength="${db.LEGEND_MAX_PICK_NOTE}" placeholder="Why this one? A few sentences at most." aria-label="Your note on this pick">${escapeHtml(note || '')}</textarea>
        <div class="art-form-actions"><button type="submit" name="action" value="note" class="btn btn-small btn-green">Save note</button></div>
      </form>
    </details>`;
}

// The viewer's top 4 for this picture: a place 1–4 (the one they want in the
// most is 1), their note on it, and who else picked it (and why).
function pickPanelHtml(image, { picker, myRank, pickedBy, back }) {
  const returnTo = escapeHtml(`${back}&image=${image.id}#legend-viewer`);
  const max = db.LEGEND_MAX_PICKS;
  const form = picker && !image.hidden ? `
    <form method="POST" action="/admin/legends/picks" class="legend-pick-form">
      <input type="hidden" name="image_id" value="${image.id}">
      <input type="hidden" name="return_to" value="${returnTo}">
      <span class="muted small">⭐ Your top ${max}:</span>
      ${Array.from({ length: max }, (_, index) => index + 1).map(place => `<button type="submit" name="rank" value="${place}" class="btn btn-small${myRank === place ? ' btn-gold' : ' btn-secondary'}"${myRank === place ? ' aria-pressed="true"' : ''} title="${place === 1 ? 'The one you want in the most' : place === max ? 'The one you want in the least of your four' : `#${place}`}">#${place}</button>`).join('')}
      ${myRank ? '<button type="submit" name="action" value="remove" class="btn btn-small btn-secondary">Take out</button>' : ''}
      <a class="small" href="/admin?tab=legends&view=picks">See everyone's</a>
    </form>` : '';
  const mine = pickedBy.find(entry => entry.playerId === picker);
  const notes = [...pickedBy].sort((a, b) => a.rank - b.rank).filter(entry => entry.note);
  const list = pickedBy.length
    ? `<p class="legend-pickers"><span class="muted small">⭐ Picked by</span> ${pickersHtml(pickedBy, picker)}</p>
       ${notes.length ? `<ul class="legend-pick-notes">${notes.map(entry => `<li${entry.playerId === picker ? ' class="is-own"' : ''}><strong>${entry.playerId === picker ? 'You' : escapeHtml(entry.tag)} (#${entry.rank}):</strong> ${noteHtml(entry.note)}</li>`).join('')}</ul>` : ''}`
    : '<p class="muted small">⭐ Nobody has it in their top 4 yet.</p>';
  const edit = mine && form ? pickNoteForm(image.id, mine.note, returnTo) : '';
  return `<div class="legend-pick-panel">${form}${list}${edit}</div>`;
}

// The opened image: large, with who is in it and the form to change it.
function imageViewerHtml(image, { characters, back, picks, canDelete }) {
  return `
    <section class="card art-viewer" id="legend-viewer">
      <div class="art-viewer-head">
        <div>
          <h3>${image.characters.length ? image.characters.map(character => `<a href="/admin?tab=legends&who=${character.id}">${escapeHtml(character.name)}</a>`).join(', ') : '<span class="tag red">Nobody tagged yet</span>'}</h3>
          ${image.artist_name ? `<p class="art-credit-banner">🖌 Art by <strong>${escapeHtml(image.artist_name)}</strong>${image.artist_url ? ` <a class="art-credit-link" href="${escapeHtml(image.artist_url)}" target="_blank" rel="noopener">their page ↗</a>` : ''}</p>` : ''}
          <p class="muted small">${image.posted_by_tag ? `${image.uploaded ? 'uploaded' : 'posted'} by ${escapeHtml(image.posted_by_tag)}` : ''}${image.posted_at ? ` on ${escapeHtml(date(image.posted_at))}` : ''}${image.hidden ? ' · <span class="tag red">Hidden</span>' : ''}</p>
          ${image.message_text ? `<p class="art-caption">${escapeHtml(image.message_text)}</p>` : ''}
          ${pickPanelHtml(image, { ...picks, back })}
        </div>
        <div class="chronicle-actions">
          ${image.imageUrl ? `<a class="btn btn-small btn-secondary" href="${escapeHtml(image.imageUrl)}" target="_blank" rel="noopener">Full size ↗</a>` : ''}
          ${image.messageUrl ? `<a class="btn btn-small btn-secondary" href="${escapeHtml(image.messageUrl)}" target="_blank" rel="noopener">Discord post ↗</a>` : ''}
          <a class="btn btn-small btn-secondary" href="${back}">Close</a>
        </div>
      </div>
      <div class="art-viewer-body with-form">
        ${image.imageUrl
          ? `<a href="${escapeHtml(image.imageUrl)}" target="_blank" rel="noopener" class="art-full-link"><img class="art-full" src="${escapeHtml(image.imageUrl)}" alt="${namesOf(image) || 'Art'}"></a>`
          : `<p class="alert red">Grimbold has no copy of this image${image.download_error ? `: ${escapeHtml(image.download_error)}` : ' yet'}.</p>`}
        <div class="art-tag-panel">
          <h4>Who is in it?${image.tagged_by ? ` <span class="muted small">(${TAGGED_BY[image.tagged_by] || escapeHtml(image.tagged_by)})</span>` : ''}</h4>
          <form method="POST" action="/admin/legends/images/update" class="art-tag-form">
            <input type="hidden" name="id" value="${image.id}">
            <input type="hidden" name="return_to" value="${escapeHtml(`${back}&image=${image.id}#legend-viewer`)}">
            ${chipsHtml(characters, image.characters.map(character => character.id))}
            <div class="art-artist-fields">
              <label class="art-form-label">🖌 Artist
                <input type="text" name="artist" list="legend-artist-list" value="${escapeHtml(image.artist_name || '')}" placeholder="Who drew it?" maxlength="100" autocomplete="off">
              </label>
              <label class="art-form-label">Their page <span class="muted small">(optional)</span>
                <input type="url" name="artist_url" value="${escapeHtml(image.artist_url || '')}" placeholder="https://…" maxlength="300">
              </label>
            </div>
            <div class="art-form-actions">
              <label class="muted small"><input type="hidden" name="hidden" value="0"><input type="checkbox" name="hidden" value="1"${image.hidden ? ' checked' : ''}> Hidden (not about any of them)</label>
              <button type="submit" class="btn btn-green">Save</button>
            </div>
          </form>
          ${canDelete ? `<form method="POST" action="/admin/legends/images/delete" class="art-form-actions" onsubmit="return confirm('Delete this uploaded picture for good?')">
            <input type="hidden" name="id" value="${image.id}">
            <input type="hidden" name="return_to" value="${escapeHtml(back)}">
            <button type="submit" class="btn btn-small btn-red">🗑 Delete upload</button>
          </form>` : ''}
        </div>
      </div>
    </section>`;
}

// The saved copy as paragraphs.
function savedTextHtml(text) {
  return String(text || '').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('');
}

// The opened doc: Grimbold's copy first, Google's live view on request.
function docViewerHtml(doc, { characters, back }) {
  const hasCopy = Boolean(doc.saved_length);
  const restricted = doc.access === 'restricted';
  return `
    <section class="card chronicle-viewer" id="legend-viewer" data-doc-id="${doc.id}">
      <div class="chronicle-viewer-head">
        <div>
          <h3>${escapeHtml(doc.title || 'Untitled document')}</h3>
          <p class="muted small">
            <span class="tag">${escapeHtml(doc.kindLabel)}</span>
            ${doc.characters.length ? doc.characters.map(character => `<a href="/admin?tab=legends&who=${character.id}">${escapeHtml(character.name)}</a>`).join(', ') : '<span class="tag red">Unsorted</span>'}
            ${doc.posted_by_tag ? ` · shared by ${escapeHtml(doc.posted_by_tag)}` : ''}${doc.posted_at ? ` on ${escapeHtml(date(doc.posted_at))}` : ''}
            ${doc.hidden ? ' · <span class="tag">hidden</span>' : ''}
          </p>
        </div>
        <div class="chronicle-actions">
          <button type="button" class="btn btn-small${hasCopy ? ' btn-secondary' : ''}" data-show="live">Live doc</button>
          ${hasCopy ? '<button type="button" class="btn btn-small" data-show="copy">Saved copy</button>' : ''}
          <button type="button" class="btn btn-small btn-secondary" data-refresh title="Grimbold fetches the doc from Google again and keeps a new copy">↻ Refresh copy</button>
          <a class="btn btn-small btn-secondary" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener">Open in Google Docs ↗</a>
          ${doc.messageUrl ? `<a class="btn btn-small btn-secondary" href="${escapeHtml(doc.messageUrl)}" target="_blank" rel="noopener">Discord post ↗</a>` : ''}
          <a class="btn btn-small btn-secondary" href="${back}">Close</a>
        </div>
      </div>
      <p class="muted small" data-refresh-status role="status">${restricted
        ? `🔒 This doc isn't shared with “Anyone with the link”, so Google shows a sign-in box here.${hasCopy ? ' The saved copy is from before it was closed.' : ' Ask its author to share it with anyone with the link, then press Refresh.'}`
        : doc.saved_at ? `Copy saved ${escapeHtml(when(doc.saved_at))}.` : ''}</p>
      <iframe class="chronicle-frame" data-pane="live" ${hasCopy ? 'data-src' : 'src'}="${escapeHtml(doc.embedUrl)}" title="${escapeHtml(doc.title || 'Document')}" loading="lazy" referrerpolicy="no-referrer"${hasCopy ? ' hidden' : ''}></iframe>
      ${hasCopy ? `<article class="chronicle-text" data-pane="copy">${doc.saved_html ? `<div class="chronicle-rich">${doc.saved_html}</div>` : savedTextHtml(doc.saved_text)}</article>` : ''}
      <details class="chronicle-dm"${doc.characters.length ? '' : ' open'}>
        <summary><strong>Who is it about?</strong>${doc.tagged_by ? ` <span class="muted small">(${TAGGED_BY[doc.tagged_by] || escapeHtml(doc.tagged_by)})</span>` : ''}</summary>
        <form method="POST" action="/admin/legends/docs/update" class="art-tag-form">
          <input type="hidden" name="id" value="${doc.id}">
          <input type="hidden" name="return_to" value="${escapeHtml(`${back}&doc=${doc.id}#legend-viewer`)}">
          ${chipsHtml(characters, doc.characters.map(character => character.id))}
          <label class="art-form-label">Title<input type="text" name="title" maxlength="300" value="${escapeHtml(doc.title || '')}"></label>
          <label class="art-form-label">Kind<select name="kind">${kindOptions(doc.kind)}</select></label>
          <div class="art-form-actions">
            <label class="muted small"><input type="hidden" name="hidden" value="0"><input type="checkbox" name="hidden" value="1"${doc.hidden ? ' checked' : ''}> Hidden (not about any of them)</label>
            <button type="submit" class="btn btn-green">Save</button>
          </div>
        </form>
      </details>
    </section>
    <script>
      (() => {
        const viewer = document.getElementById('legend-viewer');
        const panes = viewer.querySelectorAll('[data-pane]');
        const buttons = viewer.querySelectorAll('[data-show]');
        buttons.forEach(button => button.addEventListener('click', () => {
          panes.forEach(pane => { pane.hidden = pane.dataset.pane !== button.dataset.show; });
          const frame = viewer.querySelector('iframe[data-src]');
          if (button.dataset.show === 'live' && frame) { frame.src = frame.dataset.src; frame.removeAttribute('data-src'); }
          buttons.forEach(other => other.classList.toggle('btn-secondary', other !== button));
        }));
        const refresh = viewer.querySelector('[data-refresh]');
        const status = viewer.querySelector('[data-refresh-status]');
        refresh.addEventListener('click', () => {
          refresh.disabled = true;
          status.textContent = 'Grimbold is fetching the doc…';
          fetch('/api/legends/docs/' + viewer.dataset.docId + '/refresh', { method: 'POST', credentials: 'same-origin' })
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

function docListHtml(docs, { keep, current, showWho = true }) {
  if (!docs.length) return '';
  return `
    <ul class="chronicle-list">
      ${docs.map(doc => `
        <li class="${String(current) === String(doc.id) ? 'is-current' : ''}${doc.hidden ? ' is-hidden' : ''}">
          <a href="/admin?tab=legends${keep}&doc=${doc.id}#legend-viewer"><strong>${escapeHtml(doc.title || 'Untitled document')}</strong></a>
          <span class="muted small">
            <span class="tag">${escapeHtml(doc.kindLabel)}</span>
            ${showWho ? (doc.characters.length ? namesOf(doc) : '<span class="tag red">Unsorted</span>') : ''}
            ${doc.posted_by_tag ? ` · ${escapeHtml(doc.posted_by_tag)}` : ''}${doc.posted_at ? ` · ${escapeHtml(date(doc.posted_at))}` : ''}
            ${doc.access === 'restricted' ? ' · 🔒' : ''}
          </span>
        </li>`).join('')}
    </ul>`;
}

// pickers: Map(imageId → [{ playerId, tag, rank }]), shown under each picture.
function artGridHtml(images, { keep, current, ranks = new Map(), pickers = new Map(), picker = null }) {
  if (!images.length) return '';
  return `<div class="art-grid">${images.map(image => `
    <figure class="${String(current) === String(image.id) ? 'is-current' : ''}">
      ${thumb(image, `/admin?tab=legends${keep}&image=${image.id}#legend-viewer`, ranks.get(image.id))}
      <figcaption>${namesOf(image) || '<span class="muted">nobody</span>'}${image.artist_name ? `<br><span class="art-credit">🖌 ${escapeHtml(image.artist_name)}</span>` : ''}${pickers.has(image.id) ? `<br><span class="legend-pickers">⭐ ${pickersHtml(pickers.get(image.id), picker)}</span>` : ''}</figcaption>
    </figure>`).join('')}</div>`;
}

const SORT_PAGE = 120;

// To sort, images: a grid to select many (click, Shift-click for a range),
// and one bar to tag them all with the ticked characters, or hide them.
// Keys 1–9 tick the first nine characters; Enter tags.
function bulkSortHtml({ images, characters, posters, poster, page }) {
  const pages = Math.max(1, Math.ceil(images.length / SORT_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const shown = images.slice((current - 1) * SORT_PAGE, current * SORT_PAGE);
  const base = `/admin?tab=legends&view=unsorted${poster ? `&poster=${encodeURIComponent(poster)}` : ''}`;
  const back = `${base}${current > 1 ? `&page=${current}` : ''}`;
  // How many images each post has, to mark those that came together.
  const perPost = new Map();
  images.forEach(image => perPost.set(image.message_id, (perPost.get(image.message_id) || 0) + 1));
  const pager = pages > 1 ? `<p class="legend-pager small">${Array.from({ length: pages }, (_, index) => index + 1).map(number =>
    number === current ? `<strong>${number}</strong>` : `<a href="${base}&page=${number}">${number}</a>`).join(' ')}</p>` : '';
  return `
    <form method="GET" action="/admin" class="chronicle-filters">
      <input type="hidden" name="tab" value="legends">
      <input type="hidden" name="view" value="unsorted">
      <select name="poster" aria-label="Posted by" onchange="this.form.submit()">
        <option value="">Posted by anyone</option>
        ${posters.map(entry => `<option value="${escapeHtml(entry.discordId)}"${poster === entry.discordId ? ' selected' : ''}>${escapeHtml(entry.tag || entry.discordId)} (${entry.count})</option>`).join('')}
      </select>
      <noscript><button type="submit" class="btn btn-small">Filter</button></noscript>
    </form>
    <form method="POST" action="/admin/legends/images/bulk" class="legend-bulk" data-bulk>
      <input type="hidden" name="return_to" value="${escapeHtml(back)}">
      <div class="legend-bulk-bar">
        <div class="legend-chips">
          ${characters.map((character, index) => `<label class="art-chip"><input type="checkbox" name="character_ids" value="${character.id}"${index < 9 ? ` data-key="${index + 1}"` : ''}><span>${index < 9 ? `<kbd>${index + 1}</kbd> ` : ''}${escapeHtml(character.name)}</span></label>`).join('')}
        </div>
        <div class="art-form-actions">
          <span class="muted small" data-bulk-count role="status">0 selected</span>
          <button type="button" class="btn btn-small btn-secondary" data-bulk-all>Select all ${shown.length}</button>
          <button type="button" class="btn btn-small btn-secondary" data-bulk-none>Clear</button>
          <button type="submit" name="action" value="hide" class="btn btn-small btn-secondary" data-needs-selection disabled>🚫 Hide selected</button>
          <button type="submit" name="action" value="tag" class="btn btn-green" data-needs-selection disabled>Tag selected</button>
        </div>
      </div>
      <p class="muted small">${images.length} image${images.length === 1 ? '' : 's'} to sort. Click pictures to select them (Shift-click selects a range), tick who is in them, then <strong>Tag selected</strong>. Keys <kbd>1</kbd>–<kbd>9</kbd> tick characters, <kbd>Enter</kbd> tags. Pictures from one post sit together and carry a ▣ mark. ⤢ opens a picture large.</p>
      ${pager}
      <div class="legend-sort-grid">
        ${shown.map(image => `
          <label class="legend-sort-cell" title="${escapeHtml([image.posted_by_tag, date(image.posted_at), image.message_text].filter(Boolean).join(' · ').slice(0, 300))}">
            <input type="checkbox" name="image_ids" value="${image.id}">
            ${image.thumbUrl ? `<img src="${escapeHtml(image.thumbUrl)}" alt="" loading="lazy">` : `<span class="art-missing">🖼<br><span class="small">${image.download_error ? 'No copy' : 'Copying…'}</span></span>`}
            ${perPost.get(image.message_id) > 1 ? `<span class="legend-sort-post" aria-label="one of ${perPost.get(image.message_id)} from one post">▣ ${perPost.get(image.message_id)}</span>` : ''}
            <a class="legend-sort-open" href="${back}&image=${image.id}#legend-viewer" title="Open large" aria-label="Open large">⤢</a>
            ${image.message_text ? `<span class="legend-sort-text">${escapeHtml(image.message_text.slice(0, 60))}</span>` : ''}
          </label>`).join('')}
      </div>
      ${pager}
    </form>
    <script>
      (() => {
        const form = document.querySelector('[data-bulk]');
        const boxes = [...form.querySelectorAll('input[name="image_ids"]')];
        const count = form.querySelector('[data-bulk-count]');
        const needing = form.querySelectorAll('[data-needs-selection]');
        let last = null;
        const update = () => {
          const n = boxes.filter(box => box.checked).length;
          count.textContent = n + ' selected';
          needing.forEach(button => { button.disabled = n === 0; });
        };
        // The click is handled on the picture's cell, so Shift reaches it in every browser.
        boxes.forEach((box, index) => box.closest('.legend-sort-cell').addEventListener('click', event => {
          if (event.target.closest('.legend-sort-open')) return;
          event.preventDefault();
          box.checked = !box.checked;
          if (event.shiftKey && last !== null) {
            const [from, to] = [Math.min(last, index), Math.max(last, index)];
            for (let i = from; i <= to; i += 1) boxes[i].checked = box.checked;
          }
          last = index;
          update();
        }));
        form.querySelector('[data-bulk-all]').addEventListener('click', () => { boxes.forEach(box => { box.checked = true; }); update(); });
        form.querySelector('[data-bulk-none]').addEventListener('click', () => { boxes.forEach(box => { box.checked = false; }); last = null; update(); });
        document.addEventListener('keydown', event => {
          if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && event.target.type !== 'checkbox') return;
          const chip = /^[1-9]$/.test(event.key) && form.querySelector('[data-key="' + event.key + '"]');
          if (chip) { event.preventDefault(); chip.checked = !chip.checked; return; }
          if (event.key === 'Enter' && boxes.some(box => box.checked)) {
            event.preventDefault();
            form.requestSubmit(form.querySelector('button[value="tag"]'));
          }
        });
        update();
      })();
    </script>`;
}

// To sort: the images in bulk, the docs (fewer) each beside its chips.
function sortingHtml({ images, docs, characters, posters, poster, page }) {
  if (!images.length && !docs.length) {
    return `<p class="muted">${poster ? 'Nothing from this poster to sort. <a href="/admin?tab=legends&view=unsorted">Everyone\'s</a>' : 'Nothing to sort: everything is about someone, or hidden.'}</p>`;
  }
  const back = '/admin?tab=legends&view=unsorted';
  const actions = `
    <div class="art-form-actions">
      <button type="submit" name="hidden" value="1" class="btn btn-small btn-secondary">🚫 Hide</button>
      <button type="submit" class="btn btn-green">Save</button>
    </div>`;
  return `
    <p class="muted small">Grimbold couldn't tell who these are about. Adding a character (or an alias) also sorts whatever names them.</p>
    ${images.length ? bulkSortHtml({ images, characters, posters, poster, page }) : ''}
    ${docs.length ? `<h4>📜 Docs to sort (${docs.length})</h4>` : ''}
    <div class="art-sort">
      ${docs.map(doc => `
        <form method="POST" action="/admin/legends/docs/update" class="art-sort-item" id="sort-doc-${doc.id}">
          <input type="hidden" name="id" value="${doc.id}">
          <input type="hidden" name="return_to" value="${back}">
          <div class="art-sort-image">
            <p>📜 <a href="/admin?tab=legends&view=unsorted&doc=${doc.id}#legend-viewer"><strong>${escapeHtml(doc.title || 'Untitled document')}</strong></a></p>
            <p class="muted small">${doc.posted_by_tag ? escapeHtml(doc.posted_by_tag) : ''}${doc.posted_at ? ` · ${escapeHtml(date(doc.posted_at))}` : ''}${doc.access === 'restricted' ? ' · 🔒 not shared' : ''}</p>
          </div>
          <div class="art-sort-form">
            ${chipsHtml(characters, [])}
            <label class="art-form-label">Kind <select name="kind">${kindOptions(doc.kind)}</select></label>
            ${actions}
          </div>
        </form>`).join('')}
    </div>`;
}

// Pictures from outside the channel: tagged on the way in (nobody ticked: To sort).
function uploadHtml(characters, who) {
  return `
    <section class="card">
      <details class="legend-upload">
        <summary><strong>⬆ Upload pictures</strong> <span class="muted small">from outside the Discord channel</span></summary>
        <form class="art-tag-form" id="legend-upload">
          <label class="art-form-label">Pictures <span class="muted small">(PNG, JPG, WebP or GIF, 25 MB each at most; several at once is fine)</span>
            <input type="file" name="files" accept="image/png,image/jpeg,image/webp,image/gif" multiple required>
          </label>
          <span class="art-form-label">Who is in them? <span class="muted small">(none ticked: they wait in To sort)</span></span>
          <div class="legend-chips">
            ${characters.map(character => `<label class="art-chip"><input type="checkbox" name="character_ids" value="${character.id}"${who && who.id === character.id ? ' checked' : ''}><span>${escapeHtml(character.name)}</span></label>`).join('')}
          </div>
          <div class="art-artist-fields">
            <label class="art-form-label">🖌 Artist <input type="text" name="artist" list="legend-artist-list" placeholder="Who drew it?" maxlength="100" autocomplete="off"></label>
            <label class="art-form-label">Their page <span class="muted small">(optional)</span> <input type="url" name="artist_url" placeholder="https://…" maxlength="300"></label>
          </div>
          <label class="art-form-label">Caption <span class="muted small">(optional)</span><textarea name="caption" rows="2" maxlength="2000"></textarea></label>
          <div class="art-form-actions">
            <span class="muted small" id="legend-upload-status" role="status"></span>
            <button type="submit" class="btn btn-green">Upload</button>
          </div>
        </form>
      </details>
    </section>
    <script>
      (() => {
        const form = document.getElementById('legend-upload');
        const status = document.getElementById('legend-upload-status');
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const files = [...form.elements.files.files];
          if (!files.length) return;
          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          const characters = [...form.querySelectorAll('input[name="character_ids"]:checked')].map(box => box.value);
          // Grimbold's answer, or why the web server in front refused it.
          const call = async (path, body, raw) => {
            const response = await fetch('/api/legends/uploads' + path, {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
              body: raw ? body : JSON.stringify(body)
            });
            const result = await response.json().catch(() => null);
            if (!result) throw new Error(response.status === 413 ? 'the server refused it as too large' : 'the server answered ' + response.status + '; try again');
            if (!response.ok) throw new Error(result.error || 'upload failed');
            return result;
          };
          const ids = [];
          try {
            for (const [index, file] of files.entries()) {
              const label = files.length > 1 ? (index + 1) + ' of ' + files.length + ', ' : '';
              try {
                // In pieces: the web server in front refuses big requests.
                const { uploadId, pieceBytes } = await call('', { size: file.size });
                for (let offset = 0; offset < file.size; offset += pieceBytes) {
                  status.textContent = 'Uploading ' + label + Math.round(offset / file.size * 100) + '%…';
                  await call('/' + uploadId + '/pieces?offset=' + offset, file.slice(offset, offset + pieceBytes), true);
                }
                status.textContent = 'Saving ' + label.replace(/, $/, '') + '…';
                const { id } = await call('/' + uploadId + '/finish', {
                  caption: form.elements.caption.value, characterIds: characters,
                  artist: form.elements.artist.value, artistUrl: form.elements.artist_url.value
                });
                ids.push(id);
              } catch (error) {
                throw new Error(file.name + ': ' + error.message);
              }
            }
            location.href = '/admin?tab=legends' + (characters.length ? '' : '&view=unsorted') + '&status=legend_uploaded&n=' + ids.length + '&image=' + ids[0] + '#legend-viewer';
          } catch (error) {
            status.textContent = error.message + (ids.length ? ' (' + ids.length + ' uploaded before it)' : '');
            button.disabled = false;
          }
        });
      })();
    </script>`;
}

// Everyone's top 4, the viewer's own first with buttons to reorder.
// compact: the main page's summary (no buttons, no help, nobody who picked nothing).
function picksHtml(entries, picker, { compact = false } = {}) {
  const rows = [...entries.filter(entry => entry.playerId === picker), ...entries.filter(entry => entry.playerId !== picker)]
    .filter(entry => !compact || entry.picks.length);
  if (!rows.length) return compact ? '' : '<p class="muted">Nobody on the list has a panel account yet.</p>';
  const max = db.LEGEND_MAX_PICKS;
  const back = '/admin?tab=legends&view=picks';
  const control = (image, action, label, title, disabled) => `
    <form method="POST" action="/admin/legends/picks">
      <input type="hidden" name="image_id" value="${image.id}"><input type="hidden" name="return_to" value="${back}">
      <button type="submit" name="action" value="${action}" class="btn btn-small btn-secondary" title="${title}" aria-label="${title}"${disabled ? ' disabled' : ''}>${label}</button>
    </form>`;
  if (compact) {
    return `
    <section class="card legend-picks-summary">
      <div class="chronicles-head">
        <h3>⭐ Top ${max} picks</h3>
        <a class="btn btn-small btn-secondary" href="${back}">${picker ? 'Change yours' : 'See them large'}</a>
      </div>
      <div class="legend-picks-mini">
        ${rows.map(entry => `
          <div class="legend-picks-mini-row${entry.playerId === picker ? ' is-own' : ''}">
            <strong>${entry.playerId === picker ? 'You' : escapeHtml(entry.tag)}</strong>
            <ol>${entry.picks.map((image, index) => `<li${image.pickNote ? ` title="${escapeHtml(image.pickNote)}"` : ''}><span class="legend-pick-place">#${index + 1}${image.pickNote ? ' 💬' : ''}</span>${thumb(image, `/admin?tab=legends&image=${image.id}#legend-viewer`)}</li>`).join('')}</ol>
          </div>`).join('')}
      </div>
    </section>`;
  }
  return `
    <p class="muted small">Each of you picks ${max} pictures from anywhere in Legends and ranks them: #1 is the one you want in the most, #${max} the least. Open a picture and choose its place; putting one where another already is moves the rest down.</p>
    <div class="legend-picks">
      ${rows.map(entry => {
        const own = entry.playerId === picker;
        return `
        <div class="legend-picks-row${own ? ' is-own' : ''}">
          <h4>${own ? 'Your picks' : escapeHtml(entry.tag)} <span class="muted small">${entry.picks.length} of ${max}</span></h4>
          <ol class="legend-picks-slots">
            ${Array.from({ length: max }, (_, index) => {
              const image = entry.picks[index];
              if (!image) return `<li class="legend-pick-slot is-empty"><span class="legend-pick-place">#${index + 1}</span><span class="muted small">${own ? `Open a picture and press #${index + 1}` : 'Not picked yet'}</span></li>`;
              return `
              <li class="legend-pick-slot">
                <span class="legend-pick-place">#${index + 1}</span>
                ${thumb(image, `${back}&image=${image.id}#legend-viewer`)}
                <span class="small">${namesOf(image) || '<span class="muted">nobody</span>'}${image.hidden ? ' · <span class="tag red">Hidden</span>' : ''}</span>
                ${image.pickNote ? `<p class="legend-pick-note">${noteHtml(image.pickNote)}</p>` : ''}
                ${own ? pickNoteForm(image.id, image.pickNote, back) : ''}
                ${own ? `<div class="legend-pick-controls">
                  ${control(image, 'up', '↑', 'Move up', index === 0)}
                  ${control(image, 'down', '↓', 'Move down', index === entry.picks.length - 1)}
                  ${control(image, 'remove', '✕', 'Take out', false)}
                </div>` : ''}
              </li>`;
            }).join('')}
          </ol>
        </div>`;
      }).join('')}
    </div>`;
}

// The row of characters: a picture (their portrait, else their first image), name and counts.
function rosterHtml(characters, selected) {
  return `
    <div class="legend-roster">
      ${characters.map(character => `
        <a class="legend-card${selected === character.id ? ' is-current' : ''}" href="/admin?tab=legends&who=${character.id}"${selected === character.id ? ' aria-current="page"' : ''}>
          <span class="legend-card-picture">${character.pictureUrl ? `<img src="${escapeHtml(character.pictureUrl)}" alt="" loading="lazy">` : `<span aria-hidden="true">${escapeHtml(character.name.slice(0, 1).toUpperCase())}</span>`}</span>
          <strong>${escapeHtml(character.name)}</strong>
          <span class="muted small">${character.image_count} art · ${character.doc_count} docs</span>
        </a>`).join('')}
      <details class="legend-card legend-add">
        <summary><span class="legend-card-picture" aria-hidden="true">＋</span><strong>Add a character</strong></summary>
        <form method="POST" action="/admin/legends/characters/save" class="art-tag-form">
          <label class="art-form-label">Name <input type="text" name="name" maxlength="100" required></label>
          <label class="art-form-label">Also called <span class="muted small">(comma-separated)</span> <input type="text" name="aliases" maxlength="500"></label>
          <button type="submit" class="btn btn-small btn-green">Add</button>
        </form>
      </details>
    </div>`;
}

// One character's page: who they are, and the form to change it.
function profileHtml(character, images) {
  return `
    <section class="card legend-profile">
      <div class="chronicles-head">
        <div>
          <h3>${escapeHtml(character.name)}</h3>
          ${character.aliasList.length ? `<p class="muted small">Also called ${character.aliasList.map(escapeHtml).join(', ')}</p>` : ''}
        </div>
        <a class="btn btn-small btn-secondary" href="/admin?tab=legends">All characters</a>
      </div>
      ${character.description ? `<div class="legend-description">${character.description.split(/\n\s*\n/).map(block => `<p>${escapeHtml(block.trim()).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : '<p class="muted small">No description yet.</p>'}
      <details class="chronicle-dm">
        <summary><strong>✏️ Edit ${escapeHtml(character.name)}</strong></summary>
        <form method="POST" action="/admin/legends/characters/save" class="art-tag-form">
          <input type="hidden" name="id" value="${character.id}">
          <label class="art-form-label">Name <input type="text" name="name" maxlength="100" required value="${escapeHtml(character.name)}"></label>
          <label class="art-form-label">Also called <span class="muted small">(comma-separated: nicknames, full names; posts naming these are tagged too)</span>
            <input type="text" name="aliases" maxlength="500" value="${escapeHtml(character.aliasList.join(', '))}">
          </label>
          <label class="art-form-label">Who they are
            <textarea name="description" rows="5" maxlength="4000">${escapeHtml(character.description || '')}</textarea>
          </label>
          ${images.length ? `<label class="art-form-label">Picture on their card
            <select name="portrait_image_id">
              <option value="">Their first picture</option>
              ${images.map(image => `<option value="${image.id}"${character.portrait_image_id === image.id ? ' selected' : ''}>${escapeHtml(date(image.posted_at) || `#${image.id}`)}${image.artist_name ? ` · 🖌 ${escapeHtml(image.artist_name)}` : ''}${image.message_text ? ` · ${escapeHtml(image.message_text.slice(0, 40))}` : ''}</option>`).join('')}
            </select>
          </label>` : ''}
          <div class="art-form-actions"><button type="submit" class="btn btn-green">Save</button></div>
        </form>
        <form method="POST" action="/admin/legends/characters/delete" class="art-form-actions" onsubmit="return confirm('Remove ${escapeHtml(character.name.replace(/['\\]/g, ''))}? Their docs and art stay, and go back to sorting if they are about nobody else.')">
          <input type="hidden" name="id" value="${character.id}">
          <button type="submit" class="btn btn-small btn-red">🗑 Remove character</button>
        </form>
      </details>
    </section>`;
}

// Root DM: who sees the tab, by Discord ID.
function viewersHtml() {
  const viewers = db.listLegendsViewers();
  return `
    <section class="card" id="legends-viewers">
      <details>
        <summary><strong>🛡 Who sees Legends</strong> <span class="muted small">${viewers.length} player${viewers.length === 1 ? '' : 's'} and you</span></summary>
        <p class="muted small">Only these players (and the Root DM) see this tab, its pictures and its docs. Other DMs don't.</p>
        ${viewers.length ? `<ul class="art-editors">${viewers.map(viewer => `<li><code>${escapeHtml(viewer.discordId)}</code> ${viewer.tag ? escapeHtml(viewer.tag) : '<span class="muted small">(no panel account with this ID yet)</span>'}</li>`).join('')}</ul>` : ''}
        <form method="POST" action="/admin/legends/viewers" class="art-tag-form">
          <label class="art-form-label">Discord IDs, one per line
            <textarea name="discord_ids" rows="5">${escapeHtml(viewers.map(viewer => viewer.discordId).join('\n'))}</textarea>
          </label>
          <div class="art-form-actions"><button type="submit" class="btn btn-green">Save</button></div>
        </form>
      </details>
    </section>`;
}

module.exports = function renderLegendsTab(ctx) {
  const { req, isRootAdmin, currentUser } = ctx;
  if (!db.canSeeLegends(currentUser)) return '';
  const query = req.query;
  if (!query.err) {
    const banners = {
      legend_saved: '<div class="alert green">🏛 Character saved.</div>',
      legend_deleted: '<div class="alert green">🗑 Character removed.</div>',
      legend_item_saved: '<div class="alert green">🏛 Saved.</div>',
      legend_bulk_tagged: `<div class="alert green">🏛 Tagged ${Number(query.n) || 0} image${Number(query.n) === 1 ? '' : 's'}.</div>`,
      legend_uploaded: `<div class="alert green">⬆ Uploaded ${Number(query.n) || 0} picture${Number(query.n) === 1 ? '' : 's'}.</div>`,
      legend_upload_deleted: '<div class="alert green">🗑 Upload deleted.</div>',
      legend_picked: `<div class="alert green">⭐ #${Number(query.rank) || ''} in your top ${db.LEGEND_MAX_PICKS}.${query.dropped ? ` Your old #${db.LEGEND_MAX_PICKS} is out of it now (<a href="/admin?tab=legends&image=${Number(query.dropped) || 0}#legend-viewer">see it</a>).` : ''}</div>`,
      legend_picks_saved: '<div class="alert green">⭐ Your top 4 is saved.</div>',
      legend_pick_note_saved: '<div class="alert green">💬 Note saved.</div>',
      legend_bulk_hidden: `<div class="alert green">🚫 Hid ${Number(query.n) || 0} image${Number(query.n) === 1 ? '' : 's'}.</div>`,
      legends_viewers_saved: '<div class="alert green">🛡 The list of who sees Legends is saved.</div>',
      legends_import_started: '<div class="alert green">🏛 Grimbold is reading both channels\' history. Reload in a minute to see what he found.</div>',
      legends_import_busy: '<div class="alert red">⏳ Grimbold is already reading the channels; try again in a minute.</div>'
    };
    if (banners[query.status]) ctx.setStatusBanner(banners[query.status]);
  }
  const characters = db.listLegendCharacters();
  const who = Number(query.who) > 0 ? characters.find(character => character.id === Number(query.who)) || null : null;
  const view = VIEWS[query.view] ? query.view : 'all';
  const sorting = view === 'unsorted';
  const listView = view === 'hidden' ? 'hidden' : sorting ? 'unsorted' : 'gallery';
  const kind = db.DOC_KINDS[query.kind] ? query.kind : '';
  const artist = query.artist ? String(query.artist) : '';
  const poster = sorting && /^\d{15,22}$/.test(String(query.poster || '')) ? String(query.poster) : '';
  const characterId = who && !sorting && view !== 'hidden' ? who.id : null;
  const images = view === 'docs' || view === 'picks' || kind ? [] : db.listLegendImages({ view: listView, characterId, artist, poster });
  const docs = view === 'art' || view === 'picks' || artist ? [] : db.listLegendDocs({ view: listView, characterId, kind });
  // Top 4: players on the list pick (the Root DM only looks); everyone sees everyone's.
  const allPicks = db.listLegendPicks();
  const picker = allPicks.some(entry => entry.playerId === Number(currentUser && currentUser.id)) ? Number(currentUser.id) : null;
  const ranks = db.legendPickRanks(picker);
  const pickers = new Map();
  allPicks.forEach(entry => entry.picks.forEach((pick, index) => {
    if (!pickers.has(pick.id)) pickers.set(pick.id, []);
    pickers.get(pick.id).push({ playerId: entry.playerId, tag: entry.tag, rank: index + 1, note: pick.pickNote });
  }));
  const counts = db.legendCounts();
  const keep = `${who ? `&who=${who.id}` : ''}${view !== 'all' ? `&view=${view}` : ''}${kind ? `&kind=${kind}` : ''}${artist ? `&artist=${encodeURIComponent(artist)}` : ''}`;
  const back = `/admin?tab=legends${keep}`;
  const image = query.image ? db.getLegendImage(query.image) : null;
  const doc = !image && query.doc ? db.getLegendDoc(query.doc) : null;
  if ((query.image && !image) || (query.doc && !doc)) ctx.setStatusBanner('<div class="alert red">⚠️ That is not in Legends.</div>');
  const artists = db.listLegendArtists();

  return `
    <section class="card legends">
      <div class="chronicles-head">
        <div>
          <h3>🏛 Legends</h3>
          <p class="muted small">Docs and art about characters who live outside the character sheets, from their own two Discord channels. Grimbold picks up new posts every few minutes and tags the characters a post names; sort the rest under <strong>To sort</strong>.</p>
        </div>
        <form method="POST" action="/admin/legends/import"><button type="submit" class="btn btn-small" title="Read every message in both channels (and their threads) for Google Docs and images">📥 Import past messages</button></form>
      </div>
      ${scanStatusHtml()}
      ${rosterHtml(characters, who ? who.id : null)}
    </section>
    ${!who && view === 'all' && !kind && !artist ? picksHtml(allPicks, picker, { compact: true }) : ''}
    ${who ? profileHtml(who, db.listLegendImages({ characterId: who.id })) : ''}
    ${image ? imageViewerHtml(image, {
      characters,
      back,
      canDelete: db.canDeleteLegendImage(currentUser, image.id),
      picks: {
        picker,
        myRank: ranks.get(image.id) || null,
        pickedBy: pickers.get(image.id) || []
      }
    }) : ''}
    ${doc ? docViewerHtml(doc, { characters, back }) : ''}
    ${uploadHtml(characters, who)}
    <section class="card">
      <form method="GET" action="/admin" class="chronicle-filters">
        <input type="hidden" name="tab" value="legends">
        ${who ? `<input type="hidden" name="who" value="${who.id}">` : ''}
        <select name="view" aria-label="Show" onchange="this.form.submit()">
          ${Object.entries(VIEWS).map(([value, label]) => {
            const count = { all: counts.images + counts.docs, art: counts.images, docs: counts.docs, picks: allPicks.filter(entry => entry.picks.length).length, unsorted: counts.unsorted, hidden: counts.hidden }[value];
            return `<option value="${value === 'all' ? '' : value}"${view === value ? ' selected' : ''}>${label}${who && ['all', 'art', 'docs'].includes(value) ? '' : ` (${count})`}</option>`;
          }).join('')}
        </select>
        ${['all', 'docs'].includes(view) ? `<select name="kind" aria-label="Kind of doc" onchange="this.form.submit()">${kindOptions(kind, { all: true })}</select>` : ''}
        ${['all', 'art'].includes(view) && artists.length ? `<select name="artist" aria-label="Artist" onchange="this.form.submit()">
          <option value="">All artists</option>
          ${artists.map(entry => `<option value="${escapeHtml(entry.name)}"${artist === entry.name ? ' selected' : ''}>🖌 ${escapeHtml(entry.name)} (${entry.count})</option>`).join('')}
        </select>` : ''}
        <noscript><button type="submit" class="btn btn-small">Filter</button></noscript>
      </form>
      ${who && (sorting || view === 'hidden' || view === 'picks') ? `<p class="muted small">${view === 'picks' ? 'Top 4 picks show' : 'To sort and Hidden show'} everyone's.</p>` : ''}
      ${view === 'picks'
        ? picksHtml(allPicks, picker)
        : sorting
        ? sortingHtml({ images, docs: poster ? [] : docs, characters, posters: db.listLegendUnsortedPosters(), poster, page: Number(query.page) || 1 })
        : images.length || docs.length
          ? `${docs.length ? `<h4>📜 Docs (${docs.length})</h4>${docListHtml(docs, { keep, current: doc && doc.id, showWho: !who })}` : ''}
             ${images.length ? `<h4>🎨 Art (${images.length})</h4>${artGridHtml(images, { keep, current: image && image.id, ranks, pickers, picker })}` : ''}`
          : `<p class="muted">${view === 'hidden' ? 'Nothing hidden.' : who ? `Nothing about ${escapeHtml(who.name)} yet.` : 'Nothing here yet: import the channels, or sort what is waiting.'}</p>`}
    </section>
    ${isRootAdmin ? viewersHtml() : ''}
    <datalist id="legend-artist-list">${artists.map(entry => `<option value="${escapeHtml(entry.name)}"></option>`).join('')}</datalist>
  `;
};
