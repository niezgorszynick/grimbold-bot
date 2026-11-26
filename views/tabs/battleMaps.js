// views/tabs/battleMaps.js — "Owlbear Maps" tab (DM Tools): the battle maps
// used in adventures (db/battleMaps.js), each tied to an adventure and maybe
// to one of its world-map markers. Every DM sees them, unless a map is
// hidden (then its adventure's DM, the Root DM and the uploader). Uploads go
// in pieces with a preview the browser makes. battleMapStripHtml lists an
// adventure's maps on its table page.

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const date = value => (value ? String(value).slice(0, 10) : '');

// The adventure and marker selects (the markers follow the adventure chosen).
function placeFieldsHtml(adventures, { adventureId, markerId } = {}) {
  const chosen = adventures.find(adventure => adventure.id === Number(adventureId));
  return `
    <label class="art-form-label">Adventure
      <select name="adventure_id" data-map-adventure required>
        <option value="">Choose…</option>
        ${adventures.map(adventure => `<option value="${adventure.id}"${chosen && chosen.id === adventure.id ? ' selected' : ''}>${escapeHtml(adventure.title)}${adventure.status === 'active' ? ' (running)' : ''}</option>`).join('')}
      </select>
    </label>
    <label class="art-form-label">World-map marker <span class="muted small">(optional: one of the adventure's)</span>
      <select name="marker_id" data-map-marker>
        <option value="">None</option>
        ${(chosen ? chosen.markers : []).map(marker => `<option value="${marker.id}"${Number(markerId) === marker.id ? ' selected' : ''}>${escapeHtml(marker.name)} (${escapeHtml(marker.hex)})</option>`).join('')}
      </select>
    </label>`;
}

const PLACE_SCRIPT = `
  <script>
    (() => {
      const data = document.getElementById('battle-map-adventures');
      if (!data || window.battleMapPlaceReady) return;
      window.battleMapPlaceReady = true;
      const adventures = JSON.parse(data.textContent);
      document.addEventListener('change', event => {
        const select = event.target.closest('[data-map-adventure]');
        if (!select) return;
        const marker = select.form.querySelector('[data-map-marker]');
        const chosen = adventures.find(adventure => String(adventure.id) === select.value);
        marker.replaceChildren(new Option('None', ''), ...(chosen ? chosen.markers : []).map(entry => new Option(entry.name + ' (' + entry.hex + ')', entry.id)));
      });
    })();
  </script>`;

function mapCardHtml(map, adventures, returnTo) {
  return `
    <figure class="battle-map-card${map.hidden ? ' is-hidden' : ''}" id="battle-map-${map.id}" data-map-search="${escapeHtml(`${map.name} ${map.note} ${map.adventureTitle || ''} ${map.markerName || ''}`.toLowerCase())}">
      <a class="battle-map-image" href="${escapeHtml(map.url)}" target="_blank" rel="noopener" title="Open full size"><img src="${escapeHtml(map.thumbUrl)}" alt="${escapeHtml(map.name)}" loading="lazy"></a>
      <figcaption>
        <strong>${escapeHtml(map.name)}</strong>
        <span class="battle-map-tags">
          ${map.markerName ? `<a class="tag" href="/admin?tab=map&hex=${encodeURIComponent(map.markerHex)}" title="On the world map">📍 ${escapeHtml(map.markerName)} · ${escapeHtml(map.markerHex)}</a>` : ''}
          ${map.hidden ? '<span class="tag gold" title="Only the adventure\'s DM, the Root DM and whoever uploaded it see it">🙈 Hidden</span>' : ''}
        </span>
        ${map.note ? `<span class="small battle-map-note">${escapeHtml(map.note)}</span>` : ''}
        <span class="muted small">${map.width && map.height ? `${map.width}×${map.height} px · ` : ''}${escapeHtml(map.uploadedBy || '')}${map.uploadedBy ? ', ' : ''}${escapeHtml(date(map.createdAt))}</span>
        <span class="token-actions">
          <a class="btn btn-small btn-secondary" href="${escapeHtml(map.url)}?download=1" title="Download the image (for Owlbear)">⬇ Download</a>
          <a class="btn btn-small btn-secondary" href="${escapeHtml(map.url)}" target="_blank" rel="noopener" title="Open full size">↗</a>
        </span>
      </figcaption>
      ${map.canEdit ? `
      <details class="token-edit">
        <summary class="small">✏️ Edit</summary>
        <form method="POST" action="/admin/battle-maps/update" class="art-tag-form">
          <input type="hidden" name="id" value="${map.id}">
          <input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">
          <label class="art-form-label">Name <input type="text" name="name" value="${escapeHtml(map.name)}" maxlength="100" required></label>
          <label class="art-form-label">Note <textarea name="note" rows="2" maxlength="1000">${escapeHtml(map.note)}</textarea></label>
          ${placeFieldsHtml(adventures, map)}
          <label class="small"><input type="hidden" name="hidden" value="0"><input type="checkbox" name="hidden" value="1"${map.hidden ? ' checked' : ''}> 🙈 Hidden from other DMs <span class="muted">(the adventure's DM, the Root DM and you still see it)</span></label>
          <div class="art-form-actions"><button type="submit" class="btn btn-small btn-green">Save</button></div>
        </form>
        <form method="POST" action="/admin/battle-maps/delete" class="art-form-actions" onsubmit="return confirm('Delete this map for good?')">
          <input type="hidden" name="id" value="${map.id}">
          <input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">
          <button type="submit" class="btn btn-small btn-red">🗑 Delete</button>
        </form>
      </details>` : ''}
    </figure>`;
}

function uploadFormHtml(adventures, query) {
  return `
    <details class="card token-upload" id="battle-map-upload"${query.upload ? ' open' : ''}>
      <summary><strong>⬆ Upload maps</strong> <span class="muted small">PNG, JPG, WebP or GIF, up to 50 MB each</span></summary>
      <form class="art-tag-form" id="battle-map-upload-form">
        <label class="art-form-label">Map images <span class="muted small">(several at once: all for the same adventure)</span>
          <input type="file" name="files" accept="image/png,image/jpeg,image/webp,image/gif" multiple required>
        </label>
        <div class="token-form-row">${placeFieldsHtml(adventures, { adventureId: query.adventure, markerId: query.marker })}</div>
        <div class="token-form-row">
          <label class="art-form-label">Name <span class="muted small">(empty: the file's name)</span> <input type="text" name="name" maxlength="100" placeholder="The ambush, Floor 2…"></label>
          <label class="art-form-label">Note <span class="muted small">(optional)</span> <input type="text" name="note" maxlength="1000"></label>
        </div>
        <label class="small"><input type="checkbox" name="hidden" value="1"> 🙈 Hide from other DMs <span class="muted">(only the adventure's DM, the Root DM and you will see it)</span></label>
        <div class="art-form-actions">
          <span class="muted small" id="battle-map-upload-status" role="status"></span>
          <button type="submit" class="btn btn-green">Upload</button>
        </div>
      </form>
    </details>
    <script>
      (() => {
        const form = document.getElementById('battle-map-upload-form');
        const status = document.getElementById('battle-map-upload-status');
        const call = async (path, body, raw) => {
          const response = await fetch('/api/battle-maps/uploads' + path, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
            body: raw ? body : JSON.stringify(body)
          });
          const result = await response.json().catch(() => null);
          if (!result) throw new Error(response.status === 413 ? 'the server refused it as too large' : 'the server answered ' + response.status + '; try again');
          if (!response.ok) throw new Error(result.error || 'upload failed');
          return result;
        };
        // A small preview, made here (the server has no image tools): { blob, width, height }.
        const preview = async file => {
          try {
            const bitmap = await createImageBitmap(file);
            const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
            const size = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
            return { blob, ...size };
          } catch {
            return { blob: null, width: null, height: null };
          }
        };
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const files = [...form.elements.files.files];
          if (!files.length) return;
          if (!form.elements.adventure_id.value) { status.textContent = 'Choose the adventure first.'; return; }
          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          const ids = [];
          try {
            for (const [index, file] of files.entries()) {
              const label = files.length > 1 ? (index + 1) + ' of ' + files.length + ', ' : '';
              try {
                status.textContent = 'Preparing ' + label + file.name + '…';
                const small = await preview(file);
                const { uploadId, pieceBytes } = await call('', { size: file.size });
                for (let offset = 0; offset < file.size; offset += pieceBytes) {
                  status.textContent = 'Uploading ' + label + Math.round(offset / file.size * 100) + '%…';
                  await call('/' + uploadId + '/pieces?offset=' + offset, file.slice(offset, offset + pieceBytes), true);
                }
                if (small.blob) await call('/' + uploadId + '/thumb', small.blob, true).catch(() => null);
                const typed = form.elements.name.value.trim();
                const { id } = await call('/' + uploadId + '/finish', {
                  adventureId: form.elements.adventure_id.value,
                  markerId: form.elements.marker_id.value,
                  name: typed ? (files.length > 1 ? typed + ' ' + (index + 1) : typed) : file.name.replace(/\\.[^.]+$/, ''),
                  note: form.elements.note.value,
                  hidden: form.elements.hidden.checked,
                  width: small.width,
                  height: small.height
                });
                ids.push(id);
              } catch (error) {
                throw new Error(file.name + ': ' + error.message);
              }
            }
            location.href = '/admin?tab=battle-maps&adventure=' + encodeURIComponent(form.elements.adventure_id.value) + '&status=battle_map_uploaded&n=' + ids.length + '&new=' + ids[0] + '#battle-map-' + ids[0];
          } catch (error) {
            status.textContent = error.message + (ids.length ? ' (' + ids.length + ' uploaded before it)' : '');
            button.disabled = false;
          }
        });
      })();
    </script>`;
}

// An adventure's maps on its table page, for the DMs who may see them.
function battleMapStripHtml(user, adventureId) {
  if (!user || user.role !== 'admin') return '';
  const maps = db.listBattleMaps(user, { adventureId });
  return `
    <section class="card battle-map-strip">
      <div class="token-strip-head">
        <strong>🗺 Owlbear maps</strong> <span class="muted small">DMs only</span>
        <a class="small" href="/admin?tab=battle-maps&adventure=${Number(adventureId)}&upload=1#battle-map-upload">+ Upload a map</a>
        ${maps.length ? `<a class="small" href="/admin?tab=battle-maps&adventure=${Number(adventureId)}">All of them</a>` : ''}
      </div>
      ${maps.length ? `<div class="battle-map-mini-list">${maps.map(map => `
        <a class="battle-map-mini" href="/admin?tab=battle-maps&adventure=${Number(adventureId)}#battle-map-${map.id}" title="${escapeHtml(map.note || map.name)}">
          <img src="${escapeHtml(map.thumbUrl)}" alt="" loading="lazy">
          <span class="small">${escapeHtml(map.name)}${map.markerName ? ` · 📍 ${escapeHtml(map.markerName)}` : ''}${map.hidden ? ' 🙈' : ''}</span>
        </a>`).join('')}</div>` : '<p class="muted small">No maps from this adventure yet.</p>'}
    </section>`;
}

function renderBattleMapsTab(ctx) {
  const { req, isAdmin, currentUser } = ctx;
  if (!isAdmin) return '<section class="card"><p class="muted">Owlbear maps are for DMs.</p></section>';
  const query = req.query;
  if (!query.err) {
    const banners = {
      battle_map_uploaded: `<div class="alert green">🗺 Uploaded ${Number(query.n) || 0} map${Number(query.n) === 1 ? '' : 's'}.</div>`,
      battle_map_saved: '<div class="alert green">🗺 Map saved.</div>',
      battle_map_deleted: '<div class="alert green">🗑 Map deleted.</div>'
    };
    if (banners[query.status]) ctx.setStatusBanner(banners[query.status]);
  }
  const adventures = db.listBattleMapAdventures(currentUser);
  const adventureId = Number(query.adventure) > 0 ? Number(query.adventure) : null;
  const maps = db.listBattleMaps(currentUser, { adventureId });
  const returnTo = `/admin?tab=battle-maps${adventureId ? `&adventure=${adventureId}` : ''}`;
  // By adventure, the newest map's adventure first; a deleted adventure's maps last.
  const byAdventure = new Map();
  for (const map of maps) {
    const key = map.adventureId || 0;
    if (!byAdventure.has(key)) byAdventure.set(key, []);
    byAdventure.get(key).push(map);
  }
  const groups = [...byAdventure.entries()].sort(([a], [b]) => (a === 0) - (b === 0));
  const withMaps = new Set(db.listBattleMaps(currentUser).map(map => map.adventureId));

  return `
    <section class="card">
      <h3>🗺 Owlbear Maps</h3>
      <p class="muted small">The battle maps used in adventures, each with its adventure and, if you like, the world-map marker where it happened. Only DMs see them; a 🙈 hidden map only its adventure's DM, the Root DM and whoever uploaded it. ⬇ Download a map to put it back into Owlbear.</p>
      <form method="GET" action="/admin" class="chronicle-filters">
        <input type="hidden" name="tab" value="battle-maps">
        <select name="adventure" aria-label="Adventure" onchange="this.form.submit()">
          <option value="">Every adventure (${db.listBattleMaps(currentUser).length})</option>
          ${adventures.filter(adventure => withMaps.has(adventure.id) || adventure.id === adventureId).map(adventure => `<option value="${adventure.id}"${adventure.id === adventureId ? ' selected' : ''}>${escapeHtml(adventure.title)}</option>`).join('')}
        </select>
        <input type="search" id="battle-map-search" placeholder="Search name, note, marker…" aria-label="Search maps">
        <noscript><button type="submit" class="btn btn-small">Filter</button></noscript>
      </form>
    </section>
    ${uploadFormHtml(adventures, { ...query, adventure: query.adventure || '' })}
    ${groups.length ? groups.map(([id, list]) => `
      <section class="card battle-map-group" data-map-group>
        <h3>${id ? `<a href="/admin?tab=adventures&table=${id}">${escapeHtml(list[0].adventureTitle)}</a>` : '<span class="muted">Adventure deleted</span>'} <span class="muted small">${list.length} map${list.length === 1 ? '' : 's'}</span>
          ${id ? `<a class="small" href="/admin?tab=battle-maps&adventure=${id}&upload=1#battle-map-upload">+ another</a>` : ''}</h3>
        <div class="battle-map-grid">${list.map(map => mapCardHtml(map, adventures, `${returnTo}#battle-map-${map.id}`)).join('')}</div>
      </section>`).join('') : `<section class="card"><p class="muted">${adventureId ? 'No maps from this adventure yet.' : 'No maps yet: upload the first above.'}</p></section>`}
    <script type="application/json" id="battle-map-adventures">${json(adventures)}</script>
    ${PLACE_SCRIPT}
    <script>
      (() => {
        const search = document.getElementById('battle-map-search');
        search.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
        search.addEventListener('input', () => {
          const words = search.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
          document.querySelectorAll('[data-map-search]').forEach(card => { card.hidden = !words.every(word => card.dataset.mapSearch.includes(word)); });
          document.querySelectorAll('[data-map-group]').forEach(group => { group.hidden = !group.querySelector('[data-map-search]:not([hidden])'); });
        });
      })();
    </script>`;
}

module.exports = renderBattleMapsTab;
module.exports.battleMapStripHtml = battleMapStripHtml;
