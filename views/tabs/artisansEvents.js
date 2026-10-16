// views/tabs/artisansEvents.js — The Artisans and Weekly events cards of the
// Restock Engine tab (data in db/artisans.js). Goods can be filled from the
// Master Catalog (items set to Shop only).

'use strict';

const db = require('../../db');
const { formatCp } = require('../../currency');
const { escapeHtml } = require('../helpers');

const KIND_LABELS = { merchant: 'Visiting merchant', shortage: 'Shortage', sale: 'Sale', news: 'News only' };
const MODE_LABELS = { resident: 'Resident: supplies every week', travelling: 'Travelling: only visits through a "Visiting merchant" event' };
const SALE_LABELS = { mundane: 'Mundane counter', staple: 'Staples', scroll: 'Scroll case', artisan: 'Artisan goods' };
const gpValue = cp => String(Math.round(cp) / 100);
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

function goodRow(good, artisanId) {
  return `
    <tr>
      <td><strong>${escapeHtml(good.name)}</strong><div class="muted small">${escapeHtml(good.category)}</div></td>
      <td>${formatCp(good.price_cp)}</td>
      <td>+${good.per_week} / week, up to ${good.cap}</td>
      <td>
        <form method="POST" action="/admin/artisans/goods/delete" onsubmit="return confirm('Stop making this item? It leaves the shelf at the next restock.');">
          <input type="hidden" name="id" value="${good.id}">
          <input type="hidden" name="artisan_id" value="${artisanId}">
          <button class="btn btn-small btn-red" type="submit">Remove</button>
        </form>
      </td>
    </tr>`;
}

// A search box over the Master Catalog; picking an item fills the form (data-fill).
const catalogSearch = (purpose) => `
  <label class="catalog-fill">From the Master Catalog
    <input type="search" list="restock-catalog" placeholder="Type to search, e.g. Chain Shirt" data-fill="${purpose}" autocomplete="off">
  </label>`;

function artisanCard(artisan, openId) {
  const travelling = artisan.mode === 'travelling';
  return `
    <details class="artisan" ${artisan.id === openId ? 'open' : ''} id="artisan-${artisan.id}">
      <summary>
        <strong>${escapeHtml(artisan.name)}</strong>
        <span class="tag">${travelling ? 'Travelling' : 'Resident'}</span>
        ${artisan.active ? '' : '<span class="tag">Away</span>'}
        <span class="muted small">${artisan.goods.length} item${artisan.goods.length === 1 ? '' : 's'}</span>
      </summary>
      <form method="POST" action="/admin/artisans/save" class="artisan-form">
        <input type="hidden" name="id" value="${artisan.id}">
        <label>Name<input name="name" maxlength="80" required value="${escapeHtml(artisan.name)}"></label>
        <label>Who they are<textarea name="description" rows="2" maxlength="1000">${escapeHtml(artisan.description)}</textarea></label>
        <label>How they supply Grimbold<select name="mode">
          ${Object.entries(MODE_LABELS).map(([value, label]) => `<option value="${value}" ${artisan.mode === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label class="creator-check"><input type="checkbox" name="active" value="1" ${artisan.active ? 'checked' : ''}> Available (untick while they're away: a resident's goods leave the shelf, a travelling one doesn't visit)</label>
        <div class="vitals-actions">
          <button class="btn btn-small" type="submit">Save</button>
        </div>
      </form>
      ${artisan.goods.length ? `<table class="artisan-goods"><tbody>${artisan.goods.map(good => goodRow(good, artisan.id)).join('')}</tbody></table>` : '<p class="muted small">No goods yet.</p>'}
      <form method="POST" action="/admin/artisans/goods/save" class="artisan-good-form">
        <input type="hidden" name="artisan_id" value="${artisan.id}">
        <div class="artisan-good-description">${catalogSearch('good')}</div>
        <label>Item<input name="name" maxlength="100" required placeholder="Treated Leather Armor"></label>
        <label>Category<input name="category" maxlength="60" placeholder="Armor"></label>
        <label>Price (gp)<input name="price_gp" type="number" step="0.01" min="0.01" required></label>
        <label>${travelling ? 'Brings per visit' : 'Made per week'}<input name="per_week" type="number" min="1" max="20" value="1" required></label>
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

function eventSummary(event, artisans, shortages) {
  const params = event.params || {};
  if (event.kind === 'merchant') {
    const who = params.artisanId ? (artisans.find(artisan => artisan.id === params.artisanId) || { name: 'a removed artisan' }).name : `${(params.goods || []).length} goods`;
    return `${who}, sells ${params.min}–${params.max} a visit`;
  }
  if (event.kind === 'shortage') return (shortages.find(option => option.value === params.target) || { label: params.target }).label;
  if (event.kind === 'sale') return `${params.percent}% off ${SALE_LABELS[params.target] || ''}`;
  return '';
}

// The add / edit form; the fields of the other kinds hide (see the script below).
function eventForm(event, travellers, shortages) {
  const params = (event && event.params) || {};
  const kind = event ? event.kind : 'merchant';
  const goodsText = (params.goods || []).map(good => [good.name, gpValue(good.price_cp), good.category, good.description].filter((part, index) => index < 3 || part).join(' | ')).join('\n');
  const select = (name, labels, value) => `<select name="${name}">${Object.entries(labels).map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const shortageTarget = params.target || 'scroll';
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
      <div data-for="merchant" class="merchant-fields">
        <label class="restock-field"><span>Who visits</span>
          <select name="artisan_id">
            <option value="">A merchant with the goods listed below</option>
            ${travellers.map(artisan => `<option value="${artisan.id}" ${params.artisanId === artisan.id ? 'selected' : ''}>${escapeHtml(artisan.name)} (travelling artisan, ${artisan.goods.length} goods)</option>`).join('')}
          </select>
          <small class="muted">${travellers.length ? 'A travelling artisan brings their own goods (Artisans above).' : 'Set an artisan to Travelling to send them here.'}</small>
        </label>
        <div class="merchant-goods">
          ${catalogSearch('line')}
          <label class="restock-field"><span>Goods, one per line: Name | price in gp | category | description</span>
            <textarea name="goods" rows="4" placeholder="Dwarven Chain Shirt | 60 | Armor | Fine dwarven links.&#10;Whetstone of Keenness | 5 | Adventuring Gear">${escapeHtml(goodsText)}</textarea></label>
        </div>
        <div class="restock-grid">
          <label class="restock-field"><span>Fewest items a visit</span><input name="min_goods" type="number" min="1" max="10" value="${params.min || 1}"></label>
          <label class="restock-field"><span>Most items a visit</span><input name="max_goods" type="number" min="1" max="10" value="${params.max || 3}"></label>
        </div>
      </div>
      <div data-for="shortage">
        <label class="restock-field"><span>What runs short</span>
          <select name="target" class="shortage-target">
            ${shortages.map(option => `<option value="${escapeHtml(option.value)}" data-description="${escapeHtml(option.description)}" ${shortageTarget === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
          <small class="muted shortage-description"></small>
        </label>
      </div>
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
        const who = form.querySelector('select[name=artisan_id]');
        const goods = form.querySelector('.merchant-goods');
        const show = () => {
          form.querySelectorAll('[data-for]').forEach(part => {
            const on = part.dataset.for === kind.value;
            part.hidden = !on;
            // Only the shown kind's fields are sent (two kinds share "target").
            part.querySelectorAll('input, select, textarea').forEach(field => { field.disabled = !on; });
          });
          // A travelling artisan brings their own goods: no list to type.
          const typed = kind.value === 'merchant' && !who.value;
          goods.hidden = !typed;
          goods.querySelectorAll('input, textarea').forEach(field => { field.disabled = !typed; });
        };
        const target = form.querySelector('.shortage-target');
        const describe = () => { form.querySelector('.shortage-description').textContent = target.selectedOptions[0] ? target.selectedOptions[0].dataset.description : ''; };
        kind.addEventListener('change', show);
        who.addEventListener('change', show);
        target.addEventListener('change', describe);
        show();
        describe();
      })();
    </script>`;
}

function renderArtisansAndEvents(req, cfg) {
  const artisans = db.listArtisans();
  const events = db.listShopEvents();
  const editing = req.query.edit_event ? db.getShopEvent(req.query.edit_event) : null;
  const openId = Number(req.query.artisan) || null;
  const travellers = artisans.filter(artisan => artisan.mode === 'travelling');
  const shortages = db.shortageOptions();
  // Shop items only: adventure-only items stay out of artisans' and merchants' hands.
  const catalog = db.getAllCatalogItems().filter(item => item.availability !== 'adventure' && item.tier !== 'service')
    .map(item => ({ name: item.name, category: item.category, gp: gpValue(item.base_price_cp), description: String(item.description || '').slice(0, 500) }));
  return `
    <div class="card" id="artisans">
      <h3>Artisans</h3>
      <p class="muted small">Craftspeople who supply Grimbold. A <strong>resident</strong> artisan adds every item's weekly amount at each restock, up to its cap; unsold stock waits on the shelf, and buying frees room for the next batch. A <strong>travelling</strong> artisan only comes through a "Visiting merchant" event (Weekly events below) and sells their goods for that week.</p>
      ${artisans.map(artisan => artisanCard(artisan, openId)).join('') || '<p class="muted">No artisans yet.</p>'}
      <form method="POST" action="/admin/artisans/save" class="artisan-new">
        <input name="name" maxlength="80" required placeholder="New artisan, e.g. Benet the Leatherworker" aria-label="New artisan name">
        <select name="mode" aria-label="Resident or travelling"><option value="resident">Resident</option><option value="travelling">Travelling</option></select>
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
                <td>${KIND_LABELS[event.kind]}<div class="muted small">${escapeHtml(eventSummary(event, artisans, shortages))}</div></td>
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
      ${eventForm(editing, travellers, shortages)}
    </div>
    <datalist id="restock-catalog">${catalog.map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.category)} · ${escapeHtml(item.gp)} gp</option>`).join('')}</datalist>
    <script>
      (() => {
        // Picking a catalog item fills an artisan's item form, or adds a line to a merchant's goods.
        const catalog = new Map(${scriptJson(catalog)}.map(item => [item.name.toLowerCase(), item]));
        document.querySelectorAll('[data-fill]').forEach(search => {
          search.addEventListener('change', () => {
            const item = catalog.get(search.value.trim().toLowerCase());
            if (!item) return;
            const form = search.closest('form');
            if (search.dataset.fill === 'good') {
              form.elements.name.value = item.name;
              form.elements.category.value = item.category;
              form.elements.price_gp.value = item.gp;
              form.elements.description.value = item.description;
            } else {
              const goods = form.elements.goods;
              const line = [item.name, item.gp, item.category, item.description.replace(/\\s+/g, ' ').slice(0, 200)].join(' | ');
              goods.value = goods.value.trim() ? goods.value.replace(/\\s*$/, '') + '\\n' + line : line;
            }
            search.value = '';
          });
        });
      })();
    </script>`;
}

module.exports = { renderArtisansAndEvents };
