// server.js — Express DM Admin Panel with Context Tabs, Restock & Custom Announcements
const express = require('express');
const router = express.Router();
const { REST, Routes, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { formatCp } = require('./currency');
const { restockShop } = require('./restock');

// Middleware parsowania formularzy i JSON
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

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

function decomposeCp(totalCp) {
  let rem = Math.max(0, parseInt(totalCp, 10) || 0);
  const pp = Math.floor(rem / 1000);
  rem %= 1000;
  const gp = Math.floor(rem / 100);
  rem %= 100;
  const ep = Math.floor(rem / 50);
  rem %= 50;
  const sp = Math.floor(rem / 10);
  const cp = rem % 10;
  return { pp, gp, ep, sp, cp };
}

// ─── POST ENDPOINTS: OPERATIONS & DISCORD ───────────────────────────────────

// Ręczne wywołanie restocku z panelu
router.post('/restock', async (req, res) => {
  try {
    await restockShop();
    res.redirect('/admin?tab=items&status=restocked');
  } catch (err) {
    console.error('Manual restock failed:', err);
    res.status(500).send(`Restock failed: ${escapeHtml(err.message)} <br><a href="/admin?tab=items">Back</a>`);
  }
});

// Wysłanie customowej wiadomości na kanał Discord
router.post('/message', async (req, res) => {
  try {
    const { title, message, as_embed } = req.body;
    const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
    const token = process.env.DISCORD_TOKEN;

    if (!token || !channelId) {
      throw new Error('Missing DISCORD_TOKEN or ANNOUNCEMENT_CHANNEL_ID in .env configuration.');
    }

    const trimmedMsg = (message || '').trim();
    if (!trimmedMsg) {
      throw new Error('Message body cannot be empty.');
    }

    const rest = new REST({ version: '10' }).setToken(token);

    let payload = {};
    if (as_embed === '1') {
      const embed = new EmbedBuilder()
        .setTitle(title ? title.trim() : "📜 Grimbold's Notice")
        .setColor(0xD4AF37)
        .setDescription(trimmedMsg)
        .setFooter({ text: "Grimbold the Shopkeeper" })
        .setTimestamp();

      payload = { embeds: [embed.toJSON()] };
    } else {
      payload = { content: trimmedMsg };
    }

    await rest.post(Routes.channelMessages(channelId), { body: payload });
    res.redirect('/admin?status=message_sent');
  } catch (err) {
    console.error('Failed to send Discord message:', err);
    res.status(400).send(`Failed to send message: ${escapeHtml(err.message)} <br><a href="/admin">Back</a>`);
  }
});

// ─── POST ENDPOINTS: PARTY LEVEL & ITEMS ────────────────────────────────────

router.post('/party-level', (req, res) => {
  const level = parseInt(req.body.party_level, 10);
  if (!isNaN(level) && level >= 1 && level <= 20) {
    db.setPartyLevel(level);
  }
  res.redirect('/admin?tab=items&status=level_updated');
});

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
    res.redirect('/admin?tab=items&status=item_added');
  } catch (err) {
    res.status(400).send(`Error adding item: ${escapeHtml(err.message)} <br><a href="/admin?tab=items">Back</a>`);
  }
});

router.post('/items/update', (req, res) => {
  const { id, action, value } = req.body;
  const itemId = parseInt(id, 10);
  if (action === 'stock') db.setStock(itemId, value === '' ? null : parseInt(value, 10));
  if (action === 'price') db.setPrice(itemId, parseInt(value, 10));
  if (action === 'toggle') db.setActive(itemId, parseInt(value, 10));
  if (action === 'delete') db.deleteItem(itemId);
  res.redirect('/admin?tab=items');
});

// ─── POST ENDPOINTS: CATALOG ────────────────────────────────────────────────

// POST /admin/catalog/add — dodawanie nowego przedmiotu z walutami D&D
router.post('/catalog/add', (req, res) => {
  try {
    const { name, category, tier, pp, gp, ep, sp, cp, description, min_level, min_stock, max_stock } = req.body;

    const valPp = parseInt(pp, 10) || 0;
    const valGp = parseInt(gp, 10) || 0;
    const valEp = parseInt(ep, 10) || 0;
    const valSp = parseInt(sp, 10) || 0;
    const valCp = parseInt(cp, 10) || 0;

    if (valPp < 0 || valGp < 0 || valEp < 0 || valSp < 0 || valCp < 0) {
      throw new Error('Currency values cannot be negative.');
    }

    const totalCp = (valPp * 1000) + (valGp * 100) + (valEp * 50) + (valSp * 10) + valCp;

    if (totalCp < 1) {
      throw new Error('Total base price must be at least 1 copper piece (1 cp).');
    }

    db.addCatalogItem({
      name,
      category,
      tier,
      base_price_cp: totalCp,
      description,
      min_level,
      min_stock,
      max_stock
    });

    res.redirect('/admin?tab=catalog&status=catalog_added');
  } catch (err) {
    res.redirect(`/admin?tab=catalog&err=${encodeURIComponent(err.message)}`);
  }
});

// POST /admin/catalog/update — aktualizacja przedmiotu z walutami D&D
router.post('/catalog/update', (req, res) => {
  try {
    const { id, name, category, tier, pp, gp, ep, sp, cp, description, min_level, min_stock, max_stock } = req.body;

    const valPp = parseInt(pp, 10) || 0;
    const valGp = parseInt(gp, 10) || 0;
    const valEp = parseInt(ep, 10) || 0;
    const valSp = parseInt(sp, 10) || 0;
    const valCp = parseInt(cp, 10) || 0;

    if (valPp < 0 || valGp < 0 || valEp < 0 || valSp < 0 || valCp < 0) {
      throw new Error('Currency values cannot be negative.');
    }

    const totalCp = (valPp * 1000) + (valGp * 100) + (valEp * 50) + (valSp * 10) + valCp;

    if (totalCp < 1) {
      throw new Error('Total base price must be at least 1 copper piece (1 cp).');
    }

    db.updateCatalogItem({
      id,
      name,
      category,
      tier,
      base_price_cp: totalCp,
      description,
      min_level,
      min_stock,
      max_stock
    });

    res.redirect('/admin?tab=catalog&status=catalog_updated');
  } catch (err) {
    res.redirect(`/admin?tab=catalog&err=${encodeURIComponent(err.message)}`);
  }
});

router.post('/catalog/delete', (req, res) => {
  try {
    const { id } = req.body;
    db.deleteCatalogItem(id);
    res.redirect('/admin?tab=catalog&status=catalog_deleted');
  } catch (err) {
    res.status(400).send(`Error deleting catalog item: ${escapeHtml(err.message)} <br><a href="/admin?tab=catalog">Back to Catalog</a>`);
  }
});

// ─── GET DASHBOARD ROUTE ──────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const currentTab = req.query.tab || 'items';
  const status = req.query.status;
  const partyLevel = db.getPartyLevel();
  const catalogItems = db.getAllCatalogItems ? db.getAllCatalogItems() : [];
  const activeItems = db.getAllItemsForAdmin ? db.getAllItemsForAdmin() : [];
  const sales = db.getAllSales ? db.getAllSales() : [];
  const rolls = db.getAllRolls ? db.getAllRolls() : [];

  let statusBanner = '';
  const errorMsg = req.query.err;
  if (errorMsg) {
    statusBanner = `<div class="alert red">⚠️ Validation Error: ${escapeHtml(errorMsg)}</div>`;
  } else if (status === 'catalog_added') {
    statusBanner = '<div class="alert green">✅ New item successfully added to Master Catalog!</div>';
  }
  if (status === 'restocked') {
    statusBanner = '<div class="alert green">✅ Store restocked successfully and announcement sent to Discord!</div>';
  } else if (status === 'message_sent') {
    statusBanner = '<div class="alert green">✅ Custom message from Grimbold has been sent to the Discord channel!</div>';
  } else if (status === 'level_updated') {
    statusBanner = '<div class="alert green">✅ Party level updated successfully!</div>';
  } else if (status === 'item_added') {
    statusBanner = '<div class="alert green">✅ Item added to shop shelves!</div>';
  } else if (status === 'catalog_updated') {
    statusBanner = '<div class="alert green">✅ Catalog item updated!</div>';
  } else if (status === 'catalog_deleted') {
    statusBanner = '<div class="alert red">🗑️ Catalog item permanently deleted.</div>';
  }

  let contentHtml = '';

  // ── ZAKŁADKA: ITEMS ──
  if (currentTab === 'items') {
    const catalogJson = JSON.stringify(catalogItems.map(c => ({
      name: c.name,
      category: c.category,
      price: c.base_price_cp,
      description: c.description
    })));

    contentHtml = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
        <!-- Campagin & Restock -->
        <div class="card" style="margin-bottom: 0;">
          <h3>Campaign Level & Shelf Restock</h3>
          <form method="POST" action="/admin/party-level" style="display:flex; align-items:center; gap: 10px; margin-bottom: 16px;">
            <label>Party Level:</label>
            <input type="number" name="party_level" min="1" max="20" value="${partyLevel}" required style="width: 70px;">
            <button type="submit" class="btn">Update Level</button>
          </form>

          <form method="POST" action="/admin/restock" onsubmit="return confirm('Trigger a full store restock? Current stock will be cleared and rolled anew, and Discord will be notified.');">
            <button type="submit" class="btn btn-gold" style="width: 100%; font-weight: bold; padding: 10px;">
              🔄 Trigger Manual Restock & Announce
            </button>
          </form>
        </div>

        <!-- Custom Grimbold Message -->
        <div class="card" style="margin-bottom: 0;">
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
        </div>
      </div>

      <div class="card">
        <h3>Add Item to Shop Shelf</h3>
        <div style="margin-bottom: 12px;">
          <label><strong>Quick-Fill from Catalog:</strong></label><br>
          <select id="catalogSelect" onchange="autofillCatalog()" style="width: 100%; max-width: 450px; padding: 6px; margin-top: 4px;">
            <option value="">-- Choose item from Master Catalog --</option>
            ${catalogItems.map((c, idx) => `<option value="${idx}">${escapeHtml(c.name)} (${c.tier} -${formatCp(c.base_price_cp)})</option>`).join('')}
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
          <tbody>
            ${activeItems.map(item => `
              <tr>
                <td data-sort="${item.id}">${item.id}</td>
                <td data-sort="${escapeHtml(item.name)}"><strong>${escapeHtml(item.name)}</strong></td>
                <td data-sort="${escapeHtml(item.category)}">${escapeHtml(item.category)}</td>
                <td data-sort="${item.price}">${formatCp(item.price)}</td>
                <td data-sort="${item.stock === null ? 999999 : item.stock}">${item.stock === null ? '∞' : item.stock}</td>
                <td data-sort="${item.is_active}">${item.is_active ? '<span class="tag green">Active</span>' : '<span class="tag red">Hidden</span>'}</td>
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
                    <button class="btn btn-small btn-red" onclick="return confirm('Delete item from shop?')">Delete</button>
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

    contentHtml = `
      ${formSectionHtml}
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
                <td data-sort="${s.created_at}">${s.created_at}</td>
                <td data-sort="${escapeHtml(s.buyer_tag)}">${escapeHtml(s.buyer_tag)}</td>
                <td data-sort="${escapeHtml(s.item_name)}"><strong>${escapeHtml(s.item_name)}</strong></td>
                <td data-sort="${s.quantity}">${s.quantity}</td>
                <td data-sort="${s.final_price}">${formatCp(s.final_price)}</td>
                <td data-sort="${s.total_paid}">${formatCp(s.total_paid)}</td>
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
              <th class="sortable">Player</th>
              <th class="sortable">d20 Result</th>
              <th class="sortable">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            ${rolls.length === 0 ? '<tr><td colspan="4">No rolls recorded yet.</td></tr>' : rolls.map(r => `
              <tr>
                <td data-sort="${r.week_start}">${r.week_start}</td>
                <td data-sort="${escapeHtml(r.display_name || r.user_id)}">
                  <strong>${escapeHtml(r.display_name || r.user_id)}</strong>${r.display_name && r.display_name !== r.user_id ? `<br><small style="color:#949ba4;">${r.user_id}</small>` : ''}
                </td>
                <td data-sort="${r.roll_value}"><strong>d20 = ${r.roll_value}</strong></td>
                <td data-sort="${r.created_at}">${r.created_at}</td>
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
        /* Tooltip helper icon & popup */
        .tooltip {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          background: #4e5058;
          color: #dbdee1;
          border-radius: 50%;
          font-size: 11px;
          font-weight: bold;
          cursor: help;
          margin-left: 6px;
          vertical-align: middle;
        }
        .tooltip:hover {
          background: #5865f2;
          color: #ffffff;
        }
        .tooltip .tooltip-text {
          visibility: hidden;
          opacity: 0;
          width: 280px;
          background-color: #111214;
          color: #dbdee1;
          text-align: left;
          border-radius: 6px;
          padding: 10px 12px;
          position: absolute;
          z-index: 100;
          bottom: 125%;
          left: 50%;
          transform: translateX(-50%);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          border: 1px solid #3b3e45;
          font-size: 12px;
          line-height: 1.4;
          font-weight: normal;
          transition: opacity 0.2s ease, visibility 0.2s ease;
          pointer-events: none;
        }
        .tooltip .tooltip-text::after {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          margin-left: -5px;
          border-width: 5px;
          border-style: solid;
          border-color: #111214 transparent transparent transparent;
        }
        .tooltip:hover .tooltip-text {
          visibility: visible;
          opacity: 1;
        }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1e1f22; color: #dbdee1; margin: 0; padding: 20px; box-sizing: border-box; }
        *, *:before, *:after { box-sizing: inherit; }
        .container { max-width: 1150px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid #2b2d31; padding-bottom: 10px; }
        .tab-btn { padding: 8px 16px; background: #2b2d31; color: #dbdee1; text-decoration: none; border-radius: 4px; font-weight: bold; }
        .tab-btn.active { background: #5865f2; color: #fff; }
        .card { background: #2b2d31; padding: 18px; border-radius: 8px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
        th, td { text-align: left; padding: 10px; border-bottom: 1px solid #35373c; }
        th { background: #1e1f22; color: #949ba4; }
        th.sortable { cursor: pointer; user-select: none; position: relative; transition: background-color 0.15s ease; }
        th.sortable:hover { background: #2b2d31; color: #fff; }
        th.sortable::after { content: ' ⇅'; opacity: 0.35; font-size: 11px; }
        th.sort-asc::after { content: ' ▲'; opacity: 1; color: #5865f2; }
        th.sort-desc::after { content: ' ▼'; opacity: 1; color: #5865f2; }
        input, textarea, select { background: #1e1f22; border: 1px solid #3b3e45; color: #fff; padding: 8px; border-radius: 4px; font-family: inherit; }
        .btn { background: #5865f2; color: #fff; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; }
        .btn-green { background: #23a55a; }
        .btn-red { background: #f23f43; }
        .btn-gold { background: #d4af37; color: #1e1f22; }
        .btn-small { padding: 4px 8px; font-size: 12px; text-decoration: none; display: inline-block; }
        .tag { padding: 3px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; background: #4e5058; }
        .tag.green { background: #23a55a; color: #fff; }
        .tag.red { background: #f23f43; color: #fff; }
        .alert { padding: 12px; border-radius: 6px; margin-bottom: 20px; font-weight: 500; font-size: 14px; }
        .alert.green { background: rgba(35, 165, 90, 0.2); border: 1px solid #23a55a; color: #23a55a; }
        .alert.red { background: rgba(242, 63, 67, 0.2); border: 1px solid #f23f43; color: #f23f43; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Grimbold's Emporium — Dungeon Master Hub</h2>
        </div>
        ${statusBanner}
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
              const isAscending = !header.classList.contains('sort-asc');

              header.parentNode.querySelectorAll('th').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
              });
              header.classList.add(isAscending ? 'sort-asc' : 'sort-desc');

              rows.sort((rowA, rowB) => {
                const cellA = rowA.children[index];
                const cellB = rowB.children[index];
                if (!cellA || !cellB) return 0;

                const rawA = cellA.hasAttribute('data-sort') ? cellA.getAttribute('data-sort') : cellA.innerText.trim();
                const rawB = cellB.hasAttribute('data-sort') ? cellB.getAttribute('data-sort') : cellB.innerText.trim();

                const numA = Number(rawA);
                const numB = Number(rawB);

                if (!isNaN(numA) && !isNaN(numB)) {
                  return isAscending ? numA - numB : numB - numA;
                }

                return isAscending 
                  ? rawA.localeCompare(rawB, undefined, { numeric: true, sensitivity: 'base' })
                  : rawB.localeCompare(rawA, undefined, { numeric: true, sensitivity: 'base' });
              });

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