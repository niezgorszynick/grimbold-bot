// views/tabs/items.js — "items" tab of the admin panel.

'use strict';

const { formatCp } = require('../../currency');
const { applyModifier } = require('../../rollTracker');
const { escapeHtml } = require('../helpers');

module.exports = function renderItemsTab(ctx) {
  const { isAdmin, status, catalogItems, activeItems, shopPlayer, shopRoll, shopModifier } = ctx;
  let contentHtml = '';
  const catalogJson = JSON.stringify(catalogItems.map(c => ({
    name: c.name,
    category: c.category,
    tier: c.tier,
    price: c.base_price_cp,
    description: c.description
  }))).replace(/</g, '\\u003c'); // keeps "</script>" in item text from ending the script
  const optionsOf = values => [...new Set(values)].sort((a, b) => a.localeCompare(b))
    .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');

  contentHtml = `
    ${isAdmin ? `<div class="card" style="margin-bottom: 20px;">
      <h3>Send Custom Message from Grimbold</h3>
      <form method="POST" action="/admin/message">
        <div style="margin-bottom: 8px;">
          <input type="text" name="title" placeholder="Notice Title (Optional, e.g. Special Deal Today!)" style="width: 100%;">
        </div>
        <div style="margin-bottom: 8px;">
          <textarea name="message" rows="3" placeholder="Speak as Grimbold... e.g. 'Pack your bags, travelers, prices drop at dawn!'" required style="width: 100%;"></textarea>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <label style="font-size: 13px; color: #949ba4;">
            <input type="checkbox" name="as_embed" value="1" checked> Format as Grimbold's Gold Parchment Embed
          </label>
          <button type="submit" class="btn btn-green">📢 Send to Discord</button>
        </div>
      </form>
    </div>` : ''}

    ${isAdmin ? `<div class="card">
      <h3>Add Item to Shop Shelf</h3>
      <div class="catalog-picker">
        <label for="catalogSearch"><strong>Fill from the Master Catalog</strong> <span class="muted small">(or type an item below yourself)</span></label>
        <div class="table-filter">
          <input type="search" id="catalogSearch" placeholder="Search name, category or description…" autocomplete="off">
          <select id="catalogCategory" aria-label="Filter by category"><option value="">All categories</option>${optionsOf(catalogItems.map(c => c.category))}</select>
          <select id="catalogTier" aria-label="Filter by tier"><option value="">All tiers</option>${optionsOf(catalogItems.map(c => c.tier))}</select>
          <span id="catalogCount" class="muted small table-filter-count"></span>
        </div>
        <ul id="catalogResults" class="catalog-results"></ul>
      </div>

      <form method="POST" action="/admin/items/add">
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
          <div>
            <label>Name:</label><br>
            <input type="text" id="itemName" name="name" required style="width: 100%;">
          </div>
          <div>
            <label>Category:</label><br>
            <input type="text" id="itemCat" name="category" required style="width: 100%;">
          </div>
          <div>
            <label>Price (in Copper Pieces - CP):</label><br>
            <input type="number" id="itemPrice" name="price" min="0" required style="width: 100%;">
          </div>
          <div>
            <label>Stock (blank = ∞):</label><br>
            <input type="number" id="itemStock" name="stock" min="0" style="width: 100%;">
          </div>
        </div>
        <div>
          <label>Description:</label><br>
          <textarea id="itemDesc" name="description" rows="2" required style="width: 100%;"></textarea>
        </div>
        <button type="submit" class="btn btn-green" style="margin-top: 10px;">Put on Shelf</button>
      </form>
    </div>` : ''}

    <div class="card">
      <h3>Current Store Inventory (${activeItems.length})</h3>
      ${shopModifier && shopModifier.percent !== 0
        ? `<p class="muted">Prices include your ${Math.abs(shopModifier.percent)}% weekly ${shopModifier.percent < 0 ? 'discount' : 'surcharge'}.</p>`
        : shopRoll === null && shopPlayer
          ? '<p class="muted">Roll with /roll to get your weekly personal price.</p>'
          : ''}
      <table>
        <thead>
          <tr>
            <th class="sortable">ID</th>
            <th class="sortable">Name</th>
            <th class="sortable">Category</th>
            <th class="sortable">Price</th>
            <th class="sortable">Stock</th>
            <th class="sortable">Status</th>
            <th>Action</th>
            ${isAdmin ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${activeItems.map(item => {
            const finalPrice = shopModifier ? applyModifier(item.price, shopModifier) : item.price;
            const hasPriceChange = shopModifier && shopModifier.percent !== 0 && finalPrice !== item.price;
            const priceDisplay = hasPriceChange
              ? `<del>${formatCp(item.price)}</del> <strong>${formatCp(finalPrice)}</strong>`
              : formatCp(item.price);
            const modifierLabel = hasPriceChange
              ? `${shopModifier.percent > 0 ? '+' : ''}${shopModifier.percent}%`
              : 'None';
            return `
            <tr>
              <td data-sort="${item.id}">${item.id}</td>
              <td data-sort="${escapeHtml(item.name)}"><strong>${escapeHtml(item.name)}</strong></td>
              <td data-sort="${escapeHtml(item.category)}">${escapeHtml(item.category)}</td>
              <td data-sort="${finalPrice}">${priceDisplay}</td>
              <td data-sort="${item.stock === null ? 999999 : item.stock}">${item.stock === null ? '∞' : item.stock}</td>
              <td data-sort="${item.is_active}">${item.is_active ? '<span class="tag green">Active</span>' : '<span class="tag red">Hidden</span>'}</td>
              <td><button type="button" class="btn btn-small btn-gold shop-buy-button" data-item-name="${escapeHtml(item.name)}" data-item-price="${escapeHtml(formatCp(item.price))}" data-item-final-price="${escapeHtml(formatCp(finalPrice))}" data-item-discount="${modifierLabel}" data-item-stock="${item.stock === null ? '' : item.stock}" ${item.stock === 0 || !item.is_active ? 'disabled' : ''}>Buy</button></td>
              ${isAdmin ? `<td>
                <form method="POST" action="/admin/items/update" style="display:inline;">
                  <input type="hidden" name="id" value="${item.id}">
                  <input type="hidden" name="action" value="toggle">
                  <input type="hidden" name="value" value="${item.is_active ? 0 : 1}">
                  <button class="btn btn-small">${item.is_active ? 'Hide' : 'Show'}</button>
                </form>
                <form method="POST" action="/admin/items/update" style="display:inline;">
                  <input type="hidden" name="id" value="${item.id}">
                  <input type="hidden" name="action" value="delete">
                  <button class="btn btn-small btn-red" onclick="return confirm('Delete item from shop?')">Delete</button>
                </form>
              </td>` : ''}
            </tr>
          `}).join('')}
        </tbody>
      </table>
      </div>
    </div>

    <div id="shopPurchaseModal" class="shop-modal" role="dialog" aria-modal="true" aria-labelledby="shopPurchaseTitle" hidden>
      <div class="card shop-modal-card">
        <h3 id="shopPurchaseTitle">🪙 Purchase from Grimbold</h3>
        <p>
          Item: <strong id="shopPurchaseItem"></strong><br>
          Base Price: <strong id="shopPurchaseBasePrice"></strong><br>
          Your Price: <strong id="shopPurchasePrice"></strong> each (<span id="shopPurchaseDiscount"></span>)<br>
          Available Stock: <strong id="shopPurchaseStock"></strong>
        </p>
        <label for="shopPurchaseCharacter">Choose a character</label>
        <select id="shopPurchaseCharacter" style="width: 100%; margin: 8px 0 12px;">
          <option value="">Loading characters...</option>
        </select>
        <label for="shopPurchaseQuantity">Quantity</label>
        <input id="shopPurchaseQuantity" type="number" min="1" step="1" value="1" style="width: 100%; margin: 8px 0 12px;">
        <p id="shopPurchaseFeedback" role="status" aria-live="polite"></p>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" id="shopPurchaseCancel" class="btn">Cancel</button>
          <button type="button" id="shopPurchaseConfirm" class="btn btn-green">Confirm Purchase</button>
        </div>
      </div>
    </div>

    <script>
      const catalogData = ${catalogJson};
      function autofillCatalog(idx) {
        const item = catalogData[idx];
        if (!item) return;
        document.getElementById('itemName').value = item.name;
        document.getElementById('itemCat').value = item.category;
        document.getElementById('itemPrice').value = item.price;
        document.getElementById('itemDesc').value = item.description;
        document.getElementById('itemStock').value = 1;
      }

      // Search the catalog instead of scrolling a list of every item.
      (function () {
        const search = document.getElementById('catalogSearch');
        if (!search) return;
        const category = document.getElementById('catalogCategory');
        const tier = document.getElementById('catalogTier');
        const results = document.getElementById('catalogResults');
        const count = document.getElementById('catalogCount');
        const MAX = 15;
        let chosen = null;
        function render() {
          const words = search.value.toLowerCase().split(/s+/).filter(Boolean);
          const filtered = !words.length && !category.value && !tier.value;
          const matches = catalogData
            .map((item, idx) => ({ item, idx }))
            .filter(({ item }) => (!category.value || item.category === category.value) && (!tier.value || item.tier === tier.value) &&
              words.every(word => (item.name + ' ' + item.category + ' ' + (item.description || '')).toLowerCase().includes(word)))
            // Names that start with the search come first.
            .sort((a, b) => (words.length ? Number(!a.item.name.toLowerCase().startsWith(words[0])) - Number(!b.item.name.toLowerCase().startsWith(words[0])) : 0) ||
              a.item.name.localeCompare(b.item.name));
          results.replaceChildren();
          if (filtered) {
            count.textContent = catalogData.length + ' items: search or pick a category';
            return;
          }
          count.textContent = matches.length + ' match' + (matches.length === 1 ? '' : 'es') + (matches.length > MAX ? ' · showing ' + MAX + ', refine to see the rest' : '');
          matches.slice(0, MAX).forEach(({ item, idx }) => {
            const li = document.createElement('li');
            const pick = document.createElement('button');
            pick.type = 'button';
            pick.className = 'catalog-result' + (chosen === idx ? ' is-chosen' : '');
            pick.title = item.description || '';
            const name = document.createElement('strong');
            name.textContent = item.name;
            const meta = document.createElement('span');
            meta.className = 'muted small';
            meta.textContent = item.category + ' · ' + item.tier + ' · ' + formatShopCopper(item.price);
            pick.append(name, meta);
            pick.addEventListener('click', () => {
              chosen = idx;
              autofillCatalog(idx);
              render();
              document.getElementById('itemStock').focus();
            });
            li.appendChild(pick);
            results.appendChild(li);
          });
        }
        search.addEventListener('input', render);
        category.addEventListener('change', render);
        tier.addEventListener('change', render);
        render();
      })();

      const shopPurchaseModal = document.getElementById('shopPurchaseModal');
      const shopPurchaseCharacter = document.getElementById('shopPurchaseCharacter');
      const shopPurchaseFeedback = document.getElementById('shopPurchaseFeedback');
      const shopPurchaseConfirm = document.getElementById('shopPurchaseConfirm');
      let selectedShopItemName = '';

      async function openShopPurchaseModal(itemName, price, finalPrice, discount, stock) {
        selectedShopItemName = itemName;
        document.getElementById('shopPurchaseItem').textContent = itemName;
        document.getElementById('shopPurchaseBasePrice').textContent = price;
        document.getElementById('shopPurchasePrice').textContent = finalPrice;
        document.getElementById('shopPurchaseDiscount').textContent = discount;
        document.getElementById('shopPurchaseStock').textContent =
          stock === '' ? 'Unlimited' : stock;
        document.getElementById('shopPurchaseQuantity').value = '1';
        document.getElementById('shopPurchaseQuantity').max = stock;
        shopPurchaseFeedback.textContent = '';
        shopPurchaseModal.hidden = false;
        shopPurchaseCharacter.replaceChildren(new Option('Loading characters...', ''));
        shopPurchaseConfirm.disabled = true;

        try {
          const response = await fetch('/api/my-characters');
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Could not load your characters.');
          shopPurchaseCharacter.replaceChildren(new Option('Select a character', ''));
          for (const character of data.characters) {
            shopPurchaseCharacter.add(new Option(
              character.name + ' (Lvl ' + character.level + ', ' +
                formatShopCopper(character.gold_cp) + ')',
              character.id
            ));
          }
          if (data.characters.length === 0) {
            shopPurchaseCharacter.replaceChildren(new Option('No living characters available', ''));
            shopPurchaseFeedback.textContent = 'You need a living character to make a purchase.';
          }
        } catch (error) {
          shopPurchaseCharacter.replaceChildren(new Option('Characters unavailable', ''));
          shopPurchaseFeedback.textContent = error.message;
        } finally {
          shopPurchaseConfirm.disabled = shopPurchaseCharacter.options.length < 2;
        }
      }

      function formatShopCopper(totalCp) {
        const amount = Number(totalCp);
        if (!Number.isSafeInteger(amount) || amount <= 0) return '0 cp';
        const gp = Math.floor(amount / 100);
        const remainder = amount % 100;
        const sp = Math.floor(remainder / 10);
        const cp = remainder % 10;
        return [
          gp ? gp + ' gp' : '',
          sp ? sp + ' sp' : '',
          cp ? cp + ' cp' : ''
        ].filter(Boolean).join(', ') || '0 cp';
      }

      document.querySelectorAll('.shop-buy-button').forEach(button => {
        button.addEventListener('click', () => openShopPurchaseModal(
          button.dataset.itemName,
          button.dataset.itemPrice,
          button.dataset.itemFinalPrice,
          button.dataset.itemDiscount,
          button.dataset.itemStock
        ));
      });
      document.getElementById('shopPurchaseCancel').addEventListener('click', () => {
        shopPurchaseModal.hidden = true;
      });
      shopPurchaseConfirm.addEventListener('click', async () => {
        const characterId = shopPurchaseCharacter.value;
        const quantity = Number(document.getElementById('shopPurchaseQuantity').value);
        if (!characterId || !Number.isSafeInteger(quantity) || quantity < 1) {
          shopPurchaseFeedback.textContent = 'Choose a character and enter a valid quantity.';
          return;
        }

        shopPurchaseConfirm.disabled = true;
        shopPurchaseFeedback.textContent = 'Completing your purchase...';
        try {
          const response = await fetch('/api/shop/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemName: selectedShopItemName, characterId, quantity })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Purchase failed.');
          shopPurchaseFeedback.textContent =
            'Purchase complete! ' + data.transaction.totalCostFormatted +
            ' paid. Remaining purse: ' + data.transaction.remainingPurseFormatted +
            '. Refreshing inventory...';
          window.setTimeout(() => window.location.reload(), 900);
        } catch (error) {
          shopPurchaseFeedback.textContent = error.message;
          shopPurchaseConfirm.disabled = false;
        }
      });
    </script>
  `;
  return contentHtml;
};
