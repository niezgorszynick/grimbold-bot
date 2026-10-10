// views/tabs/catalog.js — "catalog" tab of the admin panel.

'use strict';

const db = require('../../db');
const { formatCp } = require('../../currency');
const { escapeHtml, decomposeCp } = require('../helpers');
const rules = require('../../rules');

const MAGIC_PRICES = rules.MAGIC_ITEM_PRICE_GP;
const MIN_LEVELS = rules.MAGIC_ITEM_MIN_PARTY_LEVEL;

module.exports = function renderCatalogTab(ctx) {
  const { req, catalogItems } = ctx;
  let contentHtml = '';
  const editId = req.query.edit_catalog ? parseInt(req.query.edit_catalog, 10) : null;
  const itemToEdit = editId ? db.getCatalogItemById(editId) : null;

  let formSectionHtml = '';

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

          <div style="margin-bottom: 12px;">
            <label>Description:</label><br>
            <textarea name="description" rows="2" placeholder="Full English lore / mechanical description..." required style="width: 100%;"></textarea>
          </div>
          <button type="submit" class="btn btn-green">Add to Catalog</button>
        </form>
      </div>
    `;
  }

  // Magic items from rules/content/magic_items.md, priced by rarity.
  const magicCatalog = rules.getMagicItemCatalog();
  const magicCount = Object.keys(magicCatalog).length;
  const magicImportHtml = `
    <div class="card">
      <h3>Import Magic Items</h3>
      ${magicCount ? `
        <p class="muted">Adds the magic items of the chosen rarities (${magicCount} items in the magic item list) to the catalog with the <em>magic</em> tier, at Dungeon Master's Guide prices: Common ${MAGIC_PRICES.Common} GP, Uncommon ${MAGIC_PRICES.Uncommon} GP, Rare ${MAGIC_PRICES.Rare} GP, Very Rare ${MAGIC_PRICES['Very Rare']} GP, Legendary ${MAGIC_PRICES.Legendary} GP; potions, scrolls and ammunition cost half. The weekly restock offers each rarity from party level ${MIN_LEVELS.Uncommon} (Uncommon), ${MIN_LEVELS.Rare} (Rare), ${MIN_LEVELS['Very Rare']} (Very Rare) and ${MIN_LEVELS.Legendary} (Legendary). Items already in the catalog keep their current price and settings; artifacts are never imported.</p>
        <form method="POST" action="/admin/catalog/import-magic-items" onsubmit="return confirm('Add these magic items to the Master Catalog? The weekly restock will start offering them.');">
          <div class="vitals-actions">
            ${['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary'].map(rarity => `<label class="creator-check"><input type="checkbox" name="rarities" value="${rarity}"${['Common', 'Uncommon'].includes(rarity) ? ' checked' : ''}> ${rarity}</label>`).join('')}
          </div>
          <button type="submit" class="btn btn-gold">Import into catalog</button>
        </form>`
      : '<p class="muted">The magic item list (rules/content/magic_items.md) has not been provided on this server.</p>'}
    </div>`;

  contentHtml = `
    ${formSectionHtml}
    ${magicImportHtml}
    <div class="card">
      <h3>Master Catalog (${catalogItems.length} items)</h3>
      <table>
        <thead>
          <tr>
            <th class="sortable">ID</th>
            <th class="sortable">Name</th>
            <th class="sortable">Category</th>
            <th class="sortable">Tier</th>
            <th class="sortable">Base Price</th>
            <th class="sortable">Min Lvl</th>
            <th class="sortable">Stock Range</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${catalogItems.map(c => `
            <tr>
              <td data-sort="${c.id}">${c.id}</td>
              <td data-sort="${escapeHtml(c.name)}"><strong>${escapeHtml(c.name)}</strong></td>
              <td data-sort="${escapeHtml(c.category)}">${escapeHtml(c.category)}</td>
              <td data-sort="${c.tier}"><span class="tag">${c.tier}</span></td>
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
