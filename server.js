// server.js — Express DM Admin Panel with Context Tabs, Restock & Custom Announcements
const express = require('express');
const router = express.Router();
const { REST, Routes, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { formatCp } = require('./currency');
const { restockShop } = require('./restock');
const { DND_SPECIES, DND_CLASSES_AND_SUBCLASSES } = require('./dndData');

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

router.post('/restock-settings', (req, res) => {
  try {
    const {
      party_level,
      commons_count,
      cantrips_count,
      lvl1_count,
      rares_count,
      magics_count,
      fluctuation_min,
      fluctuation_max
    } = req.body;

    const pLevel = parseInt(party_level, 10);
    const cCount = parseInt(commons_count, 10);
    const cantCount = parseInt(cantrips_count, 10);
    const l1Count = parseInt(lvl1_count, 10);
    const rCount = parseInt(rares_count, 10);
    const mCount = parseInt(magics_count, 10);
    const fMin = parseFloat(fluctuation_min);
    const fMax = parseFloat(fluctuation_max);

    if (pLevel < 1 || pLevel > 20) throw new Error('Party Level must be between 1 and 20.');
    if (cCount < 0 || cantCount < 0 || l1Count < 0 || rCount < 0 || mCount < 0) {
      throw new Error('Stock counts cannot be negative.');
    }
    if (isNaN(fMin) || isNaN(fMax) || fMin <= 0 || fMax < fMin) {
      throw new Error('Invalid price fluctuation range (Min must be > 0 and Max >= Min).');
    }

    db.setRestockConfig({
      party_level: pLevel,
      commons_count: cCount,
      cantrips_count: cantCount,
      lvl1_count: l1Count,
      rares_count: rCount,
      magics_count: mCount,
      fluctuation_min: fMin,
      fluctuation_max: fMax
    });

    res.redirect('/admin?tab=restock&status=settings_updated');
  } catch (err) {
    res.redirect(`/admin?tab=restock&err=${encodeURIComponent(err.message)}`);
  }
});

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

// ─── POST ENDPOINTS: PLAYERS & CHARACTERS ──────────────────────────────────

router.post('/players/add', (req, res) => {
  try {
    const { discord_id, discord_tag } = req.body;
    db.addPlayer({ discord_id, discord_tag });
    res.redirect('/admin?tab=players&status=player_added');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

router.post('/players/update', (req, res) => {
  try {
    const { id, discord_id, discord_tag } = req.body;
    db.updatePlayer({ id: parseInt(id, 10), discord_id, discord_tag });
    res.redirect('/admin?tab=players&status=player_updated');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

router.post('/players/delete', (req, res) => {
  try {
    const { id } = req.body;
    db.deletePlayer(parseInt(id, 10));
    res.redirect('/admin?tab=players&status=player_deleted');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

router.post('/characters/add', (req, res) => {
  try {
    const { player_id, name, race, class_name, subclass, xp, status } = req.body;
    db.addCharacter({ player_id, name, race, class_name, subclass, xp, status });
    res.redirect('/admin?tab=players&status=char_added');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

router.post('/characters/update', (req, res) => {
  try {
    const {
      id,
      player_id,
      name,
      race,
      class_name,
      subclass,
      xp,
      level,
      override_level,
      status,
      adventure_ids,
      class_allocations
    } = req.body;
    const selectedAdventureIds = adventure_ids
      ? (Array.isArray(adventure_ids) ? adventure_ids : [adventure_ids]).map(Number)
      : [];
    let selectedClassAllocations;
    if (class_allocations !== undefined) {
      try {
        selectedClassAllocations = JSON.parse(class_allocations);
      } catch {
        throw new Error('Invalid class allocation data.');
      }
    }
    db.updateCharacterWithAdventures({
      id,
      player_id,
      name,
      race,
      class_name,
      subclass,
      xp,
      level,
      override_level,
      status,
      adventure_ids: selectedAdventureIds,
      class_allocations: selectedClassAllocations
    });
    res.redirect('/admin?tab=players&status=char_updated');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

router.post('/characters/delete', (req, res) => {
  try {
    const { id } = req.body;
    db.deleteCharacter(parseInt(id, 10));
    res.redirect('/admin?tab=players&status=char_deleted');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

// POST: Przypisanie 1 punktu DM do wybranej postaci
router.post('/players/assign-dm-point', (req, res) => {
  try {
    const { player_id, character_id } = req.body;
    db.assignDmPointToCharacter(parseInt(player_id, 10), parseInt(character_id, 10));
    res.redirect('/admin?tab=players&status=dm_point_assigned');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

// POST: Zapisanie ukończonej przygody i przyznanie XP / punktu DM
router.post('/adventures/add', (req, res) => {
  try {
    const { title, description, xp_awarded, dm_player_id, dm_character_id, character_ids } = req.body;
    
    // Checkboxy HTML zwracają string (jeden wybór) lub tablicę (wiele wyborów)
    let assignedCharIds = [];
    if (character_ids) {
      assignedCharIds = Array.isArray(character_ids) ? character_ids.map(Number) : [parseInt(character_ids, 10)];
    }

    db.recordAdventure({
      title: title.trim(),
      description,
      xp_awarded,
      dm_player_id: dm_player_id ? parseInt(dm_player_id, 10) : null,
      dm_character_id: dm_character_id ? parseInt(dm_character_id, 10) : null,
      character_ids: assignedCharIds
    });

    res.redirect('/admin?tab=adventures&status=adventure_recorded');
  } catch (err) {
    res.redirect(`/admin?tab=adventures&err=${encodeURIComponent(err.message)}`);
  }
});

router.post(['/adventures/update', '/adventures/edit'], (req, res) => {
  try {
    const { adventure_id, title, description, xp_awarded, dm_player_id, dm_character_id, character_ids } = req.body;
    const assignedCharIds = character_ids
      ? (Array.isArray(character_ids) ? character_ids : [character_ids]).map(Number)
      : [];

    db.updateAdventure({
      adventure_id,
      title: (title || '').trim(),
      description: (description || '').trim(),
      xp_awarded: parseInt(xp_awarded, 10),
      dm_player_id: dm_player_id ? parseInt(dm_player_id, 10) : null,
      dm_character_id: dm_character_id ? parseInt(dm_character_id, 10) : null,
      character_ids: assignedCharIds
    });

    res.redirect('/admin?tab=adventures&status=adventure_updated');
  } catch (err) {
    res.redirect(`/admin?tab=adventures&edit_adv=${encodeURIComponent(req.body.adventure_id)}&err=${encodeURIComponent(err.message)}`);
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
  } else if (status === 'player_added') {
    statusBanner = '<div class="alert green">✅ Player successfully registered!</div>';
  } else if (status === 'player_updated') {
    statusBanner = '<div class="alert green">✅ Player info updated!</div>';
  } else if (status === 'player_deleted') {
    statusBanner = '<div class="alert red">🗑️ Player and associated characters deleted.</div>';
  } else if (status === 'char_added') {
    statusBanner = '<div class="alert green">✅ Character created successfully!</div>';
  } else if (status === 'char_updated') {
    statusBanner = '<div class="alert green">✅ Character updated!</div>';
  } else if (status === 'char_deleted') {
    statusBanner = '<div class="alert red">🗑️ Character removed.</div>';
  } else if (status === 'dm_point_assigned') {
    statusBanner = '<div class="alert green">✨ Przypisano 1 punkt DM! Postać otrzymała 1 XP i przeliczono jej poziom.</div>';
  } else if (status === 'adventure_recorded') {
    statusBanner = '<div class="alert green">⚔️ Przygoda zapisana! Przyznano XP uczestnikom i punkt DM dla prowadzącego.</div>';
  } else if (status === 'adventure_updated') {
    statusBanner = '<div class="alert green">⚔️ Adventure updated and rewards adjusted successfully.</div>';
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
      <div class="card" style="margin-bottom: 20px;">
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

      // ── TAB: ADVENTURES ──
  else if (currentTab === 'adventures') {
    const allAdventures = db.getAllAdventures ? db.getAllAdventures() : [];
    const allPlayers = db.getAllPlayers ? db.getAllPlayers() : [];
    const editAdvId = req.query.edit_adv ? Number(req.query.edit_adv) : null;
    let editingAdventure = null;
    let editingParticipantIds = [];

    if (Number.isSafeInteger(editAdvId) && editAdvId > 0) {
      editingAdventure = db.getAdventureById(editAdvId) || null;
      if (editingAdventure) {
        editingParticipantIds = db.getAdventureParticipantIds(editAdvId);
      }
    }
    if (req.query.edit_adv && !editingAdventure) {
      statusBanner = '<div class="alert red">Adventure not found. It may have been deleted.</div>';
    }

    const allCharacters = db.getAllCharacters
      ? db.getAllCharacters()
      : db.prepare('SELECT c.*, p.discord_tag, p.dm_points FROM characters c LEFT JOIN players p ON c.player_id = p.id ORDER BY c.name ASC').all();
    const playerRows = db.getAllPlayersWithCharacters ? db.getAllPlayersWithCharacters() : [];
    const activeCharacters = playerRows.filter(r => r.character_id && r.character_status === 'alive');
    const adventureCharacters = editingAdventure
      ? allCharacters
        .filter(c => c.status === 'alive' || editingParticipantIds.includes(c.id))
        .map(c => ({
          character_id: c.id,
          character_name: c.name,
          character_level: c.level,
          character_class: c.class,
          discord_tag: c.discord_tag,
          player_id: c.player_id
        }))
      : activeCharacters;
    const playersById = new Map(allPlayers.map(player => [player.id, player]));
    const charactersByPlayer = new Map();
    adventureCharacters.forEach(character => {
      if (!charactersByPlayer.has(character.player_id)) {
        charactersByPlayer.set(character.player_id, []);
      }
      charactersByPlayer.get(character.player_id).push(character);
    });
    const characterGroupsHtml = Array.from(charactersByPlayer.entries()).map(([playerId, characters]) => {
      const player = playersById.get(playerId);
      const playerName = player ? player.discord_tag : (characters[0].discord_tag || 'Unknown');
      return `
        <div class="player-group" data-player="${escapeHtml(playerName.toLowerCase())}">
          <div class="player-group-title">
            ${escapeHtml(playerName)} <span style="color: #949ba4; font-family: monospace;">(${player ? player.dm_points || 0 : 0} DM pts)</span>
          </div>
          <div class="character-grid">
            ${characters.map(c => `
              <div class="char-item" data-name="${escapeHtml(c.character_name.toLowerCase())}" data-player="${escapeHtml(playerName.toLowerCase())}">
                <label>
                  <input class="char-checkbox" type="checkbox" name="character_ids" value="${c.character_id}" id="adventure_char_${c.character_id}" ${editingParticipantIds.includes(c.character_id) ? 'checked' : ''}>
                  <strong>${escapeHtml(c.character_name)}</strong> <span style="color: #949ba4;">(Lvl ${c.character_level} ${escapeHtml(c.character_class)})</span>
                </label>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
    const adventureFormAction = editingAdventure ? '/admin/adventures/edit' : '/admin/adventures/add';

    contentHtml = `
      <div class="adventure-layout">
        
            <!-- Adventure Record Form -->
            <div class="card" style="margin-bottom: 0;">
              <h3>${editingAdventure ? 'Edit Completed Adventure' : 'Record Completed Adventure'}</h3>
              <p style="font-size: 13px; color: #949ba4; margin-top: -5px; margin-bottom: 14px;">
                ${editingAdventure
                  ? 'Updating this adventure adjusts participant XP and the DM reward.'
                  : 'Finalizing an adventure awards XP to all selected characters and grants +1 DM Point to the host.'}
              </p>

              <form method="POST" action="${adventureFormAction}">
                ${editingAdventure ? `<input type="hidden" name="adventure_id" value="${editingAdventure.id}">` : ''}
                <div style="margin-bottom: 10px;">
                  <label>Adventure Title:</label><br>
                  <input type="text" name="title" value="${editingAdventure ? escapeHtml(editingAdventure.title) : ''}" placeholder="e.g. Seekers of the Lost Tomb - Part 1" required style="width: 100%; margin-top: 4px;">
                </div>
            
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                  <div>
                    <label>Dungeon Master (Host):</label><br>
                    <select name="dm_player_id" style="width: 100%; margin-top: 4px;">
                      <option value="">-- No DM Point awarded --</option>
                  ${allPlayers.map(p => `<option value="${p.id}" ${editingAdventure && Number(p.id) === Number(editingAdventure.dm_player_id) ? 'selected' : ''}>${escapeHtml(p.discord_tag)}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label>Adventure XP Points:</label><br>
                    <input type="number" name="xp_awarded" min="1" value="${editingAdventure ? editingAdventure.xp_awarded : 1}" required style="width: 100%; margin-top: 4px;">
                  </div>
                </div>

                <div style="margin-bottom: 10px;">
                  <label>Direct DM Character Reward (+1 XP):</label><br>
                  <select name="dm_character_id" style="width: 100%; margin-top: 4px;">
                    <option value="">-- Bank +1 Point to DM Bank --</option>
                    ${allCharacters.map(c => `<option value="${c.id}" ${editingAdventure && Number(c.id) === Number(editingAdventure.dm_character_id) ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.discord_tag || 'Unknown')}, Lvl ${c.level}, ${c.xp} XP)</option>`).join('')}
                  </select>
                  <small style="display: block; color: #949ba4; margin-top: 4px;">Choose a DM character to award +1 XP directly, or leave empty to bank +1 DM Point with the selected host.</small>
                </div>

                <div style="margin-bottom: 10px;">
                  <label>Session Summary / Notes:</label><br>
                  <textarea name="description" rows="2" placeholder="Brief chronicle of the adventure..." style="width: 100%; margin-top: 4px;">${editingAdventure ? escapeHtml(editingAdventure.description || '') : ''}</textarea>
                </div>

                <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
                  <label style="display: flex; justify-content: space-between; font-weight: bold; color: #d4af37; font-size: 13px;">
                    <span>Participating Characters</span>
                    <span id="selected-count" style="color: #949ba4; font-weight: normal;">Selected: 0</span>
                  </label>
                  <input type="text" id="character-search" placeholder="Filter by player or character name..." style="width: 100%; margin-top: 8px;">
                  <div id="characters-container" style="max-height: 240px; overflow-y: auto; margin-top: 8px; padding: 8px; border: 1px solid #3b3e45; border-radius: 4px;">
                    ${characterGroupsHtml || '<p style="color: #949ba4; font-size: 12px;">No active characters available.</p>'}
                  </div>
                  <div id="selected-badges-container" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px;">
                    <span style="color: #949ba4; font-size: 12px;">Party:</span>
                  </div>
                </div>

                <button type="submit" class="btn btn-green" style="padding: 10px 16px;">${editingAdventure ? 'Save Adventure Changes' : '⚔️ Finalize Adventure & Award Rewards'}</button>
                ${editingAdventure ? '<a href="/admin?tab=adventures" class="btn" style="display: inline-block; margin-top: 8px;">Cancel Edit</a>' : ''}
              </form>
        </div>

        <!-- Leveling Rules Card -->
        <div class="card" style="margin-bottom: 0;">
          <h3>Campaign Leveling & Milestone Rules</h3>
          <div style="font-size: 13px; line-height: 1.6; color: #dbdee1;">
            <p><strong>• Starting Baseline:</strong> Every newly registered adventurer starts at <strong>Level 3</strong> (0 Adventure XP).</p>
            <p><strong>• Milestone Thresholds:</strong></p>
            <ul style="padding-left: 20px; margin-top: 4px;">
              <li><strong>Level 3 &rarr; Level 4:</strong> Requires <strong>3 Completed Adventures</strong> (3 XP).</li>
              <li><strong>Level 4 &rarr; Level 5:</strong> Requires <strong>4 Completed Adventures</strong> (7 total XP).</li>
              <li><strong>Level 5+ Progression:</strong> Requires <strong>4 Completed Adventures</strong> per subsequent level.</li>
            </ul>
            <p><strong>• Dungeon Master Bonus:</strong> Hosting an adventure automatically awards +1 DM Adventure Point into the DM's bank, assignable to any of their own characters in the <em>Players</em> tab as +1 XP.</p>
          </div>
        </div>
      </div>

      <!-- Adventures History Table -->
      <div class="card">
        <h3>Completed Adventures History (${allAdventures.length})</h3>
        <div class="adventure-table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable">Date</th>
              <th class="sortable">Title</th>
              <th class="sortable">Dungeon Master</th>
              <th class="sortable">XP Granted</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${allAdventures.length === 0 ? '<tr><td colspan="6">No completed adventures recorded yet.</td></tr>' : allAdventures.map(adv => `
              <tr>
                <td data-sort="${adv.created_at}">${adv.created_at}</td>
                <td data-sort="${escapeHtml(adv.title)}"><strong>${escapeHtml(adv.title)}</strong></td>
                <td data-sort="${escapeHtml(adv.dm_name || '')}">${adv.dm_name ? escapeHtml(adv.dm_name) : '<em>None</em>'}</td>
                <td data-sort="${adv.xp_awarded}"><span class="tag green">+${adv.xp_awarded} XP</span></td>
                <td>${escapeHtml(adv.description || '—')}</td>
                <td style="text-align: right;"><a class="btn btn-small btn-gold" href="/admin?tab=adventures&edit_adv=${adv.id}">Edit</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── ZAKŁADKA: RESTOCK ENGINE ──
  else if (currentTab === 'restock') {
    const cfg = db.getRestockConfig();

    contentHtml = `
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
        <div class="card">
          <h3>Weekly Restock Algorithm Parameters</h3>
          <p style="color: #949ba4; font-size: 13px; margin-top: -5px; margin-bottom: 20px;">
            Adjust the generation rules used during the automated weekly restock or when manually triggered.
          </p>

          <form method="POST" action="/admin/restock-settings">
            <div style="margin-bottom: 16px;">
              <label>
                Party Level (1–20):
                <span class="tooltip">?
                  <span class="tooltip-text">
                    <strong>Level Gate:</strong> Only items with <code>min_level &le; Party Level</code> are allowed into the draw. Higher-tier loot unlocks as this number grows.
                  </span>
                </span>
              </label><br>
              <input type="number" name="party_level" min="1" max="20" value="${cfg.party_level}" required style="width: 120px; margin-top: 4px;">
            </div>

            <div style="background: #232428; padding: 14px; border-radius: 6px; margin-bottom: 16px;">
              <h4 style="margin: 0 0 10px 0; color: #d4af37;">Item Quotas Per Tier:</h4>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                <div>
                  <label style="font-size: 13px;">
                    Common Goods:
                    <span class="tooltip">?
                      <span class="tooltip-text">Quantity of standard non-scroll common adventuring gear and weapons rolled each week.</span>
                    </span>
                  </label>
                  <input type="number" name="commons_count" min="0" value="${cfg.commons_count}" required style="width: 100%;">
                </div>
                <div>
                  <label style="font-size: 13px;">
                    Cantrip Scrolls:
                    <span class="tooltip">?
                      <span class="tooltip-text">Guaranteed quantity of distinct 0-level spell scrolls rolled each week.</span>
                    </span>
                  </label>
                  <input type="number" name="cantrips_count" min="0" value="${cfg.cantrips_count}" required style="width: 100%;">
                </div>
                <div>
                  <label style="font-size: 13px;">
                    Level 1 Scrolls:
                    <span class="tooltip">?
                      <span class="tooltip-text">Guaranteed quantity of distinct 1st-level spell scrolls rolled each week.</span>
                    </span>
                  </label>
                  <input type="number" name="lvl1_count" min="0" value="${cfg.lvl1_count}" required style="width: 100%;">
                </div>
                <div>
                  <label style="font-size: 13px;">
                    Rare Items:
                    <span class="tooltip">?
                      <span class="tooltip-text">Quantity of rare tier goods (e.g. Alchemist Fire, Acid) drawn from the available level pool.</span>
                    </span>
                  </label>
                  <input type="number" name="rares_count" min="0" value="${cfg.rares_count}" required style="width: 100%;">
                </div>
                <div>
                  <label style="font-size: 13px;">
                    Magic Items:
                    <span class="tooltip">?
                      <span class="tooltip-text">Quantity of permanent magic items (e.g. +1 Weapons) drawn from the available level pool.</span>
                    </span>
                  </label>
                  <input type="number" name="magics_count" min="0" value="${cfg.magics_count}" required style="width: 100%;">
                </div>
                <div>
                  <label style="font-size: 13px; color: #949ba4;">
                    Staple Items:
                    <span class="tooltip">?
                      <span class="tooltip-text">Staple items are never rolled randomly — all active staple items eligible for the party level are ALWAYS stocked.</span>
                    </span>
                  </label>
                  <input type="text" value="ALL (Always)" disabled style="width: 100%; opacity: 0.6;">
                </div>
              </div>
            </div>

            <div style="background: #232428; padding: 14px; border-radius: 6px; margin-bottom: 20px;">
              <h4 style="margin: 0 0 10px 0; color: #d4af37;">Market Price Fluctuation Range:</h4>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div>
                  <label style="font-size: 13px;">
                    Min Multiplier (e.g. 0.85 = -15%):
                    <span class="tooltip">?
                      <span class="tooltip-text">The cheapest possible random price roll for non-staple goods during restock.</span>
                    </span>
                  </label>
                  <input type="number" step="0.01" min="0.1" name="fluctuation_min" value="${cfg.fluctuation_min}" required style="width: 100%;">
                </div>
                <div>
                  <label style="font-size: 13px;">
                    Max Multiplier (e.g. 1.15 = +15%):
                    <span class="tooltip">?
                      <span class="tooltip-text">The highest possible random price roll for non-staple goods during restock.</span>
                    </span>
                  </label>
                  <input type="number" step="0.01" min="0.1" name="fluctuation_max" value="${cfg.fluctuation_max}" required style="width: 100%;">
                </div>
              </div>
            </div>

            <button type="submit" class="btn btn-green">Save Restock Settings</button>
          </form>
        </div>

        <div>
          <div class="card">
            <h3>Manual Store Restock</h3>
            <p style="font-size: 13px; color: #949ba4;">
              Instantly applies current configuration, deletes current inventory, rolls fresh goods and sends Discord announcement.
            </p>
            <form method="POST" action="/admin/restock" onsubmit="return confirm('Wipe store and run restock now with current settings?');">
              <button type="submit" class="btn btn-gold" style="width: 100%; font-weight: bold; padding: 12px;">
                🔄 Run Restock & Announce Now
              </button>
            </form>
          </div>
        </div>
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

  // ── ZAKŁADKA: PLAYERS & CHARACTERS ──
  else if (currentTab === 'players') {
    const allPlayers = db.getAllPlayers ? db.getAllPlayers() : [];
    const playerRows = db.getAllPlayersWithCharacters ? db.getAllPlayersWithCharacters() : [];

    const editCharId = req.query.edit_char ? parseInt(req.query.edit_char, 10) : null;
    const charToEdit = editCharId ? db.getCharacterById(editCharId) : null;
    const characterClasses = charToEdit ? db.getCharacterClasses(charToEdit.id) : [];
    const secondaryCharacterClasses = characterClasses.filter(classRow => classRow.is_primary !== 1);
    const characterAdventureIds = charToEdit
      ? db.getCharacterAdventureIds(charToEdit.id)
      : [];
    const availableAdventures = charToEdit && db.getAllAdventures
      ? db.getAllAdventures()
      : [];
    const classNames = Object.keys(DND_CLASSES_AND_SUBCLASSES);
    const dndClassesJson = JSON.stringify(DND_CLASSES_AND_SUBCLASSES).replace(/</g, '\\u003c');
    const classNamesJson = JSON.stringify(classNames).replace(/</g, '\\u003c');
    const secondaryClassAllocationRows = secondaryCharacterClasses.map(classRow => {
      const options = [...classNames];
      if (!options.some(className => className.toLowerCase() === classRow.class_name.toLowerCase())) {
        options.unshift(classRow.class_name);
      }
      return `
        <div class="class-allocation-row" data-subclass="${escapeHtml(classRow.subclass_name || '')}" style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
          <select class="class-allocation-name" aria-label="Multiclass name" style="flex: 2;">
            ${options.map(className => `<option value="${escapeHtml(className)}" ${className.toLowerCase() === classRow.class_name.toLowerCase() ? 'selected' : ''}>${escapeHtml(className)}</option>`).join('')}
          </select>
          <input class="class-allocation-level" type="number" min="1" max="20" value="${classRow.class_level}" aria-label="Class levels" style="width: 90px;">
          <button class="remove-class-allocation btn btn-small" type="button">Remove</button>
        </div>
      `;
    }).join('');

    const addSpeciesOptions = DND_SPECIES.map(s =>
      `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`
    );
    const addClassOptions = [
      '<option value="" selected disabled>-- Choose Class --</option>',
      ...classNames.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    ];
    const addSubclassOptions = ['<option value="">-- None / Base --</option>'];

    let editSpeciesOptions = [];
    let editClassOptions = [];
    let editSubclassOptions = [];

    if (charToEdit) {
      const normalizedRace = (charToEdit.race || '').toLowerCase();
      const normalizedClass = (charToEdit.class || '').toLowerCase();
      const normalizedSubclass = (charToEdit.subclass || '').toLowerCase();
      editSpeciesOptions = DND_SPECIES.map(s =>
        `<option value="${escapeHtml(s)}" ${s.toLowerCase() === normalizedRace ? 'selected' : ''}>${escapeHtml(s)}</option>`
      );
      if (charToEdit.race && !DND_SPECIES.some(s => s.toLowerCase() === normalizedRace)) {
        editSpeciesOptions.unshift(`<option value="${escapeHtml(charToEdit.race)}" selected>${escapeHtml(charToEdit.race)}</option>`);
      }

      editClassOptions = classNames.map(c =>
        `<option value="${escapeHtml(c)}" ${c.toLowerCase() === normalizedClass ? 'selected' : ''}>${escapeHtml(c)}</option>`
      );
      if (charToEdit.class && !classNames.some(c => c.toLowerCase() === normalizedClass)) {
        editClassOptions.unshift(`<option value="${escapeHtml(charToEdit.class)}" selected>${escapeHtml(charToEdit.class)}</option>`);
      }

      const matchedClass = classNames.find(c => c.toLowerCase() === normalizedClass);
      const availableSubs = matchedClass ? DND_CLASSES_AND_SUBCLASSES[matchedClass] : [];
      editSubclassOptions = [
        `<option value="" ${charToEdit.subclass ? '' : 'selected'}>-- None / Base --</option>`,
        ...availableSubs.map(sub =>
          `<option value="${escapeHtml(sub)}" ${sub.toLowerCase() === normalizedSubclass ? 'selected' : ''}>${escapeHtml(sub)}</option>`
        )
      ];
      if (charToEdit.subclass && !availableSubs.some(sub => sub.toLowerCase() === normalizedSubclass)) {
        editSubclassOptions.splice(1, 0, `<option value="${escapeHtml(charToEdit.subclass)}" selected>${escapeHtml(charToEdit.subclass)}</option>`);
      }
    }

    let charFormHtml = '';
    if (charToEdit) {
      charFormHtml = `
        <div class="card" style="border: 1px solid #5865f2; margin-bottom: 20px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3>Edit Character: ${escapeHtml(charToEdit.name)}</h3>
            <a href="/admin?tab=players" class="btn btn-small">Cancel</a>
          </div>
          <form method="POST" action="/admin/characters/update">
            <input type="hidden" name="id" value="${charToEdit.id}">
            
            <!-- Row 1: Player & Character Name -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px; margin-top: 10px;">
              <div>
                <label>Player (Discord User):</label><br>
                <select name="player_id" style="width: 100%; margin-top: 4px;" required>
                  ${allPlayers.map(p => `<option value="${p.id}" ${p.id === charToEdit.player_id ? 'selected' : ''}>${escapeHtml(p.discord_tag)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label>Character Name:</label><br>
                <input type="text" name="name" value="${escapeHtml(charToEdit.name)}" required style="width: 100%; margin-top: 4px;">
              </div>
            </div>

            <!-- Row 2: Species, Class, Subclass with Live Search Dropdowns -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 12px;">
              <div>
                <label style="white-space: nowrap;">Species (2024):</label><br>
                <input type="text" placeholder="Filter species..." oninput="filterDropdown('editSpeciesFilter', 'editSpeciesSelect')" id="editSpeciesFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                <select name="race" id="editSpeciesSelect" required style="width: 100%; margin-top: 4px;" size="8">
                  ${editSpeciesOptions.join('')}
                </select>
              </div>
              <div>
                <label style="white-space: nowrap;">Class (2024):</label><br>
                <input type="text" placeholder="Filter classes..." oninput="filterDropdown('editClassFilter', 'editClassSelect', 'editSubclassSelect', 'editSubclassFilter')" id="editClassFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                <select name="class_name" id="editClassSelect" onchange="onClassChange(this.value, 'editSubclassSelect', 'editSubclassFilter')" required style="width: 100%; margin-top: 4px;" size="8">
                  ${editClassOptions.join('')}
                </select>
              </div>
              <div>
                <label style="white-space: nowrap;">Subclass (2024):</label><br>
                <input type="text" placeholder="Filter subclasses..." oninput="filterDropdown('editSubclassFilter', 'editSubclassSelect')" id="editSubclassFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                <select name="subclass" id="editSubclassSelect" style="width: 100%; margin-top: 4px;" size="8">
                  ${editSubclassOptions.join('')}
                </select>
              </div>
            </div>

            <!-- Row 3: Manual XP Override, Level Override Option & Status -->
            <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <h4 style="margin: 0 0 8px 0; color: #d4af37; font-size: 13px;">Progression & Level Override:</h4>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; align-items: flex-end;">
                <div>
                  <label style="font-size: 12px;">Adventure XP (Override):</label><br>
                  <input type="number" name="xp" min="0" value="${charToEdit.xp}" required style="width: 100%; margin-top: 4px;">
                </div>
                <div>
                  <label style="font-size: 12px;">Level (1–20):</label><br>
                  <input type="number" id="editCharLevel" name="level" min="1" max="20" value="${charToEdit.level}" style="width: 100%; margin-top: 4px;">
                </div>
                <div>
                  <label style="font-size: 12px; cursor: pointer;">
                    <input type="checkbox" id="overrideLvlCheck" name="override_level" value="1" onchange="toggleLevelInput(this)">
                    <strong>Override auto level calculation</strong>
                  </label>
                  <div style="font-size: 11px; color: #949ba4; margin-top: 4px;">
                    Unchecked = auto-calculates level from XP ($0$–$2 = 3$, $3 = 4$, $+4$ per level).
                  </div>
                </div>
                <div>
                  <label style="font-size: 12px;">Status:</label><br>
                  <select name="status" style="width: 100%; margin-top: 4px;" required>
                    <option value="alive" ${charToEdit.status === 'alive' ? 'selected' : ''}>Alive</option>
                    <option value="dead" ${charToEdit.status === 'dead' ? 'selected' : ''}>Dead</option>
                  </select>
                </div>
              </div>
            </div>

            <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <label style="font-weight: bold; color: #d4af37; font-size: 13px;">
                <input type="checkbox" id="edit-class-allocations">
                Redistribute multiclass levels
              </label>
              <p style="color: #949ba4; font-size: 12px; margin: 6px 0;">
                Leave unchecked to assign level-ups automatically to the primary class. When enabled, set secondary class levels; the primary class receives the remaining XP-derived levels.
              </p>
              <div id="secondary-class-allocations">
                ${secondaryClassAllocationRows || '<p id="no-secondary-classes" style="color: #949ba4; font-size: 12px;">No secondary classes.</p>'}
              </div>
              <div style="display: flex; gap: 8px; margin-top: 10px;">
                <select id="add-secondary-class" aria-label="Choose a secondary class" style="flex: 1;">
                  <option value="">-- Add secondary class --</option>
                  ${classNames.map(className => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('')}
                </select>
                <button id="add-secondary-class-button" class="btn btn-small" type="button">Add Class</button>
              </div>
              <input id="class-allocations-json" type="hidden" name="class_allocations" disabled>
            </div>

            <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <label style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #d4af37; font-size: 13px;">
                <span>Completed Adventures Log</span>
                <span id="selected-adventures-count" style="color: #949ba4; font-weight: normal;">Adventures: ${characterAdventureIds.length}</span>
              </label>
              ${availableAdventures.length === 0 ? '<p style="margin: 8px 0 0; color: #949ba4; font-size: 12px;">No completed adventures available.</p>' : `
                <input type="text" id="adventure-search" placeholder="Filter by title, DM, or session ID..." style="width: 100%; margin-top: 8px;">
                <div id="adventures-list-container" style="max-height: 220px; overflow-y: auto; margin-top: 8px; padding: 8px; border: 1px solid #3b3e45; border-radius: 4px;">
                  ${availableAdventures.map(adventure => `
                    <div class="adventure-item" data-title="${escapeHtml(adventure.title.toLowerCase())}" data-dm="${escapeHtml((adventure.dm_name || '').toLowerCase())}" data-id="${adventure.id}" style="padding: 8px; border: 1px solid #3b3e45; border-radius: 4px; margin-bottom: 6px;">
                      <label for="character_adventure_${adventure.id}" style="display: block; font-size: 13px; cursor: pointer;">
                        <input class="adventure-checkbox" type="checkbox" name="adventure_ids" value="${adventure.id}" id="character_adventure_${adventure.id}" ${characterAdventureIds.includes(adventure.id) ? 'checked' : ''}>
                        <strong>${escapeHtml(adventure.title)}</strong>
                        <span style="display: block; color: #949ba4; font-size: 11px; margin-left: 22px;">
                          Session #${adventure.id} · DM: ${escapeHtml(adventure.dm_name || 'Unknown')} · +${adventure.xp_awarded} XP
                        </span>
                      </label>
                    </div>
                  `).join('')}
                </div>
              `}
              <div id="selected-adventure-badges" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px;">
                <span style="color: #949ba4; font-size: 12px;">Selected:</span>
              </div>
              <small style="display: block; color: #949ba4; margin-top: 6px;">Selected adventures are linked to this character, and their XP rewards are synchronized when you save.</small>
            </div>

            <button type="submit" class="btn btn-green">Save Character Changes</button>
          </form>
        </div>

        <script>
          const multiclassNames = ${classNamesJson};
          function toggleLevelInput(cb) {
            const input = document.getElementById('editCharLevel');
            if (!cb.checked) {
              input.style.opacity = '0.6';
            } else {
              input.style.opacity = '1';
            }
          }
          document.addEventListener('DOMContentLoaded', () => {
            const cb = document.getElementById('overrideLvlCheck');
            if (cb) toggleLevelInput(cb);

            const searchInput = document.getElementById('adventure-search');
            const adventureItems = document.querySelectorAll('.adventure-item');
            const adventureCheckboxes = document.querySelectorAll('.adventure-checkbox');
            const adventureCount = document.getElementById('selected-adventures-count');
            const selectedBadges = document.getElementById('selected-adventure-badges');
            const allocationToggle = document.getElementById('edit-class-allocations');
            const allocationContainer = document.getElementById('secondary-class-allocations');
            const allocationJson = document.getElementById('class-allocations-json');
            const addClassSelect = document.getElementById('add-secondary-class');
            const addClassButton = document.getElementById('add-secondary-class-button');
            const characterForm = document.querySelector('form[action="/admin/characters/update"]');

            function updateAllocationMode() {
              const enabled = allocationToggle.checked;
              allocationJson.disabled = !enabled;
              allocationContainer.querySelectorAll('select, input, button').forEach(control => {
                control.disabled = !enabled;
              });
              addClassSelect.disabled = !enabled;
              addClassButton.disabled = !enabled;
            }

            function addClassAllocation(className, level = 1) {
              const emptyMessage = document.getElementById('no-secondary-classes');
              if (emptyMessage) emptyMessage.remove();

              const row = document.createElement('div');
              row.className = 'class-allocation-row';
              row.dataset.subclass = '';
              row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 8px;';

              const classSelect = document.createElement('select');
              classSelect.className = 'class-allocation-name';
              classSelect.setAttribute('aria-label', 'Multiclass name');
              classSelect.style.flex = '2';
              multiclassNames.forEach(name => classSelect.add(new Option(name, name)));
              classSelect.value = className;
              classSelect.addEventListener('change', () => { row.dataset.subclass = ''; });

              const levelInput = document.createElement('input');
              levelInput.className = 'class-allocation-level';
              levelInput.type = 'number';
              levelInput.min = '1';
              levelInput.max = '20';
              levelInput.value = level;
              levelInput.setAttribute('aria-label', 'Class levels');
              levelInput.style.width = '90px';

              const removeButton = document.createElement('button');
              removeButton.className = 'remove-class-allocation btn btn-small';
              removeButton.type = 'button';
              removeButton.textContent = 'Remove';

              row.append(classSelect, levelInput, removeButton);
              allocationContainer.appendChild(row);
              updateAllocationMode();
            }

            allocationContainer.addEventListener('change', event => {
              if (event.target.matches('.class-allocation-name')) {
                event.target.closest('.class-allocation-row').dataset.subclass = '';
              }
            });
            allocationContainer.addEventListener('click', event => {
              if (event.target.matches('.remove-class-allocation')) {
                event.target.closest('.class-allocation-row').remove();
                if (!allocationContainer.querySelector('.class-allocation-row')) {
                  const emptyMessage = document.createElement('p');
                  emptyMessage.id = 'no-secondary-classes';
                  emptyMessage.style.cssText = 'color: #949ba4; font-size: 12px;';
                  emptyMessage.textContent = 'No secondary classes.';
                  allocationContainer.appendChild(emptyMessage);
                }
              }
            });
            allocationToggle.addEventListener('change', updateAllocationMode);
            addClassButton.addEventListener('click', () => {
              const className = addClassSelect.value;
              if (!className) return;
              if ([...allocationContainer.querySelectorAll('.class-allocation-name')]
                .some(select => select.value.toLowerCase() === className.toLowerCase())) {
                return;
              }
              addClassAllocation(className);
              addClassSelect.value = '';
            });
            characterForm.addEventListener('submit', () => {
              if (allocationToggle.checked) {
                allocationJson.value = JSON.stringify(
                  [...allocationContainer.querySelectorAll('.class-allocation-row')].map(row => ({
                    class_name: row.querySelector('.class-allocation-name').value,
                    subclass_name: row.dataset.subclass || null,
                    level: row.querySelector('.class-allocation-level').value
                  }))
                );
              }
            });
            updateAllocationMode();

            if (searchInput) {
              searchInput.addEventListener('input', () => {
                const query = searchInput.value.toLowerCase().trim();
                adventureItems.forEach(item => {
                  const matches = item.dataset.title.includes(query) ||
                    item.dataset.dm.includes(query) ||
                    item.dataset.id.includes(query);
                  item.style.display = matches ? '' : 'none';
                });
              });
            }

            function updateSelectedAdventures() {
              const selected = document.querySelectorAll('.adventure-checkbox:checked');
              if (adventureCount) adventureCount.textContent = 'Adventures: ' + selected.length;
              if (!selectedBadges) return;

              selectedBadges.replaceChildren();
              const label = document.createElement('span');
              label.style.cssText = 'color: #949ba4; font-size: 12px;';
              label.textContent = 'Selected:';
              selectedBadges.appendChild(label);

              if (selected.length === 0) {
                const empty = document.createElement('span');
                empty.style.cssText = 'color: #949ba4; font-size: 12px; font-style: italic;';
                empty.textContent = 'None';
                selectedBadges.appendChild(empty);
                return;
              }

              selected.forEach(checkbox => {
                const item = checkbox.closest('.adventure-item');
                const title = item.querySelector('strong').textContent;
                const badge = document.createElement('span');
                badge.className = 'party-badge';
                badge.appendChild(document.createTextNode(title));

                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.setAttribute('aria-label', 'Remove ' + title);
                removeButton.textContent = '×';
                removeButton.addEventListener('click', () => {
                  checkbox.checked = false;
                  updateSelectedAdventures();
                });
                badge.appendChild(removeButton);
                selectedBadges.appendChild(badge);
              });
            }

            adventureCheckboxes.forEach(checkbox => {
              checkbox.addEventListener('change', updateSelectedAdventures);
            });
            updateSelectedAdventures();
          });
        </script>
      `;
    }

   contentHtml = `
      ${charFormHtml}

      <!-- Top Forms Grid: 1fr (Player Registration) to 2fr (Character Creation) -->
      <div style="display: ${charToEdit ? 'none' : 'grid'}; grid-template-columns: 1fr 2fr; gap: 20px; margin-bottom: 20px;">
        
        <!-- Left Card: Register Player -->
        <div class="card" style="margin-bottom: 0;">
          <h3>Register Player</h3>
          <form method="POST" action="/admin/players/add">
            <div style="margin-bottom: 12px;">
              <label>Discord Username / Tag:</label><br>
              <input type="text" name="discord_tag" placeholder="e.g. Liam#1234 or liam_rpg" required style="width: 100%; margin-top: 4px;">
            </div>
            <div style="margin-bottom: 16px;">
              <label>Discord User ID:</label><br>
              <input type="text" name="discord_id" placeholder="e.g. 289123456789012345" required style="width: 100%; margin-top: 4px;">
            </div>
            <button type="submit" class="btn btn-green">Add Player</button>
          </form>
        </div>

        <!-- Right Card: Add Character to Player -->
        <div class="card" style="margin-bottom: 0;">
          <h3>Add Character to Player</h3>
          ${allPlayers.length === 0 ? '<p style="color: #949ba4;">Register at least one player on the left before adding characters.</p>' : `
            <form method="POST" action="/admin/characters/add">
              <!-- Row 1: Player & Character Name -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
                <div>
                  <label style="white-space: nowrap;">Assign to Player:</label><br>
                  <select name="player_id" style="width: 100%; margin-top: 4px;" required>
                    ${allPlayers.map(p => `<option value="${p.id}">${escapeHtml(p.discord_tag)} (${p.dm_points || 0} DM pts)</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label style="white-space: nowrap;">Character Name:</label><br>
                  <input type="text" name="name" placeholder="e.g. Thorin Oakenshield" required style="width: 100%; margin-top: 4px;">
                </div>
              </div>

              <!-- Row 2: Species, Class, Subclass with Live Search Dropdowns -->
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 12px;">
                <div>
                  <label style="white-space: nowrap;">Species (2024):</label><br>
                  <input type="text" placeholder="Filter species..." oninput="filterDropdown('addSpeciesFilter', 'addSpeciesSelect')" id="addSpeciesFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                  <select name="race" id="addSpeciesSelect" required style="width: 100%; margin-top: 4px;" size="8">
                    ${addSpeciesOptions.join('')}
                  </select>
                </div>
                <div>
                  <label style="white-space: nowrap;">Class (2024):</label><br>
                  <input type="text" placeholder="Filter classes..." oninput="filterDropdown('addClassFilter', 'addClassSelect', 'addSubclassSelect', 'addSubclassFilter')" id="addClassFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                  <select name="class_name" id="addClassSelect" onchange="onClassChange(this.value, 'addSubclassSelect', 'addSubclassFilter')" required style="width: 100%; margin-top: 4px;" size="8">
                    ${addClassOptions.join('')}
                  </select>
                </div>
                <div>
                  <label style="white-space: nowrap;">Subclass (2024):</label><br>
                  <input type="text" placeholder="Filter subclasses..." oninput="filterDropdown('addSubclassFilter', 'addSubclassSelect')" id="addSubclassFilter" style="width: 100%; margin-top: 4px; padding: 4px 8px; font-size: 12px;" autocomplete="off">
                  <select name="subclass" id="addSubclassSelect" style="width: 100%; margin-top: 4px;" size="8">
                    ${addSubclassOptions.join('')}
                  </select>
                </div>
              </div>

              <!-- Row 3: XP, Level (Locked), Status, Submit Button -->
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 14px; align-items: flex-end;">
                <div>
                  <label style="white-space: nowrap; font-size: 12px;">Starting XP (0 = Lvl 3):</label><br>
                  <input type="number" name="xp" min="0" value="0" required style="width: 100%; margin-top: 4px;">
                </div>
                <div>
                  <label style="white-space: nowrap; font-size: 12px;">Starting Level:</label><br>
                  <input type="text" value="Starts at Lvl 3" disabled style="width: 100%; margin-top: 4px; opacity: 0.7;">
                </div>
                <div>
                  <label style="white-space: nowrap; font-size: 12px;">Status:</label><br>
                  <select name="status" style="width: 100%; margin-top: 4px;" required>
                    <option value="alive" selected>Alive</option>
                    <option value="dead">Dead</option>
                  </select>
                </div>
                <div>
                  <button type="submit" class="btn btn-green" style="white-space: nowrap; padding: 9px 18px;">Create Character</button>
                </div>
              </div>
            </form>
          `}
        </div>
      </div>

      <!-- Character Roster Table: Full-width container matching top grid -->
      <div class="card" style="width: 100%;">
        <h3>Campaign Characters & Roster (${playerRows.filter(r => r.character_id).length} characters)</h3>
        <table style="width: 100%;">
          <thead>
            <tr>
              <th class="sortable">Player (Discord)</th>
              <th class="sortable">Discord ID</th>
              <th class="sortable">Character</th>
              <th class="sortable">Race</th>
              <th class="sortable">Class</th>
              <th class="sortable">Level</th>
              <th class="sortable">XP</th>
              <th class="sortable">Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${playerRows.length === 0 ? '<tr><td colspan="9">No players or characters registered yet.</td></tr>' : playerRows.map(row => `
              <tr>
                <td data-sort="${escapeHtml(row.discord_tag)}"><strong>${escapeHtml(row.discord_tag)}</strong></td>
                <td data-sort="${escapeHtml(row.discord_id)}"><small style="color: #949ba4;">${escapeHtml(row.discord_id)}</small></td>
                <td data-sort="${escapeHtml(row.character_name || '')}">
                  ${row.character_name ? `<strong>${escapeHtml(row.character_name)}</strong>` : '<em style="color: #949ba4;">(No character)</em>'}
                </td>
                <td data-sort="${escapeHtml(row.character_race || '')}">${row.character_race ? escapeHtml(row.character_race) : '—'}</td>
                <td data-sort="${escapeHtml(row.character_class || '')}">
                  ${row.character_class ? `${escapeHtml(row.character_class)}${row.character_subclass ? ` (${escapeHtml(row.character_subclass)})` : ''}` : '—'}
                </td>
                <td data-sort="${row.character_level || 0}">Lvl ${row.character_level || 3}</td>
                <td data-sort="${row.character_xp || 0}">${row.character_xp !== null && row.character_xp !== undefined ? `${row.character_xp} XP` : '—'}</td>
                <td data-sort="${row.character_status || ''}">
                  ${row.character_status === 'alive' 
                    ? '<span class="tag green">Alive</span>' 
                    : row.character_status === 'dead' 
                      ? '<span class="tag red">Dead</span>' 
                      : '—'}
                </td>
                <td style="white-space: nowrap;">
                  ${row.character_id ? `
                    <a href="/admin?tab=players&edit_char=${row.character_id}" class="btn btn-small">Edit Character</a>
                    <form method="POST" action="/admin/characters/delete" style="display:inline;" onsubmit="return confirm('Delete character &quot;${escapeHtml(row.character_name)}&quot;?');">
                      <input type="hidden" name="id" value="${row.character_id}">
                      <button type="submit" class="btn btn-small btn-red">Delete Char</button>
                    </form>
                  ` : `
                    <form method="POST" action="/admin/players/delete" style="display:inline;" onsubmit="return confirm('Remove player &quot;${escapeHtml(row.discord_tag)}&quot;?');">
                      <input type="hidden" name="id" value="${row.player_id}">
                      <button type="submit" class="btn btn-small btn-red">Delete Player</button>
                    </form>
                  `}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <script>
        const classTree = ${dndClassesJson};

        function filterDropdown(filterInputId, selectId) {
          const filterEl = document.getElementById(filterInputId);
          const selectEl = document.getElementById(selectId);
          if (!filterEl || !selectEl) return;

          const filterText = filterEl.value.trim().toLowerCase();
          const options = selectEl.querySelectorAll('option');
          let firstMatch = null;

          options.forEach(option => {
            const isMatch = option.text.toLowerCase().includes(filterText);
            option.style.display = isMatch ? '' : 'none';
            if (isMatch && !firstMatch) firstMatch = option;
          });

          if (firstMatch && filterText.length > 0) {
            selectEl.value = firstMatch.value;
            if (selectId.includes('ClassSelect')) {
              const isEdit = selectId.startsWith('edit');
              onClassChange(
                firstMatch.value,
                isEdit ? 'editSubclassSelect' : 'addSubclassSelect',
                isEdit ? 'editSubclassFilter' : 'addSubclassFilter'
              );
            }
          }
        }

        function onClassChange(className, subSelectId, subFilterId) {
          const subSelect = document.getElementById(subSelectId);
          const subFilter = document.getElementById(subFilterId);
          if (subFilter) subFilter.value = '';
          if (!subSelect) return;

          subSelect.innerHTML = '<option value="">-- None / Base --</option>';

          if (className && classTree[className]) {
            classTree[className].forEach(subclass => {
              const option = document.createElement('option');
              option.value = subclass;
              option.textContent = subclass;
              subSelect.appendChild(option);
            });
          }
        }
      </script>
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
        .player-group { margin-bottom: 10px; }
        .player-group-title { color: #d4af37; font-size: 12px; font-weight: bold; border-bottom: 1px solid #3b3e45; padding-bottom: 4px; margin-bottom: 6px; }
        .character-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px; }
        .char-item label { font-size: 13px; cursor: pointer; }
        .party-badge { display: inline-flex; align-items: center; gap: 6px; background: #5865f2; color: #fff; border-radius: 4px; padding: 3px 7px; font-size: 12px; }
        .party-badge button { color: #fff; background: transparent; border: 0; cursor: pointer; font-size: 14px; line-height: 1; padding: 0; }
        .adventure-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-bottom: 20px; }
        .adventure-table-wrap { overflow-x: auto; }
        @media (max-width: 760px) {
          .adventure-layout { grid-template-columns: minmax(0, 1fr); }
        }
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
          <a href="/admin?tab=restock" class="tab-btn ${currentTab === 'restock' ? 'active' : ''}">Restock Engine</a>
          <a href="/admin?tab=sales" class="tab-btn ${currentTab === 'sales' ? 'active' : ''}">Sales Ledger</a>
          <a href="/admin?tab=rolls" class="tab-btn ${currentTab === 'rolls' ? 'active' : ''}">Rolls History</a>
          <a href="/admin?tab=players" class="tab-btn ${currentTab === 'players' ? 'active' : ''}">Players</a>
          <a href="/admin?tab=adventures" class="tab-btn ${currentTab === 'adventures' ? 'active' : ''}">Adventures</a>
        </div>
        ${contentHtml}
      </div>

      <script>
        document.addEventListener('DOMContentLoaded', () => {
          const searchInput = document.getElementById('character-search');
          const groups = document.querySelectorAll('.player-group');
          const badgesContainer = document.getElementById('selected-badges-container');
          const countDisplay = document.getElementById('selected-count');
          const characterCheckboxes = document.querySelectorAll('.char-checkbox');

          if (searchInput) {
            searchInput.addEventListener('input', () => {
              const query = searchInput.value.toLowerCase().trim();
              groups.forEach(group => {
                let hasVisibleCharacter = false;
                group.querySelectorAll('.char-item').forEach(item => {
                  const matches = item.dataset.name.includes(query) || item.dataset.player.includes(query);
                  item.style.display = matches ? '' : 'none';
                  if (matches) hasVisibleCharacter = true;
                });
                group.style.display = hasVisibleCharacter ? '' : 'none';
              });
            });
          }

          function updateSelectedBadges() {
            const checked = document.querySelectorAll('.char-checkbox:checked');
            if (countDisplay) countDisplay.textContent = 'Selected: ' + checked.length;
            if (!badgesContainer) return;

            badgesContainer.replaceChildren();
            const partyLabel = document.createElement('span');
            partyLabel.style.cssText = 'color: #949ba4; font-size: 12px;';
            partyLabel.textContent = 'Party:';
            badgesContainer.appendChild(partyLabel);

            if (checked.length === 0) {
              const noneLabel = document.createElement('span');
              noneLabel.style.cssText = 'color: #949ba4; font-size: 12px; font-style: italic;';
              noneLabel.textContent = 'None';
              badgesContainer.appendChild(noneLabel);
              return;
            }

            checked.forEach(checkbox => {
              const item = checkbox.closest('.char-item');
              const name = item.querySelector('strong').textContent;
              const badge = document.createElement('span');
              badge.className = 'party-badge';
              badge.appendChild(document.createTextNode(name));

              const removeButton = document.createElement('button');
              removeButton.type = 'button';
              removeButton.setAttribute('aria-label', 'Remove ' + name);
              removeButton.textContent = '×';
              removeButton.addEventListener('click', () => {
                checkbox.checked = false;
                updateSelectedBadges();
              });
              badge.appendChild(removeButton);
              badgesContainer.appendChild(badge);
            });
          }

          characterCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateSelectedBadges);
          });
          updateSelectedBadges();

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