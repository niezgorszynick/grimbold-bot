// server.js — DM Admin Panel for Grimbold's Emporium
const express = require('express');
const db = require('./db');

const router = express.Router();

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'grimbold123';

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Grimbold DM Panel"');
    return res.status(401).send('Authentication required.');
  }

  const [scheme, credentials] = authHeader.split(' ');
  if (scheme !== 'Basic' || !credentials) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Grimbold DM Panel"');
    return res.status(401).send('Invalid auth format.');
  }

  const [user, pass] = Buffer.from(credentials, 'base64').toString().split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Grimbold DM Panel"');
  return res.status(401).send('Invalid credentials.');
}

function renderAdminHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Grimbold's Emporium — DM Panel</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1e1f22; color: #dbdee1; margin: 0; padding: 24px; }
    h1, h2 { color: #f2f3f5; }
    .card { background: #2b2d31; border-radius: 8px; padding: 20px; margin-bottom: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #35373c; }
    th { background: #1e1f22; color: #949ba4; font-size: 13px; text-transform: uppercase; }
    input, select, textarea { background: #383a40; border: 1px solid #4e5058; color: #fff; padding: 8px 12px; border-radius: 4px; font-size: 14px; width: 100%; box-sizing: border-box; }
    input[type="checkbox"] { width: auto; }
    button { background: #5865f2; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; }
    button:hover { background: #4752c4; }
    .btn-danger { background: #da373c; }
    .btn-danger:hover { background: #a1282c; }
    .btn-sm { padding: 4px 8px; font-size: 12px; }
    .form-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .msg { padding: 10px; border-radius: 4px; margin-bottom: 12px; display: none; }
    .msg-success { background: #23a55a; color: #fff; }
    .msg-error { background: #da373c; color: #fff; }
    .badge { padding: 3px 7px; border-radius: 4px; font-size: 11px; }
    .badge-active { background: #23a55a; color: #fff; }
    .badge-hidden { background: #80848e; color: #fff; }
  </style>
</head>
<body>
  <h1>🧙‍♂️ Grimbold's Emporium — DM Admin Panel</h1>
  <div id="statusMsg" class="msg"></div>

  <div class="card">
    <h2>➕ Add New Item to Catalog</h2>
    <form id="addForm">
      <div class="form-grid">
        <div>
          <label>Item Name *</label>
          <input type="text" id="name" required placeholder="e.g. Mithral Splint">
        </div>
        <div>
          <label>Category *</label>
          <select id="category" required>
            <option value="Adventuring Gear">Adventuring Gear</option>
            <option value="Armor">Armor</option>
            <option value="Weapons">Weapons</option>
            <option value="Tools">Tools</option>
            <option value="Potion">Potion</option>
            <option value="General">General</option>
          </select>
        </div>
        <div>
          <label>Price in Gold (gp) *</label>
          <input type="number" id="price" min="0" required placeholder="e.g. 50">
        </div>
        <div>
          <label>Stock</label>
          <input type="number" id="stock" min="0" placeholder="e.g. 3">
          <label style="font-size: 12px; margin-top: 4px; display: block;">
            <input type="checkbox" id="unlimitedStock"> Unlimited (∞)
          </label>
        </div>
      </div>
      <div style="margin-bottom: 12px;">
        <label>Description *</label>
        <textarea id="description" rows="2" required placeholder="Full mechanical rules, damage or properties..."></textarea>
      </div>
      <button type="submit">Add to Inventory</button>
    </form>
  </div>

  <div class="card">
    <h2>📦 Current Shop Inventory (SQLite)</h2>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Category</th>
          <th>Name</th>
          <th>Price (gp)</th>
          <th>Stock</th>
          <th>Description</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="itemsBody">
        <tr><td colspan="7">Loading inventory...</td></tr>
      </tbody>
    </table>
  </div>

  <script>
    const unlimitedCheckbox = document.getElementById('unlimitedStock');
    const stockInput = document.getElementById('stock');
    unlimitedCheckbox.addEventListener('change', () => {
      stockInput.disabled = unlimitedCheckbox.checked;
      if (unlimitedCheckbox.checked) stockInput.value = '';
    });

    function showMsg(text, isError = false) {
      const msg = document.getElementById('statusMsg');
      msg.textContent = text;
      msg.className = 'msg ' + (isError ? 'msg-error' : 'msg-success');
      msg.style.display = 'block';
      setTimeout(() => { msg.style.display = 'none'; }, 4000);
    }

    async function loadItems() {
      const res = await fetch('/admin/api/items');
      const items = await res.json();
      const tbody = document.getElementById('itemsBody');
      tbody.innerHTML = '';

      items.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td><span class="badge \${item.is_active ? 'badge-active' : 'badge-hidden'}">\${item.is_active ? 'Active' : 'Hidden'}</span></td>
          <td>\${item.category}</td>
          <td><strong>\${item.name}</strong></td>
          <td><input type="number" min="0" value="\${item.price}" style="width: 80px;" onchange="updatePrice(\${item.id}, this.value)"></td>
          <td>
            <input type="text" value="\${item.stock === null ? '∞' : item.stock}" style="width: 60px;" onchange="updateStock(\${item.id}, this.value)">
          </td>
          <td style="max-width: 320px; font-size: 13px; color: #949ba4;">\${item.description}</td>
          <td>
            <button class="btn-sm" onclick="toggleActive(\${item.id}, \${item.is_active ? 0 : 1})">\${item.is_active ? 'Hide' : 'Show'}</button>
            <button class="btn-sm btn-danger" onclick="deleteItem(\${item.id})">Delete</button>
          </td>
        \`;
        tbody.appendChild(tr);
      });
    }

    document.getElementById('addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('name').value.trim();
      const category = document.getElementById('category').value;
      const price = parseInt(document.getElementById('price').value, 10);
      const isUnlimited = document.getElementById('unlimitedStock').checked;
      const stock = isUnlimited ? null : parseInt(document.getElementById('stock').value, 10);
      const description = document.getElementById('description').value.trim();

      if (!name || !category || isNaN(price) || !description || (!isUnlimited && isNaN(stock))) {
        return showMsg('Error: All required fields must be filled out properly!', true);
      }

      const res = await fetch('/admin/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, price, stock, description })
      });

      const data = await res.json();
      if (res.ok) {
        showMsg('Item added successfully!');
        document.getElementById('addForm').reset();
        stockInput.disabled = false;
        loadItems();
      } else {
        showMsg('Error: ' + (data.error || 'Failed to add item'), true);
      }
    });

    async function updatePrice(id, newPrice) {
      const price = parseInt(newPrice, 10);
      if (isNaN(price) || price < 0) return alert('Invalid price');
      await fetch('/admin/api/items/' + id + '/price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price })
      });
      loadItems();
    }

    async function updateStock(id, newStock) {
      let stock = newStock.trim() === '∞' || newStock.trim() === '' ? null : parseInt(newStock, 10);
      if (stock !== null && (isNaN(stock) || stock < 0)) return alert('Invalid stock');
      await fetch('/admin/api/items/' + id + '/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock })
      });
      loadItems();
    }

    async function toggleActive(id, isActive) {
      await fetch('/admin/api/items/' + id + '/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive })
      });
      loadItems();
    }

    async function deleteItem(id) {
      if (!confirm('Are you sure you want to delete this item from the database?')) return;
      await fetch('/admin/api/items/' + id, { method: 'DELETE' });
      loadItems();
    }

    loadItems();
  </script>
</body>
</html>`;
}

router.use(requireAuth);

router.get('/', (req, res) => {
  res.send(renderAdminHtml());
});

router.get('/api/items', (req, res) => {
  const items = db.getAllItemsForAdmin();
  res.json(items);
});

router.post('/api/items', (req, res) => {
  try {
    db.addItem(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/items/:id/price', (req, res) => {
  db.setPrice(req.params.id, req.body.price);
  res.json({ success: true });
});

router.post('/api/items/:id/stock', (req, res) => {
  db.setStock(req.params.id, req.body.stock);
  res.json({ success: true });
});

router.post('/api/items/:id/active', (req, res) => {
  db.setActive(req.params.id, req.body.is_active);
  res.json({ success: true });
});

router.delete('/api/items/:id', (req, res) => {
  db.deleteItem(req.params.id);
  res.json({ success: true });
});

module.exports = router;