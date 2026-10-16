// views/tabs/artisansEvents.js — The Artisans and Weekly events cards of the
// Restock Engine tab (data in db/artisans.js).

'use strict';

const db = require('../../db');
const { formatCp } = require('../../currency');
const { escapeHtml } = require('../helpers');

const KIND_LABELS = { merchant: 'Visiting merchant', shortage: 'Shortage', sale: 'Sale', news: 'News only' };
const SHORTAGE_LABELS = { scroll: 'No new scrolls', magic: 'No new magic items' };
const SALE_LABELS = { mundane: 'Mundane counter', staple: 'Staples', scroll: 'Scroll case', artisan: 'Artisan goods' };
const gpValue = cp => String(Math.round(cp) / 100);

function goodRow(good) {
  return `
    <tr>
      <td><strong>${escapeHtml(good.name)}</strong><div class="muted small">${escapeHtml(good.category)}</div></td>
      <td>${formatCp(good.price_cp)}</td>
      <td>+${good.per_week} / week, up to ${good.cap}</td>
      <td>
        <form method="POST" action="/admin/artisans/goods/delete" onsubmit="return confirm('Stop making this item? It leaves the shelf at the next restock.');">
          <input type="hidden" name="id" value="${good.id}">
          <button class="btn btn-small btn-red" type="submit">Remove</button>
        </form>
      </td>
    </tr>`;
}

function artisanCard(artisan) {
  return `
    <details class="artisan" ${artisan.goods.length ? '' : 'open'}>
      <summary>
        <strong>${escapeHtml(artisan.name)}</strong>
        ${artisan.active ? '' : '<span class="tag">Away</span>'}
        <span class="muted small">${artisan.goods.length} item${artisan.goods.length === 1 ? '' : 's'}</span>
      </summary>
      <form method="POST" action="/admin/artisans/save" class="artisan-form">
        <input type="hidden" name="id" value="${artisan.id}">
        <label>Name<input name="name" maxlength="80" required value="${escapeHtml(artisan.name)}"></label>
        <label>Who they are<textarea name="description" rows="2" maxlength="1000">${escapeHtml(artisan.description)}</textarea></label>
        <label class="creator-check"><input type="checkbox" name="active" value="1" ${artisan.active ? 'checked' : ''}> Supplying Grimbold (untick while they're away: their goods leave the shelf)</label>
        <input type="hidden" name="active_sent" value="1">
        <div class="vitals-actions">
          <button class="btn btn-small" type="submit">Save</button>
        </div>
      </form>
      ${artisan.goods.length ? `<table class="artisan-goods"><tbody>${artisan.goods.map(goodRow).join('')}</tbody></table>` : '<p class="muted small">No goods yet.</p>'}
      <form method="POST" action="/admin/artisans/goods/save" class="artisan-good-form">
        <input type="hidden" name="artisan_id" value="${artisan.id}">
        <label>Item<input name="name" maxlength="100" required placeholder="Treated Leather Armor"></label>
        <label>Category<input name="category" maxlength="60" placeholder="Armor"></label>
        <label>Price (gp)<input name="price_gp" type="number" step="0.01" min="0.01" required></label>
        <label>Made per week<input name="per_week" type="number" min="1" max="20" value="1" required></label>
        <label>Most on the shelf<input name="cap" type="number" min="1" max="50" value="3" required></label>
        <label class="artisan-good-description">Description<input name="description" maxlength="2000" placeholder="Leather armor cured in Benet's own brine…"></label>
        <button class="btn btn-small btn-green" type="submit">+ Add item</button>
      </form>
      <form method="POST" action="/admin/artisans/delete" onsubmit="return confirm('Remove ${escapeHtml(artisan.name).replace(/'/g, '&#39;')} and all their goods?');">
        <input type="hidden" name="id" value="${artisan.id}">
        <button class="btn btn-small btn-red" type="submit">Remove artisan</button>
      </form>
    </details>`;
}

function eventSummary(event) {
  const params = event.params || {};
  if (event.kind === 'merchant') return `${(params.goods || []).length} goods, sells ${params.min}–${params.max} a visit`;
  if (event.kind === 'shortage') return SHORTAGE_LABELS[params.target] || '';
  if (event.kind === 'sale') return `${params.percent}% off ${SALE_LABELS[params.target] || ''}`;
  return '';
}

// The add / edit form; the fields of the other kinds hide (see the script below).
function eventForm(event) {
  const params = (event && event.params) || {};
  const kind = event ? event.kind : 'merchant';
  const goodsText = (params.goods || []).map(good => [good.name, gpValue(good.price_cp), good.category, good.description].filter((part, index) => index < 3 || part).join(' | ')).join('\n');
  const select = (name, labels, value) => `<select name="${name}">${Object.entries(labels).map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  return `
    <form method="POST" action="/admin/shop-events/save" class="event-form" data-kind="${kind}">
      ${event ? `<input type="hidden" name="id" value="${event.id}">` : ''}
      <h4>${event ? `Edit “${escapeHtml(event.title)}”` : 'New event'}</h4>
      <div class="restock-grid">
        <label class="restock-field"><span>Kind</span>${select('kind', KIND_LABELS, kind)}</label>
        <label class="restock-field"><span>Title</span><input name="title" maxlength="100" required value="${escapeHtml(event ? event.title : '')}" placeholder="A dwarven armorer passes through"></label>
        <label class="restock-field"><span>Weight</span><input name="weight" type="number" min="1" max="100" value="${event ? event.weight : 1}"><small class="muted">Higher = more likely to be picked</small></label>
      </div>
      <label class="restock-field"><span>Announcement (Grimbold says it on Discord)</span><textarea name="announcement" rows="2" maxlength="1000" required>${escapeHtml(event ? event.announcement : '')}</textarea></label>
      <div data-for="merchant">
        <label class="restock-field"><span>Goods, one per line: Name | price in gp | category | description</span>
          <textarea name="goods" rows="4" placeholder="Dwarven Chain Shirt | 60 | Armor | Fine dwarven links.&#10;Whetstone of Keenness | 5 | Adventuring Gear">${escapeHtml(goodsText)}</textarea></label>
        <div class="restock-grid">
          <label class="restock-field"><span>Fewest items a visit</span><input name="min_goods" type="number" min="1" max="10" value="${params.min || 1}"></label>
          <label class="restock-field"><span>Most items a visit</span><input name="max_goods" type="number" min="1" max="10" value="${params.max || 3}"></label>
        </div>
      </div>
      <div data-for="shortage"><label class="restock-field"><span>What runs short</span>${select('target', SHORTAGE_LABELS, params.target)}</label></div>
      <div data-for="sale" class="restock-grid">
        <label class="restock-field"><span>On sale</span>${select('target', SALE_LABELS, params.target)}</label>
        <label class="restock-field"><span>Discount %</span><input name="percent" type="number" min="5" max="75" value="${params.percent || 20}"></label>
      </div>
      <label class="creator-check"><input type="checkbox" name="active" value="1" ${!event || event.active ? 'checked' : ''}> Can happen</label>
      <div class="vitals-actions">
        <button class="btn btn-green" type="submit">${event ? 'Save event' : 'Add event'}</button>
        ${event ? '<a class="btn btn-secondary" href="/admin?tab=restock#shop-events">Cancel</a>' : ''}
      </div>
    </form>
    <script>
      (() => {
        const form = document.currentScript.previousElementSibling;
        const kind = form.querySelector('select[name=kind]');
        const show = () => form.querySelectorAll('[data-for]').forEach(part => {
          const on = part.dataset.for === kind.value;
          part.hidden = !on;
          // Only the shown kind's fields are sent (two kinds share "target").
          part.querySelectorAll('input, select, textarea').forEach(field => { field.disabled = !on; });
        });
        kind.addEventListener('change', show);
        show();
      })();
    </script>`;
}

function renderArtisansAndEvents(req, cfg) {
  const artisans = db.listArtisans();
  const events = db.listShopEvents();
  const editing = req.query.edit_event ? db.getShopEvent(req.query.edit_event) : null;
  return `
    <div class="card" id="artisans">
      <h3>Artisans</h3>
      <p class="muted small">Local craftspeople who supply Grimbold. Each restock adds every item's weekly amount, up to its cap; unsold stock waits on the shelf, and buying frees room for the next batch.</p>
      ${artisans.map(artisanCard).join('') || '<p class="muted">No artisans yet.</p>'}
      <form method="POST" action="/admin/artisans/save" class="artisan-new">
        <input name="name" maxlength="80" required placeholder="New artisan, e.g. Benet the Leatherworker" aria-label="New artisan name">
        <input type="hidden" name="active" value="1">
        <button class="btn btn-small btn-green" type="submit">+ Add artisan</button>
      </form>
    </div>

    <div class="card" id="shop-events">
      <h3>Weekly events</h3>
      <p class="muted small">Each restock there's a <strong>${cfg.event_chance}%</strong> chance (set above) that one of these happens, picked by weight. Its announcement goes out with the restock.</p>
      ${events.length ? `
        <table class="shop-events">
          <thead><tr><th>Event</th><th>Kind</th><th>Weight</th><th></th></tr></thead>
          <tbody>
            ${events.map(event => `
              <tr class="${event.active ? '' : 'muted'}">
                <td><strong>${escapeHtml(event.title)}</strong>${event.active ? '' : ' <span class="tag">Off</span>'}<div class="muted small">${escapeHtml(event.announcement)}</div></td>
                <td>${KIND_LABELS[event.kind]}<div class="muted small">${escapeHtml(eventSummary(event))}</div></td>
                <td>${event.weight}</td>
                <td class="nowrap">
                  <a class="btn btn-small" href="/admin?tab=restock&edit_event=${event.id}#shop-events">Edit</a>
                  <form method="POST" action="/admin/shop-events/delete" style="display:inline;" onsubmit="return confirm('Delete this event?');">
                    <input type="hidden" name="id" value="${event.id}">
                    <button class="btn btn-small btn-red" type="submit">Delete</button>
                  </form>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p class="muted">No events yet.</p>'}
      ${eventForm(editing)}
    </div>`;
}

module.exports = { renderArtisansAndEvents };
