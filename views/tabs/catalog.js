// views/tabs/catalog.js — "catalog" tab of the admin panel.

'use strict';

const db = require('../../db');
const rules = require('../../rules');
const { formatCp } = require('../../currency');
const { escapeHtml, decomposeCp } = require('../helpers');

const AVAILABILITY_LABELS = { shop: 'Shop', adventure: 'Adventure only' };

// Rarity (none = mundane gear) and whether the weekly restock may roll the item.
function shopFieldsHtml(item) {
  const rarity = item ? item.rarity || '' : '';
  const availability = item ? item.availability || 'shop' : 'shop';
  return `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
      <div>
        <label>Rarity:</label><br>
        <select name="rarity" style="width: 100%;">
          <option value="" ${rarity ? '' : 'selected'}>— none (mundane) —</option>
          ${rules.SHOP_RARITIES.map(value => `<option value="${value}" ${rarity === value ? 'selected' : ''}>${value}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Availability:</label><br>
        <select name="availability" style="width: 100%;">
          ${Object.entries(AVAILABILITY_LABELS).map(([value, label]) => `<option value="${value}" ${availability === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <span class="muted small">Adventure only: never rolled into the shop. Very Rare and Legendary items are always adventure only.</span>
      </div>
    </div>`;
}

const gp = cp => formatCp(cp);

// Suggested rarity, price, availability and level for catalog rows, for a DM to tick and apply.
function reviewHtml(review) {
  if (!review.length) return '<div class="card"><h3>Rarity &amp; price check</h3><p class="muted">Every catalog item matches its rarity, price and availability. Nothing to change.</p><a href="/admin?tab=catalog" class="btn btn-small">Back</a></div>';
  const cell = (entry, key, show) => (Object.hasOwn(entry.changes, key)
    ? `<span class="muted"><del>${escapeHtml(show(entry.current[key]))}</del></span> → <strong>${escapeHtml(show(entry.changes[key]))}</strong>`
    : '<span class="muted">—</span>');
  const rarity = value => value || '—';
  return `
    <div class="card catalog-review">
      <div class="sheet-section-heading">
        <h3>Rarity &amp; price check (${review.length} items)</h3>
        <a href="/admin?tab=catalog" class="btn btn-small btn-secondary">Cancel</a>
      </div>
      <p class="muted small">Rarity comes from the magic item list (or the spell level for scrolls, or the price). Prices follow the 2024 table: Common 100 gp, Uncommon 400, Rare 4,000, Very Rare 40,000, Legendary 200,000; potions, scrolls and ammunition half. Rare and rarer items become <strong>adventure only</strong>; you can open a Rare item to the shop afterwards. Untick anything you want to keep as it is.</p>
      <form method="POST" action="/admin/catalog/review">
        <div class="vitals-actions">
          <button type="submit" class="btn btn-green">Apply ticked changes</button>
          <button type="button" class="btn btn-small btn-secondary" onclick="this.form.querySelectorAll('input[name=ids]').forEach(box => { box.checked = !box.checked; })">Invert ticks</button>
        </div>
        <table class="catalog-review-table">
          <thead><tr><th></th><th>Item</th><th>Rarity</th><th>Price</th><th>Availability</th><th>Min level</th><th>Based on</th></tr></thead>
          <tbody>
            ${review.map(entry => `
              <tr>
                <td><input type="checkbox" name="ids" value="${entry.id}" checked aria-label="Apply to ${escapeHtml(entry.name)}"></td>
                <td><a href="/admin?tab=catalog&edit_catalog=${entry.id}">${escapeHtml(entry.name)}</a></td>
                <td>${cell(entry, 'rarity', rarity)}</td>
                <td>${cell(entry, 'base_price_cp', gp)}</td>
                <td>${cell(entry, 'availability', value => AVAILABILITY_LABELS[value] || value)}</td>
                <td>${cell(entry, 'min_level', value => 'Lvl ' + value)}</td>
                <td class="muted small">${escapeHtml(entry.source)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <button type="submit" class="btn btn-green">Apply ticked changes</button>
      </form>
    </div>`;
}

module.exports = function renderCatalogTab(ctx) {
  const { req, catalogItems } = ctx;
  let contentHtml = '';
  const editId = req.query.edit_catalog ? parseInt(req.query.edit_catalog, 10) : null;
  const itemToEdit = editId ? db.getCatalogItemById(editId) : null;

  let formSectionHtml = '';
  const review = db.reviewCatalogRarity();
  const reviewing = Boolean(req.query.review);

  if (itemToEdit) {
    const priceDenoms = decomposeCp(itemToEdit.base_price_cp);
    formSectionHtml = `
      <div class="card" style="border: 1px solid #5865f2;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>Edit Item: ${escapeHtml(itemToEdit.name)} (ID: ${itemToEdit.id})</h3>
          <a href="/admin?tab=catalog" class="btn btn-small">Cancel</a>
        </div>
        <form method="POST" action="/admin/catalog/update">
          <input type="hidden" name="id" value="${itemToEdit.id}">
          
          <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <label>Name:</label><br>
              <input type="text" name="name" value="${escapeHtml(itemToEdit.name)}" required style="width: 100%;">
            </div>
            <div>
              <label>Category:</label><br>
              <input type="text" name="category" value="${escapeHtml(itemToEdit.category)}" required style="width: 100%;">
            </div>
            <div>
              <label>Tier:</label><br>
              <select name="tier" style="width: 100%;">
                ${['staple', 'common', 'rare', 'magic', 'service'].map(t => 
                  `<option value="${t}" ${itemToEdit.tier === t ? 'selected' : ''}>${t}</option>`
                ).join('')}
              </select>
            </div>
          </div>

          <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
            <label style="font-weight: bold; color: #d4af37;">Base Price Breakdown (Min. total 1 cp):</label>
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 6px;">
              <div>
                <label style="font-size: 12px;">Platinum (PP):</label>
                <input type="number" name="pp" min="0" value="${priceDenoms.pp}" style="width: 100%;">
              </div>
              <div>
                <label style="font-size: 12px;">Gold (GP):</label>
                <input type="number" name="gp" min="0" value="${priceDenoms.gp}" style="width: 100%;">
              </div>
              <div>
                <label style="font-size: 12px;">Electrum (EP):</label>
                <input type="number" name="ep" min="0" value="${priceDenoms.ep}" style="width: 100%;">
              </div>
              <div>
                <label style="font-size: 12px;">Silver (SP):</label>
                <input type="number" name="sp" min="0" value="${priceDenoms.sp}" style="width: 100%;">
              </div>
              <div>
                <label style="font-size: 12px;">Copper (CP):</label>
                <input type="number" name="cp" min="0" value="${priceDenoms.cp}" style="width: 100%;">
              </div>
            </div>
          </div>

          <div>
              <label>
                Min Party Level (1–20):
                <span class="tooltip">?
                  <span class="tooltip-text">
                    <strong>Restock Level Gate:</strong><br>
                    Items only appear in Grimbold's pool when the current Party Level is greater than or equal to this value. High-level items remain locked until the party progresses.
                  </span>
                </span>
              </label><br>
              <input type="number" name="min_level" min="1" max="20" value="${itemToEdit.min_level}" required style="width: 100%;">
            </div>
            <div>
              <label>Min Weekly Stock:</label><br>
              <input type="number" name="min_stock" min="0" value="${itemToEdit.min_stock}" required style="width: 100%;">
            </div>
            <div>
              <label>Max Weekly Stock:</label><br>
              <input type="number" name="max_stock" min="0" value="${itemToEdit.max_stock}" required style="width: 100%;">
            </div>
          </div>

          ${shopFieldsHtml(itemToEdit)}
          <div style="margin-bottom: 12px;">
            <label>Description:</label><br>
            <textarea name="description" rows="3" required style="width: 100%;">${escapeHtml(itemToEdit.description)}</textarea>
          </div>
          <button type="submit" class="btn btn-green">Save Changes</button>
        </form>
      </div>
    `;
  } else {
    formSectionHtml = `
      <div class="card">
        <h3>Add New Item to Master Catalog</h3>
        <form method="POST" action="/admin/catalog/add">
          <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <label>Name:</label><br>
              <input type="text" name="name" placeholder="e.g. Ring of Warmth" required style="width: 100%;">
            </div>
            <div>
              <label>Category:</label><br>
              <input type="text" name="category" placeholder="e.g. Ring / Adventuring Gear" required style="width: 100%;">
            </div>
            <div>
              <label>
                Tier:
                <span class="tooltip">?
                  <span class="tooltip-text">
                    <strong>Item Tier & Weekly Stock Rules:</strong><br>
                    • <strong>staple:</strong> Always on shelf, fixed price (no fluctuation).<br>
                    • <strong>common:</strong> 10 random items rolled weekly.<br>
                    • <strong>Spell Scroll:</strong> Guaranteed 2 cantrips & 2 lvl 1 spells.<br>
                    • <strong>rare:</strong> Exactly 2 random items rolled weekly.<br>
                    • <strong>magic:</strong> Exactly 1 magic item rolled weekly.<br>
                    • <strong>service:</strong> Lodging, transport, non-physical goods.
                  </span>
                </span>
              </label><br>
              <select name="tier" style="width: 100%;" required>
                <option value="staple">staple</option>
                <option value="common" selected>common</option>
                <option value="rare">rare</option>
                <option value="magic">magic</option>
                <option value="service">service</option>
              </select>
            </div>
          </div>

          <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
            <label style="font-weight: bold; color: #d4af37;">Base Price Breakdown (Min. total 1 cp):</label>
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 6px;">
              <div>
                <label style="font-size: 12px;">Platinum (PP):</label>
                <input type="number" name="pp" min="0" value="0" style="width: 100%;">
              </div>
              <div>
                <label style="font-size: 12px;">Gold (GP):</label>
                <input type="number" name="gp" min="0" value="0" style="width: 100%;">
              </div>
              <div>
                <label style="font-size: 12px;">Electrum (EP):</label>
                <input type="number" name="ep" min="0" value="0" style="width: 100%;">
              </div>
              <div>
                <label style="font-size: 12px;">Silver (SP):</label>
                <input type="number" name="sp" min="0" value="0" style="width: 100%;">
              </div>
              <div>
                <label style="font-size: 12px;">Copper (CP):</label>
                <input type="number" name="cp" min="0" value="0" style="width: 100%;">
              </div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <label>
                Min Party Level (1–20):
                <span class="tooltip">?
                  <span class="tooltip-text">
                    <strong>Restock Level Gate:</strong><br>
                    Items only appear in Grimbold's pool when the current Party Level is greater than or equal to this value. High-level items remain locked until the party progresses.
                  </span>
                </span>
              </label><br>
              <input type="number" name="min_level" min="1" max="20" value="1" required style="width: 100%;">
            </div>
            <div>
              <label>
                Min Weekly Stock:
                <span class="tooltip">?
                  <span class="tooltip-text">
                    <strong>Weekly Stock Rules:</strong><br>
                    • <strong>staple:</strong> Always available, fixed stock.<br>
                    • <strong>common:</strong> 10 random items rolled weekly.<br>
                    • <strong>rare:</strong> Exactly 2 random items rolled weekly.<br>
                    • <strong>magic:</strong> Exactly 1 magic item rolled weekly.<br>
                    • <strong>service:</strong> Lodging, transport, non-physical goods.
                  </span>
                </span>
              </label><br>
              <input type="number" name="min_stock" min="0" value="1" required style="width: 100%;">
            </div>
            <div>
              <label>
                Max Weekly Stock:
                <span class="tooltip">?
                  <span class="tooltip-text">
                    <strong>Weekly Stock Rules:</strong><br>
                    • <strong>staple:</strong> Always available, fixed stock.<br>
                    • <strong>common:</strong> 10 random items rolled weekly.<br>
                    • <strong>rare:</strong> Exactly 2 random items rolled weekly.<br>
                    • <strong>magic:</strong> Exactly 1 magic item rolled weekly.<br>
                    • <strong>service:</strong> Lodging, transport, non-physical goods.
                  </span>
                </span>
              </label><br>
              <input type="number" name="max_stock" min="0" value="1" required style="width: 100%;">
            </div>
          </div>

          ${shopFieldsHtml(null)}
          <div style="margin-bottom: 12px;">
            <label>Description:</label><br>
            <textarea name="description" rows="2" placeholder="Full English lore / mechanical description..." required style="width: 100%;"></textarea>
          </div>
          <button type="submit" class="btn btn-green">Add to Catalog</button>
        </form>
      </div>
    `;
  }

  contentHtml = `
    ${reviewing ? reviewHtml(review) : ''}
    ${!reviewing && review.length ? `<div class="alert">⚖️ ${review.length} catalog items have a rarity, price or availability to check. <a href="/admin?tab=catalog&review=1" class="btn btn-small">Review</a></div>` : ''}
    ${reviewing ? '' : formSectionHtml}
    <div class="card">
      <h3>Master Catalog (${catalogItems.length} items)</h3>
      <table id="master-catalog" data-filter="category,tier,rarity,availability" data-filter-level data-page-size="50">
        <thead>
          <tr>
            <th class="sortable">ID</th>
            <th class="sortable">Name</th>
            <th class="sortable">Category</th>
            <th class="sortable">Tier</th>
            <th class="sortable">Rarity</th>
            <th class="sortable">Shop</th>
            <th class="sortable">Base Price</th>
            <th class="sortable">Min Lvl</th>
            <th class="sortable">Stock Range</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${catalogItems.map(c => `
            <tr data-search="${escapeHtml(`${c.name} ${c.category} ${c.description || ''}`.toLowerCase())}" data-category="${escapeHtml(c.category)}" data-tier="${escapeHtml(c.tier)}" data-rarity="${escapeHtml(c.rarity || 'Mundane')}" data-availability="${c.availability === 'adventure' ? 'Adventure only' : 'Shop'}" data-level="${Number(c.min_level)}">
              <td data-sort="${c.id}">${c.id}</td>
              <td data-sort="${escapeHtml(c.name)}"><strong>${escapeHtml(c.name)}</strong></td>
              <td data-sort="${escapeHtml(c.category)}">${escapeHtml(c.category)}</td>
              <td data-sort="${c.tier}"><span class="tag">${c.tier}</span></td>
              <td data-sort="${rules.SHOP_RARITIES.indexOf(c.rarity)}">${c.rarity ? escapeHtml(c.rarity) : '<span class="muted">—</span>'}</td>
              <td data-sort="${c.availability === 'adventure' ? 1 : 0}">${c.availability === 'adventure' ? '<span class="tag gold" title="Only given out in adventures">Adventure only</span>' : 'Shop'}</td>
              <td data-sort="${c.base_price_cp}">${formatCp(c.base_price_cp)}</td>
              <td data-sort="${c.min_level}">Lvl ${c.min_level}</td>
              <td data-sort="${c.min_stock}">${c.min_stock} –${c.max_stock}</td>
              <td>
                <a href="/admin?tab=catalog&edit_catalog=${c.id}" class="btn btn-small">Edit</a>
                <form method="POST" action="/admin/catalog/delete" style="display:inline;" onsubmit="return confirm('Are you sure you want to permanently delete &quot;${escapeHtml(c.name)}&quot; from the catalog?');">
                  <input type="hidden" name="id" value="${c.id}">
                  <button type="submit" class="btn btn-small btn-red">Delete</button>
                </form>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  return contentHtml;
};
