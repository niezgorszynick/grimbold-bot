// server.js — Express DM Admin Panel with Context Tabs
const express = require('express');
const router = express.Router();
const db = require('./db');

// Basic Auth Middleware
router.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Grimbold Admin Panel"');
    return res.status(401).send('Authentication required.');
  }

  const [scheme, credentials] = authHeader.split(' ');
  if (scheme !== 'Basic' || !credentials) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Grimbold Admin Panel"');
    return res.status(401).send('Bad authentication format.');
  }

  const decoded = Buffer.from(credentials, 'base64').toString('utf8');
  const [username, password] = decoded.split(':');

  if (username === 'admin' && password === process.env.ADMIN_PASSWORD) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Grimbold Admin Panel"');
  return res.status(401).send('Invalid credentials.');
});

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── POST ENDPOINTS ──────────────────────────────────────────────────────────

// Zmiana Party Level
router.post('/party-level', (req, res) => {
  const level = parseInt(req.body.party_level, 10);
  if (!isNaN(level) && level >= 1 && level <= 20) {
    db.setPartyLevel(level);
  }
  res.redirect('/admin?tab=items');
});

// Dodawanie przedmiotu do items (ręczne lub z katalogu)
router.post('/items/add', (req, res) => {
  try {
    const { name, category, price, stock, description } = req.body;
    db.addItem({
      name,
      category,
      price: parseInt(price, 10),
      stock: stock === '' ? null : parseInt(stock, 10),
      description,
      is_active: 1
    });
    res.redirect('/admin?tab=items');
  } catch (err) {
    res.status(400).send(`Error adding item: ${err.message} <br><a href="/admin?tab=items">Back</a>`);
  }
});

// Aktualizacja stocku / ceny / aktywacji / usunięcia
router.post('/items/update', (req, res) => {
  const { id, action, value } = req.body;
  const itemId = parseInt(id, 10);
  if (action === 'stock') db.setStock(itemId, value === '' ? null : parseInt(value, 10));
  if (action === 'price') db.setPrice(itemId, parseInt(value, 10));
  if (action === 'toggle') db.setActive(itemId, parseInt(value, 10));
  if (action === 'delete') db.deleteItem(itemId);
  res.redirect('/admin?tab=items');
});

// ─── ENDPOINTY DLA CATALOG ──────────────────────────────────────────────────

router.post('/catalog/update', (req, res) => {
  try {
    const { id, name, category, tier, base_price_gp, description, min_level, min_stock, max_stock } = req.body;
    
    // Konwersja GP wprowadzonego przez DM na CP (1 gp = 100 cp)
    const priceGp = parseFloat(base_price_gp);
    if (isNaN(priceGp) || priceGp < 0) {
      throw new Error('Price in GP must be a valid number >= 0.');
    }
    const base_price_cp = Math.max(0, Math.round(priceGp * 100));

    db.updateCatalogItem({
      id,
      name,
      category,
      tier,
      base_price_cp,
      description,
      min_level,
      min_stock,
      max_stock
    });

    res.redirect('/admin?tab=catalog');
  } catch (err) {
    res.status(400).send(`Error updating catalog item: ${escapeHtml(err.message)} <br><a href="/admin?tab=catalog">Back to Catalog</a>`);
  }
});

router.post('/catalog/delete', (req, res) => {
  try {
    const { id } = req.body;
    db.deleteCatalogItem(id);
    res.redirect('/admin?tab=catalog');
  } catch (err) {
    res.status(400).send(`Error deleting catalog item: ${escapeHtml(err.message)} <br><a href="/admin?tab=catalog">Back to Catalog</a>`);
  }
});

// ─── GET DASHBOARD ROUTE ──────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const currentTab = req.query.tab || 'items';
  const partyLevel = db.getPartyLevel();
  const catalogItems = db.getAllCatalogItems ? db.getAllCatalogItems() : [];
  const activeItems = db.getAllItemsForAdmin ? db.getAllItemsForAdmin() : [];
  const sales = db.getAllSales ? db.getAllSales() : [];
  const rolls = db.getAllRolls ? db.getAllRolls() : [];

  let contentHtml = '';

  // ── ZAKŁADKA: ITEMS ──
  if (currentTab === 'items') {
    const catalogJson = JSON.stringify(catalogItems.map(c => ({
      name: c.name,
      category: c.category,
      price: Math.max(1, Math.round(c.base_price_cp / 100)),
      description: c.description
    })));

    contentHtml = `
      <div class="card">
        <h3>Campaign & Party Level</h3>
        <form method="POST" action="/admin/party-level" style="display:flex; align-items:center; gap: 10px;">
          <label>Current Party Level:</label>
          <input type="number" name="party_level" min="1" max="20" value="${partyLevel}" required style="width: 70px;">
          <button type="submit" class="btn">Update Level</button>
        </form>
      </div>

      <div class="card">
        <h3>Add Item to Shop Shelf</h3>
        <div style="margin-bottom: 12px;">
          <label><strong>Quick-Fill from Catalog:</strong></label><br>
          <select id="catalogSelect" onchange="autofillCatalog()" style="width: 100%; max-width: 450px; padding: 6px; margin-top: 4px;">
            <option value="">-- Choose item from Master Catalog --</option>
            ${catalogItems.map((c, idx) => `<option value="${idx}">${escapeHtml(c.name)} (${c.tier} -${Math.round(c.base_price_cp / 100)} gp)</option>`).join('')}
          </select>
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
              <label>Price (GP):</label><br>
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
      </div>

      <div class="card">
        <h3>Current Store Inventory (${activeItems.length})</h3>
        <table>
          <thead>
            <tr>
              <th class="sortable">ID</th>
              <th class="sortable">Name</th>
              <th class="sortable">Category</th>
              <th class="sortable">Price</th>
              <th class="sortable">Stock</th>
              <th class="sortable">Status</th>
              <th>Actions</th>
            </tr>
          </thead>
            </tr>
          </thead>
          <tbody>
            ${activeItems.map(item => `
              <tr>
                <td>${item.id}</td>
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td>${escapeHtml(item.category)}</td>
                <td>${item.price} gp</td>
                <td>${item.stock === null ? '∞' : item.stock}</td>
                <td>${item.is_active ? '<span class="tag green">Active</span>' : '<span class="tag red">Hidden</span>'}</td>
                <td>
                  <form method="POST" action="/admin/items/update" style="display:inline;">
                    <input type="hidden" name="id" value="${item.id}">
                    <input type="hidden" name="action" value="toggle">
                    <input type="hidden" name="value" value="${item.is_active ? 0 : 1}">
                    <button class="btn btn-small">${item.is_active ? 'Hide' : 'Show'}</button>
                  </form>
                  <form method="POST" action="/admin/items/update" style="display:inline;">
                    <input type="hidden" name="id" value="${item.id}">
                    <input type="hidden" name="action" value="delete">
                    <button class="btn btn-small btn-red" onclick="return confirm('Delete item?')">Delete</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <script>
        const catalogData = ${catalogJson};
        function autofillCatalog() {
          const idx = document.getElementById('catalogSelect').value;
          if (idx === '') return;
          const item = catalogData[idx];
          if (!item) return;
          document.getElementById('itemName').value = item.name;
          document.getElementById('itemCat').value = item.category;
          document.getElementById('itemPrice').value = item.price;
          document.getElementById('itemDesc').value = item.description;
          document.getElementById('itemStock').value = 1;
        }
      </script>
    `;
  }

  // ── ZAKŁADKA: CATALOG ──
  else if (currentTab === 'catalog') {
    const editId = req.query.edit_catalog ? parseInt(req.query.edit_catalog, 10) : null;
    const itemToEdit = editId ? db.getCatalogItemById(editId) : null;

    let editFormHtml = '';
    if (itemToEdit) {
      const priceGp = (itemToEdit.base_price_cp / 100).toFixed(2).replace(/\.00$/, '');
      editFormHtml = `
        <div class="card" style="border: 1px solid #5865f2;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3>Edit Item: ${escapeHtml(itemToEdit.name)} (ID: ${itemToEdit.id})</h3>
            <a href="/admin?tab=catalog" class="btn btn-small">Cancel</a>
          </div>
          <form method="POST" action="/admin/catalog/update">
            <input type="hidden" name="id" value="${itemToEdit.id}">
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
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
              <div>
                <label>Base Price (GP):</label><br>
                <input type="number" step="0.01" name="base_price_gp" min="0" value="${priceGp}" required style="width: 100%;">
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <div>
                <label>Min Party Level:</label><br>
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
            <div style="margin-bottom: 10px;">
              <label>Description:</label><br>
              <textarea name="description" rows="3" required style="width: 100%;">${escapeHtml(itemToEdit.description)}</textarea>
            </div>
            <button type="submit" class="btn btn-green">Save Changes</button>
          </form>
        </div>
      `;
    }

    contentHtml = `
      ${editFormHtml}
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
                <td>${c.id}</td>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td>${escapeHtml(c.category)}</td>
                <td><span class="tag">${c.tier}</span></td>
                <td>${Math.round(c.base_price_cp / 100)} gp (${c.base_price_cp} cp)</td>
                <td>Lvl ${c.min_level}</td>
                <td>${c.min_stock} – ${c.max_stock}</td>
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
  }

  // ── ZAKŁADKA: SALES ──
  else if (currentTab === 'sales') {
    contentHtml = `
      <div class="card">
        <h3>Transaction Ledger (Last 100 Sales)</h3>
        <table>
          <thead>
            <tr>
              <th class="sortable">Date</th>
              <th class="sortable">Buyer</th>
              <th class="sortable">Item</th>
              <th class="sortable">Qty</th>
              <th class="sortable">Final Price</th>
              <th class="sortable">Total Paid</th>
            </tr>
          </thead>
          <tbody>
            ${sales.length === 0 ? '<tr><td colspan="6">No sales recorded yet.</td></tr>' : sales.map(s => `
              <tr>
                <td>${s.created_at}</td>
                <td>${escapeHtml(s.buyer_tag)}</td>
                <td><strong>${escapeHtml(s.item_name)}</strong></td>
                <td>${s.quantity}</td>
                <td>${s.final_price} gp</td>
                <td>${s.total_paid} gp</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── ZAKŁADKA: ROLLS ──
  else if (currentTab === 'rolls') {
    contentHtml = `
      <div class="card">
        <h3>Player Discount Rolls (Last 100)</h3>
        <table>
          <thead>
            <tr>
              <th class="sortable">Week Start</th>
              <th class="sortable">User ID</th>
              <th class="sortable">d20 Result</th>
              <th class="sortable">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            ${rolls.length === 0 ? '<tr><td colspan="4">No rolls recorded yet.</td></tr>' : rolls.map(r => `
              <tr>
                <td>${r.week_start}</td>
                <td>${escapeHtml(r.user_id)}</td>
                <td><strong>d20 = ${r.roll_value}</strong></td>
                <td>${r.created_at}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Główny layout HTML
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Grimbold Admin Panel</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1e1f22; color: #dbdee1; margin: 0; padding: 20px; }
        .container { max-width: 1100px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid #2b2d31; padding-bottom: 10px; }
        .tab-btn { padding: 8px 16px; background: #2b2d31; color: #dbdee1; text-decoration: none; border-radius: 4px; font-weight: bold; }
        .tab-btn.active { background: #5865f2; color: #fff; }
        .card { background: #2b2d31; padding: 18px; border-radius: 8px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
        th, td { text-align: left; padding: 10px; border-bottom: 1px solid #35373c; }
        th { background: #1e1f22; color: #949ba4; }
        input, textarea, select { background: #1e1f22; border: 1px solid #3b3e45; color: #fff; padding: 8px; border-radius: 4px; }
        .btn { background: #5865f2; color: #fff; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; }
        .btn-green { background: #23a55a; }
        .btn-red { background: #f23f43; }
        .btn-small { padding: 4px 8px; font-size: 12px; }
        .tag { padding: 3px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; background: #4e5058; }
        .tag.green { background: #23a55a; color: #fff; }
        .tag.red { background: #f23f43; color: #fff; }
        th.sortable { 
          cursor: pointer; 
          user-select: none; 
          position: relative; 
          transition: background-color 0.15s ease;
        }
        th.sortable:hover { 
          background: #2b2d31; 
          color: #fff; 
        }
        th.sortable::after { 
          content: ' ⇅'; 
          opacity: 0.35; 
          font-size: 11px; 
        }
        th.sort-asc::after { 
          content: ' ▲'; 
          opacity: 1; 
          color: #5865f2; 
        }
        th.sort-desc::after { 
          content: ' ▼'; 
          opacity: 1; 
          color: #5865f2; 
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Grimbold's Emporium — Dungeon Master Hub</h2>
        </div>
        <div class="tabs">
          <a href="/admin?tab=items" class="tab-btn ${currentTab === 'items' ? 'active' : ''}">Shop Items</a>
          <a href="/admin?tab=catalog" class="tab-btn ${currentTab === 'catalog' ? 'active' : ''}">Master Catalog</a>
          <a href="/admin?tab=sales" class="tab-btn ${currentTab === 'sales' ? 'active' : ''}">Sales Ledger</a>
          <a href="/admin?tab=rolls" class="tab-btn ${currentTab === 'rolls' ? 'active' : ''}">Rolls History</a>
        </div>
        ${contentHtml}
      </div>
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          document.querySelectorAll('th.sortable').forEach(header => {
            header.addEventListener('click', () => {
              const table = header.closest('table');
              const tbody = table.querySelector('tbody');
              const rows = Array.from(tbody.querySelectorAll('tr'));
              const index = Array.from(header.parentNode.children).indexOf(header);
              const currentAsc = header.classList.contains('sort-asc');
              const isAscending = !currentAsc;

              // Reset klas na pozostałych nagłówkach w obrębie tabeli
              header.parentNode.querySelectorAll('th').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
              });
              header.classList.add(isAscending ? 'sort-asc' : 'sort-desc');

              // Funkcja normalizująca komórki pod kątem liczb, walut i dat
              const parseCellValue = (text) => {
                const raw = text.trim();
                if (raw === '∞') return Infinity;

                // Wyodrębnienie pierwszej liczby (np. "12 gp", "Lvl 3", "d20 = 17", "1 – 3")
                const matchNumber = raw.match(/-?\d+(\.\d+)?/);
                if (matchNumber && !isNaN(matchNumber[0])) {
                  // Jeśli to nie jest data w formacie ISO (YYYY-MM-DD)
                  if (!raw.match(/^\d{4}-\d{2}-\d{2}/)) {
                    return parseFloat(matchNumber[0]);
                  }
                }

                // Sprawdzenie czy to data ISO
                const parsedDate = Date.parse(raw);
                if (!isNaN(parsedDate) && raw.length > 7 && (raw.includes('-') || raw.includes(':'))) {
                  return parsedDate;
                }

                return raw.toLowerCase();
              };

              rows.sort((rowA, rowB) => {
                const cellA = rowA.children[index] ? rowA.children[index].innerText : '';
                const cellB = rowB.children[index] ? rowB.children[index].innerText : '';

                const valA = parseCellValue(cellA);
                const valB = parseCellValue(cellB);

                if (valA < valB) return isAscending ? -1 : 1;
                if (valA > valB) return isAscending ? 1 : -1;
                return 0;
              });

              // Ponowne wstawienie posortowanych wierszy do DOM
              rows.forEach(row => tbody.appendChild(row));
            });
          });
        });
      </script>
    </body>
    </html>
  `);
});

module.exports = router;