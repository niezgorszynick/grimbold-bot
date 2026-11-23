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

const names = image => image.characters.map(character => escapeHtml(character.name)).join(', ');

function thumb(image, href) {
  const picture = image.thumbUrl
    ? `<img src="${escapeHtml(image.thumbUrl)}" alt="${names(image) || 'Art'}" loading="lazy">`
    : `<span class="art-missing" title="${escapeHtml(image.download_error || 'Not copied yet')}">🖼<br><span class="small">${image.download_error ? 'No copy' : 'Copying…'}</span></span>`;
  return `<a class="art-thumb" href="${href}">${picture}</a>`;
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

const TAGGED_BY = { name: 'named in the post', discord: 'tagged in Discord', dm: 'set by a DM' };

function viewerHtml(image, { isAdmin, characters, back }) {
  const adventures = isAdmin ? db.listArtAdventureChoices({ characterIds: image.characters.map(character => character.id), postedAt: image.posted_at }) : [];
  return `
    <section class="card art-viewer" id="art-viewer">
      <div class="art-viewer-head">
        <div>
          <h3>${image.characters.length ? image.characters.map(character => `<a href="/admin?tab=art&character=${character.id}">${escapeHtml(character.name)}</a>`).join(', ') : '<span class="tag red">Nobody tagged yet</span>'}</h3>
          <p class="muted small">
            ${image.adventure_id ? `<a href="/admin?tab=art&adventure=${image.adventure_id}">${escapeHtml(image.adventure_title)}</a>${image.adventure_by === 'guess' ? ' <span class="tag">guessed</span>' : ''}` : 'No adventure'}
            ${image.posted_by_tag ? ` · posted by ${escapeHtml(image.posted_by_tag)}` : ''}${image.posted_at ? ` on ${escapeHtml(date(image.posted_at))}` : ''}
            ${image.not_art ? ' · <span class="tag red">Not art</span>' : ''}
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
          <label class="art-form-label">Adventure <span class="muted small">(✓ = they were all in it)</span>
            <select name="adventure">${adventureOptions(image, adventures)}</select>
          </label>
          <div class="art-form-actions">
            <label class="art-check"><input type="hidden" name="not_art" value="0"><input type="checkbox" name="not_art" value="1"${image.not_art ? ' checked' : ''}> Not art (a meme, a screenshot)</label>
            <button type="submit" class="btn btn-green">Save</button>
          </div>
        </form>
      </div>` : ''}
      </div>
    </section>`;
}

// To sort: each image beside a form for who is in it and its adventure.
function sortingHtml(images, { characters, keep }) {
  if (!images.length) return '<p class="muted">Nothing to sort: every image has somebody in it or is marked Not art.</p>';
  const adventures = db.listArtAdventureChoices({});
  return `
    <p class="muted small">Tick everyone in the picture (type to find them; Enter ticks the only match), choose the adventure or leave it to Grimbold's guess, and save. A saved picture moves to the gallery.</p>
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
            <label class="art-form-label">Adventure
              <select name="adventure">${adventureOptions(image, adventures)}</select>
            </label>
            <div class="art-form-actions">
              <button type="submit" name="not_art" value="1" class="btn btn-small btn-secondary">🚫 Not art</button>
              <button type="submit" class="btn btn-green">Save</button>
            </div>
          </div>
        </form>`).join('')}
    </div>`;
}

module.exports = function renderArtTab(ctx) {
  const { req, isAdmin } = ctx;
  const query = req.query;
  if (!query.err) {
    const banners = {
      art_updated: '<div class="alert green">🎨 Image saved.</div>',
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
  const view = isAdmin && ['unsorted', 'not_art'].includes(query.view) ? query.view : 'gallery';
  const characterId = view === 'gallery' && Number(query.character) > 0 ? Number(query.character) : null;
  const adventureId = view === 'gallery' && Number(query.adventure) > 0 ? Number(query.adventure) : null;
  const counts = db.artCounts();
  const images = db.listArtImages({ view, characterId, adventureId });
  const keep = `${view !== 'gallery' ? `&view=${view}` : ''}${characterId ? `&character=${characterId}` : ''}${adventureId ? `&adventure=${adventureId}` : ''}`;
  const image = query.art ? db.getArtImage(query.art, { isAdmin }) : null;
  if (query.art && !image) ctx.setStatusBanner('<div class="alert red">⚠️ That image is not in the gallery.</div>');
  const withArt = characters.filter(character => counts.byCharacter.has(character.id));
  const adventuresWithArt = adventures.filter(adventure => counts.byAdventure.has(adventure.id));

  return `
    ${image ? viewerHtml(image, { isAdmin, characters, back: `/admin?tab=art${keep}` }) : ''}
    <section class="card art">
      <div class="chronicles-head">
        <div>
          <h3>🎨 Art</h3>
          <p class="muted small">Art of the characters, posted in Discord. Say who is in a picture by naming them in the post (and the adventure, if you like), or right-click the post → <strong>Apps → Tag art</strong>.</p>
        </div>
        ${isAdmin ? '<form method="POST" action="/admin/art/import"><button type="submit" class="btn btn-small" title="Read every message in the art channel (and its threads) for images">📥 Import past messages</button></form>' : ''}
      </div>
      ${isAdmin ? scanStatusHtml() : ''}
      <form method="GET" action="/admin" class="chronicle-filters">
        <input type="hidden" name="tab" value="art">
        ${isAdmin ? `<select name="view" aria-label="Show" onchange="this.form.submit()">
          <option value="">Gallery (${counts.gallery})</option>
          <option value="unsorted"${view === 'unsorted' ? ' selected' : ''}>To sort (${counts.unsorted})</option>
          <option value="not_art"${view === 'not_art' ? ' selected' : ''}>Not art (${counts.notArt})</option>
        </select>` : ''}
        ${view === 'gallery' ? `
        <select name="character" aria-label="Character" onchange="this.form.submit()">
          <option value="">All characters</option>
          ${withArt.map(character => `<option value="${character.id}"${characterId === character.id ? ' selected' : ''}>${escapeHtml(character.name)} (${counts.byCharacter.get(character.id)})</option>`).join('')}
        </select>
        <select name="adventure" aria-label="Adventure" onchange="this.form.submit()">
          <option value="">All adventures</option>
          ${adventuresWithArt.map(adventure => `<option value="${adventure.id}"${adventureId === adventure.id ? ' selected' : ''}>${escapeHtml(adventure.title)} (${counts.byAdventure.get(adventure.id)})</option>`).join('')}
        </select>` : ''}
        <noscript><button type="submit" class="btn btn-small">Filter</button></noscript>
      </form>
      ${view === 'unsorted'
        ? sortingHtml(images, { characters, keep })
        : images.length
          ? `<div class="art-grid">${images.map(entry => `
              <figure class="${image && image.id === entry.id ? 'is-current' : ''}">
                ${thumb(entry, `/admin?tab=art${keep}&art=${entry.id}#art-viewer`)}
                <figcaption>${names(entry) || '<span class="muted">nobody</span>'}${entry.adventure_title ? `<br><span class="muted small">${escapeHtml(entry.adventure_title)}</span>` : ''}</figcaption>
              </figure>`).join('')}</div>`
          : `<p class="muted">${view === 'not_art' ? 'Nothing marked Not art.' : 'No art here yet.'}</p>`}
    </section>
    ${isAdmin ? PICKER_SCRIPT : ''}
  `;
};

module.exports.artStripHtml = artStripHtml;
