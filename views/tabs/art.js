// views/tabs/art.js — "Art" tab: art of the characters posted in the Discord
// art channel (art.js, db/art.js), filterable by character and adventure. An
// image opens large with who is in it. DMs import the channel's history,
// sort what nobody tagged yet ("To sort") and keep memes and screenshots out
// (Not art). artStripHtml is the row of thumbnails on a sheet or adventure.

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

const date = value => (value ? String(value).slice(0, 10) : '');
const when = value => (value ? `${String(value).replace('T', ' ').slice(0, 16)} UTC` : '');

function scanStatusHtml() {
  const status = db.getArtScanStatus() || {};
  const imported = status.import;
  const poll = status.poll;
  const lines = [];
  if (imported && imported.running && require('../../art').isRunning()) lines.push(`⏳ Importing the channel's history (started ${escapeHtml(when(imported.startedAt))})… reload in a minute.`);
  else if (imported && imported.at) {
    lines.push(imported.error
      ? `⚠️ Last import (${escapeHtml(when(imported.at))}) failed: ${escapeHtml(imported.error)}`
      : `Last import ${escapeHtml(when(imported.at))}${imported.by ? ` by ${escapeHtml(imported.by)}` : ''}: ${Number(imported.messages) || 0} messages read, ${Number(imported.found) || 0} new images.`);
  } else lines.push('The channel\'s history hasn\'t been imported yet.');
  if (poll && poll.at) {
    lines.push(poll.error
      ? `⚠️ Looking for new posts failed (${escapeHtml(when(poll.at))}): ${escapeHtml(poll.error)}`
      : `Grimbold last looked for new posts ${escapeHtml(when(poll.at))}${poll.found ? ` and found ${Number(poll.found)} images` : ''}.`);
  }
  const latest = (poll && poll.at && (!imported || poll.at > (imported.at || '')) ? poll : imported) || {};
  const warning = latest.contentMissing
    ? '<p class="alert red">⚠️ Discord sends Grimbold the messages but not what is in them. Switch on <strong>Message Content Intent</strong> in the Discord Developer Portal (your app → Bot → Privileged Gateway Intents), then import again.</p>'
    : '';
  return `${warning}<p class="muted small">${lines.join('<br>')}</p>`;
}

const names = image => [...image.characters.map(character => character.name), ...(image.figures || []).map(figure => figure.label)]
  .map(name => escapeHtml(name)).join(', ');

// The artist's credit: on a thumbnail, and as a banner on the opened image.
function thumb(image, href) {
  const picture = image.thumbUrl
    ? `<img src="${escapeHtml(image.thumbUrl)}" alt="${names(image) || 'Art'}" loading="lazy">`
    : `<span class="art-missing" title="${escapeHtml(image.download_error || 'Not copied yet')}">🖼<br><span class="small">${image.download_error ? 'No copy' : 'Copying…'}</span></span>`;
  const credit = image.artist_name ? `<span class="art-credit-badge">🖌 ${escapeHtml(image.artist_name)}</span>` : '';
  return `<a class="art-thumb" href="${href}">${picture}${credit}</a>`;
}

function creditBanner(image, { isAdmin }) {
  if (!image.artist_name) {
    return `<p class="art-credit-banner is-missing">🖌 Artist not credited yet${isAdmin ? ': add them in the form' : ': use Tag art in Discord to add them'}.</p>`;
  }
  return `<p class="art-credit-banner">🖌 Art by <a href="/admin?tab=art${image.is_meme ? '&view=memes' : image.is_reference ? '&view=references' : ''}&artist=${encodeURIComponent(image.artist_name)}" title="All art by ${escapeHtml(image.artist_name)}"><strong>${escapeHtml(image.artist_name)}</strong></a>${image.artist_url ? ` <a class="art-credit-link" href="${escapeHtml(image.artist_url)}" target="_blank" rel="noopener">their page ↗</a>` : ''}</p>`;
}

// Everyone besides the characters: ticked chips for those tagged, and a box
// to add more (suggesting NPCs, familiars and names used before).
function othersHtml(image) {
  const figures = image.figures || [];
  return `
    <div class="art-picker" data-others>
      <input type="hidden" name="figures_form" value="1">
      <div class="art-picker-list art-others-list" data-others-list>
        ${figures.map(figure => `<label class="art-chip"><input type="checkbox" name="figure_ids" value="${figure.id}" checked><span>${escapeHtml(figure.label)}</span></label>`).join('')}
        <span class="muted small" data-others-empty${figures.length ? ' hidden' : ''}>Nobody else yet.</span>
      </div>
      <div class="art-picker-head">
        <input type="text" name="others" list="art-figure-list" data-others-input placeholder="Add an NPC, a familiar or anyone else…" autocomplete="off" aria-label="Add someone else">
        <button type="button" class="btn btn-small btn-secondary" data-others-add>Add</button>
      </div>
    </div>`;
}

function artistHtml(image) {
  return `
    <div class="art-artist-fields">
      <label class="art-form-label">🖌 Artist${image.artist_by && ARTIST_BY[image.artist_by] ? ` <span class="muted small">(${ARTIST_BY[image.artist_by]})</span>` : ''}
        <input type="text" name="artist" list="art-artist-list" value="${escapeHtml(image.artist_name || '')}" placeholder="Who drew it?" maxlength="100" autocomplete="off">
      </label>
      <label class="art-form-label">Their page <span class="muted small">(optional)</span>
        <input type="url" name="artist_url" value="${escapeHtml(image.artist_url || '')}" placeholder="https://…" maxlength="300">
      </label>
      ${image.poster_name && image.poster_name !== image.artist_name ? `<button type="button" class="btn btn-small btn-secondary" data-fill-artist="${escapeHtml(image.poster_name)}">${escapeHtml(image.poster_name)} drew it</button>` : ''}
    </div>`;
}

// A row of thumbnails, newest first, with a link to the rest in the tab.
function artStripHtml({ characterId, adventureId, title = '🎨 Art', limit = 12 }) {
  const images = db.listArtImages({ characterId, adventureId, limit: limit + 1 });
  if (!images.length) return '';
  const filter = characterId ? `&character=${Number(characterId)}` : `&adventure=${Number(adventureId)}`;
  const total = characterId ? db.artCounts().byCharacter.get(Number(characterId)) : db.artCounts().byAdventure.get(Number(adventureId));
  return `
    <details class="sheet-card art-strip" open>
      <summary><strong>${title}</strong> <span class="muted small">${Number(total) || images.length} image${(Number(total) || images.length) === 1 ? '' : 's'}</span></summary>
      <div class="art-grid art-grid-small">
        ${images.slice(0, limit).map(image => `<figure>${thumb(image, `/admin?tab=art${filter}&art=${image.id}#art-viewer`)}</figure>`).join('')}
      </div>
      ${images.length > limit ? `<p class="small"><a href="/admin?tab=art${filter}">See all in the Art tab →</a></p>` : ''}
    </details>`;
}

// Characters to tick, with a search box: the poster's own first (they are
// usually in the picture), then everyone else; the dead marked †.
function pickerHtml(characters, selected, { posterDiscordId, posterTag } = {}) {
  const chosen = new Set([].concat(selected).map(String));
  const chip = character => `
        <label class="art-chip"><input type="checkbox" name="character_ids" value="${character.id}"${chosen.has(String(character.id)) ? ' checked' : ''}><span>${escapeHtml(character.name)}${character.status === 'dead' ? ' †' : ''}</span></label>`;
  const own = posterDiscordId ? characters.filter(character => character.discord_id === posterDiscordId) : [];
  const others = characters.filter(character => !own.includes(character));
  return `
    <div class="art-picker" data-picker>
      <div class="art-picker-head">
        <input type="search" data-picker-filter placeholder="Find a character…" aria-label="Find a character" autocomplete="off">
        <span class="muted small" data-picker-count>${chosen.size} chosen</span>
      </div>
      <div class="art-picker-list">
        ${own.length ? `<p class="art-picker-group">${escapeHtml(posterTag || 'The poster')}'s characters</p>${own.map(chip).join('')}<p class="art-picker-group">Everyone else</p>` : ''}
        ${others.map(chip).join('')}
      </div>
    </div>`;
}

// The search boxes and counters of every picker on the page.
const PICKER_SCRIPT = `
  <script>
    (() => {
      const plain = text => String(text || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
      document.querySelectorAll('[data-picker]').forEach(picker => {
        const filter = picker.querySelector('[data-picker-filter]');
        const count = picker.querySelector('[data-picker-count]');
        const chips = [...picker.querySelectorAll('.art-chip')];
        const groups = [...picker.querySelectorAll('.art-picker-group')];
        const recount = () => { count.textContent = chips.filter(chip => chip.querySelector('input').checked).length + ' chosen'; };
        const apply = () => {
          const words = plain(filter.value).split(/\\s+/).filter(Boolean);
          chips.forEach(chip => { chip.hidden = !words.every(word => plain(chip.textContent).includes(word)); });
          groups.forEach(group => { group.hidden = words.length > 0; });
        };
        filter.addEventListener('input', apply);
        // Enter ticks the only match (and keeps the form from sending).
        filter.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const shown = chips.filter(chip => !chip.hidden);
          if (shown.length === 1) {
            const box = shown[0].querySelector('input');
            box.checked = !box.checked;
            filter.value = '';
            apply();
            recount();
          }
        });
        picker.addEventListener('change', recount);
      });
      document.querySelectorAll('[data-others]').forEach(box => {
        const input = box.querySelector('[data-others-input]');
        const list = box.querySelector('[data-others-list]');
        const empty = box.querySelector('[data-others-empty]');
        const add = () => {
          const names = input.value.split(/[,;]+/).map(name => name.trim()).filter(Boolean);
          const known = [...list.querySelectorAll('.art-chip span')].map(chip => plain(chip.textContent));
          names.filter(name => !known.includes(plain(name))).forEach(name => {
            const chip = document.createElement('label');
            chip.className = 'art-chip';
            const tick = Object.assign(document.createElement('input'), { type: 'checkbox', name: 'others', value: name, checked: true });
            const text = document.createElement('span');
            text.textContent = name;
            chip.append(tick, text);
            list.insertBefore(chip, empty);
          });
          empty.hidden = true;
          input.value = '';
          input.focus();
        };
        box.querySelector('[data-others-add]').addEventListener('click', add);
        input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); add(); } });
      });
      document.querySelectorAll('[data-fill-artist]').forEach(button => button.addEventListener('click', () => {
        const field = button.closest('form').querySelector('input[name="artist"]');
        field.value = button.dataset.fillArtist;
        field.focus();
      }));
    })();
  </script>`;

function adventureChoice(image) {
  if (image.adventure_by === 'none') return 'none';
  return image.adventure_id && image.adventure_by !== 'guess' ? String(image.adventure_id) : 'guess';
}

function adventureOptions(image, adventures) {
  const value = adventureChoice(image);
  const guessed = image.adventure_by === 'guess' && image.adventure_title ? ` (now: ${escapeHtml(image.adventure_title)})` : '';
  return `
    <option value="guess"${value === 'guess' ? ' selected' : ''}>🔮 Guess from the characters${guessed}</option>
    <option value="none"${value === 'none' ? ' selected' : ''}>No adventure</option>
    ${adventures.map(adventure => `<option value="${adventure.id}"${value === String(adventure.id) ? ' selected' : ''}>${escapeHtml(adventure.title)}${adventure.fits ? ' ✓' : ''}</option>`).join('')}`;
}

const ARTIST_BY = { name: 'named in the post', poster: 'the poster, by default', discord: 'set in Discord', dm: 'set by a DM' };
const TAGGED_BY = { name: 'named in the post', discord: 'tagged in Discord', dm: 'set by a DM' };

// canEdit: DMs and art editors, and a player on their own upload.
function viewerHtml(image, { canEdit, characters, back }) {
  const isAdmin = canEdit;
  // Its names link to the same view (Memes, Reference) filtered by them.
  const inView = image.is_meme ? '&view=memes' : image.is_reference ? '&view=references' : '';
  const adventures = isAdmin ? db.listArtAdventureChoices({ characterIds: image.characters.map(character => character.id), postedAt: image.posted_at }) : [];
  return `
    <section class="card art-viewer" id="art-viewer">
      <div class="art-viewer-head">
        <div>
          <h3>${image.characters.length || image.figures.length
            ? [...image.characters.map(character => `<a href="/admin?tab=art${inView}&who=c${character.id}">${escapeHtml(character.name)}</a>`),
              ...image.figures.map(figure => `<a href="/admin?tab=art${inView}&who=f${figure.id}" class="art-figure">${escapeHtml(figure.label)}</a>`)].join(', ')
            : '<span class="tag red">Nobody tagged yet</span>'}</h3>
          ${creditBanner(image, { isAdmin })}
          <p class="muted small">
            ${image.adventure_id ? `<a href="/admin?tab=art${inView}&adventure=${image.adventure_id}">${escapeHtml(image.adventure_title)}</a>${image.adventure_by === 'guess' ? ' <span class="tag">guessed</span>' : ''}` : 'No adventure'}
            ${image.posted_by_tag ? ` · ${image.uploaded ? 'uploaded' : 'posted'} by ${escapeHtml(image.posted_by_tag)}` : ''}${image.posted_at ? ` on ${escapeHtml(date(image.posted_at))}` : ''}
            ${image.not_art ? ' · <span class="tag red">Not art</span>' : image.is_meme ? ' · <span class="tag">😂 Meme</span>' : image.is_reference ? ' · <span class="tag">📌 Reference</span>' : ''}
          </p>
          ${image.message_text ? `<p class="art-caption">${escapeHtml(image.message_text)}</p>` : ''}
        </div>
        <div class="chronicle-actions">
          ${image.imageUrl ? `<a class="btn btn-small btn-secondary" href="${escapeHtml(image.imageUrl)}" target="_blank" rel="noopener">Full size ↗</a>` : ''}
          ${image.messageUrl ? `<a class="btn btn-small btn-secondary" href="${escapeHtml(image.messageUrl)}" target="_blank" rel="noopener">Discord post ↗</a>` : ''}
          <a class="btn btn-small btn-secondary" href="${back}">Close</a>
        </div>
      </div>
      <div class="art-viewer-body${isAdmin ? ' with-form' : ''}">
      ${image.imageUrl
        ? `<a href="${escapeHtml(image.imageUrl)}" target="_blank" rel="noopener" class="art-full-link"><img class="art-full" src="${escapeHtml(image.imageUrl)}" alt="${names(image) || 'Art'}"></a>`
        : `<p class="alert red">Grimbold has no copy of this image${image.download_error ? `: ${escapeHtml(image.download_error)}` : ' yet'}.</p>`}
      ${isAdmin ? `
      <div class="art-tag-panel">
        <h4>🛡 Tag this image${image.tagged_by ? ` <span class="muted small">(${escapeHtml(TAGGED_BY[image.tagged_by] || image.tagged_by)})</span>` : ''}</h4>
        <form method="POST" action="/admin/art/update" class="art-tag-form">
          <input type="hidden" name="id" value="${image.id}">
          <input type="hidden" name="return_to" value="${escapeHtml(`${back}&art=${image.id}`)}">
          <p class="art-form-label">Who is in it?</p>
          ${pickerHtml(characters, image.characters.map(character => character.id), { posterDiscordId: image.posted_by_discord_id, posterTag: image.posted_by_tag })}
          <p class="art-form-label">Anyone else? <span class="muted small">(NPCs, familiars, characters from outside our games)</span></p>
          ${othersHtml(image)}
          ${artistHtml(image)}
          ${image.uploaded ? `<label class="art-form-label">Caption <span class="muted small">(what it is, where it's from)</span>
            <textarea name="caption" rows="2" maxlength="2000">${escapeHtml(image.message_text || '')}</textarea>
          </label>` : ''}
          <label class="art-form-label">Adventure <span class="muted small">(✓ = they were all in it)</span>
            <select name="adventure">${adventureOptions(image, adventures)}</select>
          </label>
          <div class="art-form-actions">
            <fieldset class="art-category">
              <legend class="visually-hidden">Category</legend>
              ${[['art', '🎨 Art'], ['meme', '😂 Meme'], ['reference', '📌 Reference'], ['not_art', '🚫 Not art']].map(([value, label]) =>
                `<label><input type="radio" name="category" value="${value}"${image.category === value ? ' checked' : ''}> ${label}</label>`).join('')}
            </fieldset>
            <button type="submit" class="btn btn-green">Save</button>
          </div>
        </form>
        ${image.uploaded ? `<form method="POST" action="/admin/art/delete" class="art-form-actions" onsubmit="return confirm('Delete this uploaded image for good?')">
          <input type="hidden" name="id" value="${image.id}">
          <button type="submit" class="btn btn-small btn-red">🗑 Delete upload</button>
        </form>` : ''}
      </div>` : ''}
      </div>
    </section>`;
}

// To sort: each image beside a form for who is in it and its adventure.
function sortingHtml(images, { characters, keep }) {
  if (!images.length) return '<p class="muted">Nothing to sort: every image has somebody in it or is marked Not art.</p>';
  const adventures = db.listArtAdventureChoices({});
  return `
    <p class="muted small">Tick everyone in the picture (type to find them; Enter ticks the only match), add NPCs, familiars or anyone else, credit the artist, choose the adventure or leave it to Grimbold's guess, and save. A saved picture moves to the gallery.</p>
    <div class="art-sort">
      ${images.map(image => `
        <form method="POST" action="/admin/art/update" class="art-sort-item" id="sort-${image.id}">
          <input type="hidden" name="id" value="${image.id}">
          <input type="hidden" name="return_to" value="/admin?tab=art&view=unsorted">
          <div class="art-sort-image">
            ${image.imageUrl
              ? `<a href="/admin?tab=art${keep}&art=${image.id}#art-viewer"><img src="${escapeHtml(image.thumbUrl)}" alt="To sort" loading="lazy"></a>`
              : thumb(image, `/admin?tab=art${keep}&art=${image.id}#art-viewer`)}
            <p class="muted small">${image.posted_by_tag ? escapeHtml(image.posted_by_tag) : ''}${image.posted_at ? ` · ${escapeHtml(date(image.posted_at))}` : ''}${image.messageUrl ? ` · <a href="${escapeHtml(image.messageUrl)}" target="_blank" rel="noopener">Discord ↗</a>` : ''}</p>
            ${image.message_text ? `<p class="art-caption small">“${escapeHtml(image.message_text.slice(0, 200))}”</p>` : ''}
          </div>
          <div class="art-sort-form">
            ${pickerHtml(characters, [], { posterDiscordId: image.posted_by_discord_id, posterTag: image.posted_by_tag })}
            ${othersHtml(image)}
            ${artistHtml(image)}
            <label class="art-form-label">Adventure
              <select name="adventure">${adventureOptions(image, adventures)}</select>
            </label>
            <div class="art-form-actions">
              <button type="submit" name="category" value="meme" class="btn btn-small btn-secondary">😂 Meme</button>
              <button type="submit" name="category" value="reference" class="btn btn-small btn-secondary">📌 Reference</button>
              <button type="submit" name="category" value="not_art" class="btn btn-small btn-secondary">🚫 Not art</button>
              <button type="submit" class="btn btn-green">Save</button>
            </div>
          </div>
        </form>`).join('')}
    </div>`;
}

// DMs: who else may tag and sort art, by Discord ID.
function editorsHtml() {
  const editors = db.listArtEditors();
  return `
    <section class="card" id="art-editors">
      <details${editors.length ? '' : ' open'}>
        <summary><strong>🛡 Art editors</strong> <span class="muted small">${editors.length} player${editors.length === 1 ? '' : 's'}</span></summary>
        <p class="muted small">Players on this list tag and sort art here as DMs do: who is in a picture, the adventure, the artist, and Art / Meme / Not art. Importing the channel stays with the DMs.</p>
        ${editors.length ? `<ul class="art-editors">${editors.map(editor => `<li><code>${escapeHtml(editor.discordId)}</code> ${editor.tag ? escapeHtml(editor.tag) : '<span class="muted small">(no panel account with this ID yet)</span>'}</li>`).join('')}</ul>` : ''}
        <form method="POST" action="/admin/art/editors" class="art-tag-form">
          <label class="art-form-label">Discord IDs, one per line <span class="muted small">(right-click a member → Copy User ID)</span>
            <textarea name="discord_ids" rows="4">${escapeHtml(editors.map(editor => editor.discordId).join('\n'))}</textarea>
          </label>
          <div class="art-form-actions"><button type="submit" class="btn btn-green">Save</button></div>
        </form>
      </details>
    </section>`;
}

// Reference material: anyone logged in uploads images (they then open to be tagged).
function uploadHtml() {
  return `
    <form class="art-upload" id="art-upload">
      <h4>📌 Add reference material</h4>
      <p class="muted small">Upload images from outside the Discord channel: character references, outfits, maps, mood boards. PNG, JPG, WebP or GIF, 25 MB each at most. After uploading you can tag who is in it and the adventure.</p>
      <label class="art-form-label">Images <input type="file" name="files" accept="image/png,image/jpeg,image/webp,image/gif" multiple required></label>
      <label class="art-form-label">Caption <span class="muted small">(optional: what it is, where it's from)</span>
        <textarea name="caption" rows="2" maxlength="2000"></textarea>
      </label>
      <div class="art-form-actions">
        <span class="muted small" id="art-upload-status" role="status"></span>
        <button type="submit" class="btn btn-green">Upload</button>
      </div>
    </form>
    <script>
      (() => {
        const form = document.getElementById('art-upload');
        const status = document.getElementById('art-upload-status');
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const files = [...form.elements.files.files];
          if (!files.length) return;
          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          const ids = [];
          try {
            for (const [index, file] of files.entries()) {
              status.textContent = 'Uploading ' + (index + 1) + ' of ' + files.length + '…';
              const response = await fetch('/api/art/upload', {
                method: 'POST', credentials: 'same-origin', body: file,
                headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Caption': encodeURIComponent(form.elements.caption.value) }
              });
              const body = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(file.name + ': ' + (body.error || 'upload failed'));
              ids.push(body.id);
            }
            location.href = '/admin?tab=art&view=references&art=' + ids[0] + '#art-viewer';
          } catch (error) {
            status.textContent = error.message + (ids.length ? ' (' + ids.length + ' uploaded before it)' : '');
            button.disabled = false;
          }
        });
      })();
    </script>`;
}

module.exports = function renderArtTab(ctx) {
  // isAdmin here: may tag and sort (DMs and art editors); isDm: imports and the editors list.
  const { req, isAdmin: isDm, currentUser } = ctx;
  const isAdmin = isDm || db.canEditArt(currentUser);
  const query = req.query;
  if (!query.err) {
    const banners = {
      art_updated: '<div class="alert green">🎨 Image saved.</div>',
      art_editors_saved: '<div class="alert green">🎨 Art editors saved.</div>',
      art_deleted: '<div class="alert green">🗑 Upload deleted.</div>',
      art_import_started: '<div class="alert green">🎨 Grimbold is reading the art channel\'s history. Reload in a minute to see what he found.</div>',
      art_import_busy: '<div class="alert red">⏳ Grimbold is already reading the channel; try again in a minute.</div>'
    };
    if (banners[query.status]) ctx.setStatusBanner(banners[query.status]);
  }
  const characters = db.prepare(`
    SELECT c.id, c.name, c.status, p.discord_id FROM characters c LEFT JOIN players p ON p.id = c.player_id
    ORDER BY (c.status = 'dead'), c.name COLLATE NOCASE
  `).all();
  const adventures = db.prepare("SELECT id, title FROM adventures WHERE status != 'cancelled' ORDER BY id DESC").all();
  const view = ['memes', 'references'].includes(query.view) || (isAdmin && ['unsorted', 'not_art'].includes(query.view)) ? query.view : 'gallery';
  const who = String(query.who || (Number(query.character) > 0 ? `c${Number(query.character)}` : ''));
  // Gallery, Memes and Reference filter by who is in it, adventure and artist.
  const filtered = ['gallery', 'memes', 'references'].includes(view);
  const characterId = filtered && /^c\d+$/.test(who) ? Number(who.slice(1)) : null;
  const figureId = filtered && /^f\d+$/.test(who) ? Number(who.slice(1)) : null;
  const adventureId = filtered && Number(query.adventure) > 0 ? Number(query.adventure) : null;
  const artist = filtered && query.artist ? String(query.artist) : '';
  const counts = db.artCounts();
  const images = db.listArtImages({ view, characterId, figureId, adventureId, artist });
  // The filters' choices and counts come from this view's pictures.
  const inView = filtered ? db.listArtImages({ view }) : [];
  const tally = (list, keyOf) => {
    const map = new Map();
    for (const entry of list) for (const key of keyOf(entry)) map.set(key, (map.get(key) || 0) + 1);
    return map;
  };
  const byCharacter = tally(inView, entry => entry.characters.map(character => character.id));
  const byFigure = tally(inView, entry => entry.figures.map(figure => figure.id));
  const byAdventure = tally(inView, entry => (entry.adventure_id ? [entry.adventure_id] : []));
  const byArtist = tally(inView, entry => (entry.artist_name ? [entry.artist_name] : []));
  const figureLabels = new Map(inView.flatMap(entry => entry.figures.map(figure => [figure.id, figure.label])));
  const figures = [...byFigure.keys()].map(id => ({ id, label: figureLabels.get(id), count: byFigure.get(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const artists = [...byArtist.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const keep = `${view !== 'gallery' ? `&view=${view}` : ''}${characterId ? `&who=c${characterId}` : ''}${figureId ? `&who=f${figureId}` : ''}${adventureId ? `&adventure=${adventureId}` : ''}${artist ? `&artist=${encodeURIComponent(artist)}` : ''}`;
  const image = query.art ? db.getArtImage(query.art, { isAdmin: db.canEditArtImage(currentUser, query.art) }) : null;
  const canEditImage = Boolean(image && db.canEditArtImage(currentUser, image.id));
  const withForms = isAdmin || canEditImage;
  if (query.art && !image) ctx.setStatusBanner('<div class="alert red">⚠️ That image is not in the gallery.</div>');
  const withArt = characters.filter(character => byCharacter.has(character.id));
  const adventuresWithArt = adventures.filter(adventure => byAdventure.has(adventure.id));

  return `
    ${image ? viewerHtml(image, { canEdit: canEditImage, characters, back: `/admin?tab=art${keep}` }) : ''}
    <section class="card art">
      <div class="chronicles-head">
        <div>
          <h3>🎨 Art</h3>
          <p class="muted small">Art of the characters, posted in Discord. Say who is in a picture by naming them in the post (and the adventure, if you like), or right-click the post → <strong>Apps → Tag art</strong>.</p>
        </div>
        ${isDm ? '<form method="POST" action="/admin/art/import"><button type="submit" class="btn btn-small" title="Read every message in the art channel (and its threads) for images">📥 Import past messages</button></form>' : ''}
      </div>
      ${isDm ? scanStatusHtml() : ''}
      <form method="GET" action="/admin" class="chronicle-filters">
        <input type="hidden" name="tab" value="art">
        <select name="view" aria-label="Show" onchange="this.form.submit()">
          <option value="">🎨 Gallery (${counts.gallery})</option>
          <option value="memes"${view === 'memes' ? ' selected' : ''}>😂 Memes (${counts.memes})</option>
          <option value="references"${view === 'references' ? ' selected' : ''}>📌 Reference (${counts.references})</option>
          ${isAdmin ? `<option value="unsorted"${view === 'unsorted' ? ' selected' : ''}>To sort (${counts.unsorted})</option>
          <option value="not_art"${view === 'not_art' ? ' selected' : ''}>🚫 Not art (${counts.notArt})</option>` : ''}
        </select>
        ${filtered ? `
        <select name="who" aria-label="Who is in it" onchange="this.form.submit()">
          <option value="">Everyone</option>
          ${withArt.length ? `<optgroup label="Characters">
            ${withArt.map(character => `<option value="c${character.id}"${characterId === character.id ? ' selected' : ''}>${escapeHtml(character.name)} (${byCharacter.get(character.id)})</option>`).join('')}
          </optgroup>` : ''}
          ${figures.length ? `<optgroup label="NPCs, familiars and others">
            ${figures.map(figure => `<option value="f${figure.id}"${figureId === figure.id ? ' selected' : ''}>${escapeHtml(figure.label)} (${figure.count})</option>`).join('')}
          </optgroup>` : ''}
        </select>
        <select name="adventure" aria-label="Adventure" onchange="this.form.submit()">
          <option value="">All adventures</option>
          ${adventuresWithArt.map(adventure => `<option value="${adventure.id}"${adventureId === adventure.id ? ' selected' : ''}>${escapeHtml(adventure.title)} (${byAdventure.get(adventure.id)})</option>`).join('')}
        </select>
        <select name="artist" aria-label="Artist" onchange="this.form.submit()">
          <option value="">All artists</option>
          ${artists.map(entry => `<option value="${escapeHtml(entry.name)}"${artist === entry.name ? ' selected' : ''}>🖌 ${escapeHtml(entry.name)} (${entry.count})</option>`).join('')}
        </select>` : ''}
        <noscript><button type="submit" class="btn btn-small">Filter</button></noscript>
      </form>
      ${view === 'references' ? uploadHtml() : ''}
      ${view === 'unsorted'
        ? sortingHtml(images, { characters, keep })
        : images.length
          ? `<div class="art-grid">${images.map(entry => `
              <figure class="${image && image.id === entry.id ? 'is-current' : ''}">
                ${thumb(entry, `/admin?tab=art${keep}&art=${entry.id}#art-viewer`)}
                <figcaption>${names(entry) || '<span class="muted">nobody</span>'}${entry.adventure_title ? `<br><span class="muted small">${escapeHtml(entry.adventure_title)}</span>` : ''}${entry.artist_name ? `<br><span class="art-credit">🖌 ${escapeHtml(entry.artist_name)}</span>` : ''}</figcaption>
              </figure>`).join('')}</div>`
          : `<p class="muted">${view === 'not_art' ? 'Nothing marked Not art.' : view === 'memes' ? 'No memes yet: mark one with Tag art → 😂 Meme.' : view === 'references' ? 'No reference material yet: upload the first above.' : 'No art here yet.'}</p>`}
    </section>
    ${isDm ? editorsHtml() : ''}
    ${withForms ? `
    <datalist id="art-figure-list">${db.artFigureSuggestions().map(label => `<option value="${escapeHtml(label)}"></option>`).join('')}</datalist>
    <datalist id="art-artist-list">${[...new Set([...db.listKnownArtists(), ...db.prepare('SELECT DISTINCT posted_by_tag AS name FROM art_images WHERE posted_by_tag IS NOT NULL').all().map(row => row.name)])]
      .sort((a, b) => a.localeCompare(b)).map(name => `<option value="${escapeHtml(name)}"></option>`).join('')}</datalist>
    ${PICKER_SCRIPT}` : ''}
  `;
};

module.exports.artStripHtml = artStripHtml;
