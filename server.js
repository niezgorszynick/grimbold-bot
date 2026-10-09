// server.js — Express DM Admin Panel with Context Tabs, Restock & Custom Announcements
const express = require('express');
const path = require('path');
const router = express.Router();
const { REST, Routes, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { formatCp } = require('./currency');
const { getUserRoll, getDiscount, applyModifier } = require('./rollTracker');
const { restockShop } = require('./restock');
const {
  DND_SPECIES,
  DND_DATA,
  DND_CLASSES_AND_SUBCLASSES
} = require('./dndData');

// Middleware parsowania formularzy i JSON
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  if (req.session.user.id === 0 && req.session.user.role === 'admin') return next();

  const player = db.prepare(`
    SELECT id, discord_tag, role, password_hash
    FROM players
    WHERE id = ?
  `).get(req.session.user.id);
  if (!player || !player.password_hash) {
    req.session = null;
    return res.redirect('/login');
  }

  req.session.user = {
    id: player.id,
    discord_tag: player.discord_tag,
    role: player.role || 'player'
  };
  return next();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).send('Forbidden: Dungeon Master privileges required.');
}

function requireRootAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.id === 0 && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).send('Forbidden: Only the emergency admin can manage account passwords and roles.');
}

router.use(requireAuth);
router.use((req, res, next) => {
  const selfServiceCharacterRoute = req.path === '/characters/self-update';
  return req.method === 'POST' && !selfServiceCharacterRoute
    ? requireAdmin(req, res, next)
    : next();
});

// Client scripts for the admin panel (only files listed here are served).
const ADMIN_ASSETS = { 'character-creator.js': path.join(__dirname, 'public', 'character-creator.js') };
router.get('/assets/:file', (req, res) => {
  const file = Object.hasOwn(ADMIN_ASSETS, req.params.file) ? ADMIN_ASSETS[req.params.file] : null;
  if (!file) return res.status(404).send('Not found');
  return res.sendFile(file);
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

router.post(['/players/set-access', '/players/credentials'], requireRootAdmin, (req, res) => {
  try {
    const { player_id, password, role = 'player' } = req.body;
    if (typeof password !== 'string' || password.trim().length < 4) {
      throw new Error('Password must be at least 4 characters.');
    }
    if (role !== 'player' && role !== 'admin') throw new Error('Invalid account role.');

    db.setPlayerCredentials(player_id, password.trim(), role);
    res.redirect('/admin?tab=players&status=credentials_updated');
  } catch (err) {
    console.error('Error updating player credentials:', err);
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

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
    const { player_id, name, race, class_name, subclass, xp, status, gold_gp } = req.body;
    db.addCharacter({ player_id, name, race, class_name, subclass, xp, status, gold_gp });
    res.redirect('/admin?tab=players&status=char_added');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

router.post('/characters/self-update', (req, res) => {
  const playerId = req.session.user.id;
  if (playerId <= 0) return res.status(403).send('A player account is required to edit a character.');

  try {
    const { name, race, class_name, subclass } = req.body;
    db.updateCharacterDetailsForPlayer({
      id: req.body.id,
      player_id: playerId,
      name,
      race,
      class_name,
      subclass
    });
    res.redirect('/admin?tab=character-sheet&status=char_updated');
  } catch (err) {
    res.redirect(`/admin?tab=character-sheet&edit_char=${encodeURIComponent(req.body.id)}&err=${encodeURIComponent(err.message)}`);
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
      gold_gp,
      adventure_ids,
      class_allocations,
      death_adventure_id,
      death_dm_player_id,
      death_notes
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
      gold_gp,
      adventure_ids: selectedAdventureIds,
      class_allocations: selectedClassAllocations,
      death_adventure_id,
      death_dm_player_id,
      death_notes
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
  const currentUser = req.session.user;
  const isAdmin = currentUser.role === 'admin';
  const isRootAdmin = currentUser.id === 0 && isAdmin;
  const playerAllowedTabs = ['items', 'players', 'adventures', 'rolls', 'analytics', 'auctions', 'character-sheet'];
  const tabLabels = {
    items: 'Shop Items',
    catalog: 'Master Catalog',
    restock: 'Restock Engine',
    sales: 'Sales Ledger',
    rolls: 'Rolls History',
    players: 'Players',
    adventures: 'Adventures',
    analytics: 'Analytics',
    auctions: 'Auctions',
    'character-sheet': 'Character Sheet'
  };
  const visibleTabs = isAdmin ? Object.keys(tabLabels) : playerAllowedTabs;
  let currentTab = req.query.tab || 'items';
  if (!isAdmin && !playerAllowedTabs.includes(currentTab)) {
    currentTab = 'items';
  }
  const status = req.query.status;
  const partyLevel = db.getPartyLevel();
  const catalogItems = isAdmin && db.getAllCatalogItems ? db.getAllCatalogItems() : [];
  const activeItems = db.getAllItemsForAdmin
    ? db.getAllItemsForAdmin().filter(item => isAdmin || item.is_active)
    : [];
  const shopPlayer = currentTab === 'items' && currentUser.id > 0
    ? db.prepare('SELECT discord_id FROM players WHERE id = ?').get(currentUser.id)
    : null;
  const shopRoll = shopPlayer ? getUserRoll(shopPlayer.discord_id) : null;
  const shopModifier = shopRoll === null ? null : getDiscount(shopRoll);
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
  } else if (status === 'credentials_updated') {
    statusBanner = '<div class="alert green">✅ Player login credentials updated!</div>';
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
    const editAdvId = isAdmin && req.query.edit_adv ? Number(req.query.edit_adv) : null;
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
      <div class="adventure-layout" style="${isAdmin ? '' : 'grid-template-columns: minmax(0, 1fr);'}">
        
        ${isAdmin ? `
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
        ` : ''}

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
              ${isAdmin ? '<th>Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${allAdventures.length === 0 ? `<tr><td colspan="${isAdmin ? 6 : 5}">No completed adventures recorded yet.</td></tr>` : allAdventures.map(adv => `
              <tr>
                <td data-sort="${adv.created_at}">${adv.created_at}</td>
                <td data-sort="${escapeHtml(adv.title)}"><strong>${escapeHtml(adv.title)}</strong></td>
                <td data-sort="${escapeHtml(adv.dm_name || '')}">${adv.dm_name ? escapeHtml(adv.dm_name) : '<em>None</em>'}</td>
                <td data-sort="${adv.xp_awarded}"><span class="tag green">+${adv.xp_awarded} XP</span></td>
                <td>${escapeHtml(adv.description || '—')}</td>
                ${isAdmin ? `<td style="text-align: right;"><a class="btn btn-small btn-gold" href="/admin?tab=adventures&edit_adv=${adv.id}">Edit</a></td>` : ''}
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

  // ── ZAKŁADKA: ANALYTICS ──
  else if (currentTab === 'analytics') {
    const analytics = db.getCharacterAnalytics();
    const analyticsJson = JSON.stringify(analytics).replace(/</g, '\\u003c');
    const diceStats = db.getDiceAnalytics();
    const diceStatsJson = JSON.stringify(diceStats.distribution).replace(/</g, '\\u003c');
    const levelEntries = Object.entries(analytics.levelCount)
      .sort((left, right) => Number(left[0].replace(/\D/g, '')) - Number(right[0].replace(/\D/g, '')));
    const classEntries = Object.entries(analytics.classCount)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

    contentHtml = `
      <div class="analytics-grid">
        <section class="card analytics-card">
          <div class="analytics-card-header">
            <strong>Roster Composition</strong>
            <div class="metric-toggle" role="group" aria-label="Roster chart metric">
              <input type="radio" name="metricRadio" id="metricSpecies" value="species" checked>
              <label for="metricSpecies">Species</label>
              <input type="radio" name="metricRadio" id="metricClasses" value="classes">
              <label for="metricClasses">Classes</label>
              <input type="radio" name="metricRadio" id="metricStatus" value="status">
              <label for="metricStatus">Status</label>
            </div>
          </div>
          <div class="analytics-chart-wrap">
            <canvas id="rosterPieChart" aria-label="Roster composition pie chart" role="img"></canvas>
          </div>
        </section>

        <section class="card analytics-card">
          <div class="analytics-card-header">
            <strong>Roster Breakdown</strong>
            <span class="muted small">Total Adventurers: ${analytics.total}</span>
          </div>
          <div class="analytics-breakdown">
            <div>
              <h4>Level Distribution</h4>
              <ul class="analytics-list">
                ${levelEntries.length ? levelEntries.map(([level, count]) => `
                  <li><span>${escapeHtml(level)}</span><span class="analytics-badge">${count}</span></li>
                `).join('') : '<li class="muted">No characters yet.</li>'}
              </ul>
            </div>
            <div>
              <h4>Class Popularity</h4>
              <div class="analytics-class-list">
                <ul class="analytics-list">
                  ${classEntries.length ? classEntries.map(([className, count]) => `
                    <li><span>${escapeHtml(className)}</span><span class="analytics-badge primary">${count}</span></li>
                  `).join('') : '<li class="muted">No characters yet.</li>'}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section class="card analytics-dice">
        <div class="analytics-card-header">
          <strong>d20 Dice Roll Distribution &amp; Fairness</strong>
          <div class="analytics-dice-stats">
            <span class="analytics-badge">Total Rolls: ${diceStats.totalRolls}</span>
            <span class="analytics-badge primary">Avg Roll: ${diceStats.averageRoll} (Exp: 10.5)</span>
            <span class="analytics-badge dice-success">Nat 20: ${diceStats.nat20Count}</span>
            <span class="analytics-badge fallen">Nat 1: ${diceStats.nat1Count}</span>
          </div>
        </div>
        <div class="analytics-dice-chart-wrap">
          <canvas id="diceBarChart" aria-label="d20 roll distribution bar chart" role="img"></canvas>
        </div>
      </section>

      <section class="card analytics-graveyard">
        <div class="analytics-card-header">
          <strong>Hall of the Fallen (Graveyard)</strong>
          <span class="analytics-badge fallen">${analytics.graveyard.length} Fallen</span>
        </div>
        <div class="analytics-table-wrap">
          <table>
            <thead>
              <tr>
                <th class="sortable">Character</th>
                <th class="sortable">Player</th>
                <th class="sortable">Class &amp; Level</th>
                <th class="sortable">Fateful Adventure</th>
                <th class="sortable">Presiding DM</th>
                <th>Demise Circumstances</th>
              </tr>
            </thead>
            <tbody>
              ${analytics.graveyard.length === 0 ? `
                <tr><td colspan="6" class="analytics-empty">No heroes have fallen yet. The realm remains fortunate.</td></tr>
              ` : analytics.graveyard.map(character => `
                <tr>
                  <td><strong>${escapeHtml(character.name)}</strong></td>
                  <td class="muted">${escapeHtml(character.player_tag || 'Unknown')}</td>
                  <td><span class="analytics-badge">${escapeHtml(character.class || 'Class')} (Lvl ${character.level || 3})</span></td>
                  <td>${character.death_adv_title ? `<span class="gold">#${character.death_adventure_id} ${escapeHtml(character.death_adv_title)}</span>` : '<span class="muted">Off-screen / Unknown</span>'}</td>
                  <td class="muted">${escapeHtml(character.death_dm_name || '—')}</td>
                  <td class="muted italic">${escapeHtml(character.death_notes || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <script>
        document.addEventListener('DOMContentLoaded', () => {
          const statusSelect = document.getElementById('char-status-select');
          const deathBox = document.getElementById('cause-of-death-box');
          if (statusSelect && deathBox) {
            statusSelect.addEventListener('change', () => {
              deathBox.style.display = statusSelect.value.toLowerCase() === 'dead' ? 'block' : 'none';
            });
          }

          const canvas = document.getElementById('rosterPieChart');
          const dataPayload = ${analyticsJson};
          const palette = [
            '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
            '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#a855f7'
          ];

          function buildDataset(metric) {
            let source = {};
            if (metric === 'species') source = dataPayload.speciesCount;
            if (metric === 'classes') source = dataPayload.classCount;
            if (metric === 'status') source = dataPayload.statusCount;

            const labels = Object.keys(source);
            const values = Object.values(source);

            return {
              labels,
              datasets: [{
                data: values,
                backgroundColor: labels.map((_, index) => palette[index % palette.length]),
                borderColor: '#1e293b',
                borderWidth: 2
              }]
            };
          }

          if (!window.Chart) {
            console.error('Chart.js failed to load; analytics charts are unavailable.');
            return;
          }

          if (canvas) {
            const pieChart = new Chart(canvas, {
              type: 'pie',
              data: buildDataset('species'),
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'right',
                    labels: { color: '#cbd5e1', font: { size: 11 } }
                  }
                }
              }
            });

            document.querySelectorAll('input[name="metricRadio"]').forEach(radio => {
              radio.addEventListener('change', event => {
                pieChart.data = buildDataset(event.target.value);
                pieChart.update();
              });
            });
          }

          const diceCanvas = document.getElementById('diceBarChart');
          if (diceCanvas) {
            const diceData = ${diceStatsJson};
            const labels = Object.keys(diceData);
            const values = Object.values(diceData);
            const backgroundColors = labels.map(num => {
              if (num === '1') return '#ef4444';
              if (num === '20') return '#10b981';
              return '#3b82f6';
            });

            new Chart(diceCanvas, {
              type: 'bar',
              data: {
                labels,
                datasets: [{
                  label: 'Roll Count',
                  data: values,
                  backgroundColor: backgroundColors,
                  borderRadius: 4,
                  borderWidth: 0
                }]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: {
                    grid: { color: '#334155' },
                    ticks: { color: '#94a3b8', font: { weight: 'bold' } },
                    title: { display: true, text: 'd20 Face Value', color: '#cbd5e1' }
                  },
                  y: {
                    grid: { color: '#334155' },
                    ticks: { color: '#94a3b8', stepSize: 1 },
                    beginAtZero: true,
                    title: { display: true, text: 'Frequency', color: '#cbd5e1' }
                  }
                },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      title: items => 'Natural ' + items[0].label,
                      label: context => 'Rolled ' + context.parsed.y + ' times'
                    }
                  }
                }
              }
            });
          }
        });
      </script>
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

  // ── TAB: AUCTIONS ──
  else if (currentTab === 'auctions') {
    contentHtml = `
      <section class="card">
        <h3>Auctions</h3>
        <p>Players will be able to submit magic items for auction, then bid against and outbid one another. If an item receives no bids, it will be sold for at least 50% of its vendor value.</p>
        <span class="analytics-badge">Coming soon · Next on the roadmap</span>
      </section>
    `;
  }

  // ── TAB: CHARACTER SHEET ──
  else if (currentTab === 'character-sheet') {
    const characters = db.getAllPlayersWithCharacters()
      .filter(row => row.character_id && (isAdmin || row.player_id === currentUser.id));
    const requestedEditId = Number.parseInt(req.query.edit_char, 10);
    const characterToEdit = Number.isSafeInteger(requestedEditId)
      ? db.getCharacterById(requestedEditId)
      : null;
    const canManageOwnCharacters = currentUser.id > 0;
    const canEditRequestedCharacter = characterToEdit &&
      (isAdmin || (canManageOwnCharacters && characterToEdit.player_id === currentUser.id));
    const classNames = Object.keys(DND_CLASSES_AND_SUBCLASSES);
    const sheetClassTreeJson = JSON.stringify(DND_CLASSES_AND_SUBCLASSES).replace(/</g, '\\u003c');
    const sheetSpeciesJson = JSON.stringify(DND_DATA.species).replace(/</g, '\\u003c');
    const sheetBackgroundsJson = JSON.stringify(DND_DATA.backgrounds).replace(/</g, '\\u003c');
    const sheetClassRulesJson = JSON.stringify({
      ...DND_DATA.classes,
      ...DND_DATA.supplementalClasses
    }).replace(/</g, '\\u003c');
    const editFormHtml = req.query.edit_char
      ? canEditRequestedCharacter
        ? `
          <section id="fullCharacterSheetContainer" class="character-sheet-full">
            <header class="sheet-header">
              <div class="sheet-identity">
                <h2 id="cs_header_name">Character Sheet</h2>
                <span id="cs_header_sub">Loading character...</span>
                <div class="sheet-identity-fields">
                  <label>Name<input id="cs_name" type="text" maxlength="100" required></label>
                  <label>Species<select id="cs_species" required>${DND_SPECIES.map(species => `<option value="${escapeHtml(species)}">${escapeHtml(species)}</option>`).join('')}</select></label>
                  <label>Class<select id="cs_class" required>${classNames.map(className => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('')}</select></label>
                  <label>Subclass<select id="cs_subclass"><option value="">-- None / Base --</option></select></label>
                  <label>Background<select id="cs_background"><option value="">Choose background</option>${Object.keys(DND_DATA.backgrounds).map(background => `<option value="${escapeHtml(background)}">${escapeHtml(background)}</option>`).join('')}</select></label>
                </div>
              </div>
              <div class="sheet-header-actions">
                <a href="/admin?tab=character-sheet" class="btn btn-secondary">Back / Cancel</a>
                <button id="cs_save" class="btn btn-success" type="button" disabled>Save Sheet</button>
              </div>
            </header>
            <p id="cs_message" class="sheet-message" role="status" aria-live="polite"></p>
            <section class="sheet-card point-buy-card">
              <div class="point-buy-header">
                <div>
                <h3>Ability Scores</h3>
                <span>Edit scores freely from 1–30. Point Buy rules apply only when creating a character.</span>
                </div>
              </div>
              <div id="cs_ability_container" class="sheet-abilities point-buy-grid"></div>
              <p id="cs_point_buy_error" class="point-buy-error" role="status" aria-live="polite" hidden></p>
              <div class="point-buy-actions">
                <span>Ability modifiers update automatically.</span>
              </div>
            </section>
            <div class="sheet-layout">
              <div class="sheet-col">
                <section class="sheet-card">
                  <h4>Saving Throws</h4>
                  <div id="cs_saves_container" class="sheet-check-list"></div>
                </section>
              </div>
              <div class="sheet-col">
                <div class="sheet-combat-stats">
                  <label class="sheet-stat"><span>Armor Class</span><input type="number" id="cs_ac" min="0" max="100"></label>
                  <label class="sheet-stat"><span>Initiative</span><input type="text" id="cs_initiative" maxlength="20"></label>
                  <label class="sheet-stat"><span>Speed</span><input type="text" id="cs_speed" maxlength="40"></label>
                  <div class="sheet-stat"><span>Proficiency Bonus</span><strong id="cs_prof_bonus">+2</strong></div>
                </div>
                <section class="sheet-card">
                  <h4>Hit Points &amp; Vitality</h4>
                  <div class="sheet-vitals">
                    <label>Current HP<input type="number" id="cs_hp_current" min="0"></label>
                    <label>Max HP<input type="number" id="cs_hp_max" min="0"></label>
                    <label>Temp HP<input type="number" id="cs_hp_temp" min="0"></label>
                    <label>Hit Dice<input type="text" id="cs_hit_dice" maxlength="40" placeholder="3d8"></label>
                  </div>
                </section>
                <section class="sheet-card">
                  <div class="sheet-section-heading">
                    <h4>Weapons &amp; Attacks</h4>
                    <button id="cs_add_attack" class="btn btn-small" type="button">+ Add Weapon</button>
                  </div>
                  <div class="sheet-table-wrap">
                    <table class="sheet-attacks">
                      <thead><tr><th>Name</th><th>Atk Bonus</th><th>Damage / Type</th><th>Notes</th><th><span class="sr-only">Actions</span></th></tr></thead>
                      <tbody id="cs_attacks_tbody"></tbody>
                    </table>
                  </div>
                </section>
                <section class="sheet-card">
                  <h4>Class Features &amp; Species Traits</h4>
                  <div id="cs_auto_features" class="sheet-auto-features" aria-live="polite"></div>
                  <label class="sheet-notes-label">Additional notes<textarea id="cs_features" rows="5" maxlength="10000" placeholder="Record additional features, choices, or reminders..."></textarea></label>
                </section>
              </div>
              <div class="sheet-col">
                <section class="sheet-card">
                  <h4>Skills</h4>
                  <p id="cs_skill_guidance" class="muted small" aria-live="polite"></p>
                  <div id="cs_species_skill_choices"></div>
                  <div id="cs_skills_container" class="sheet-check-list sheet-skills"></div>
                </section>
                <section class="sheet-card">
                  <h4>Equipment &amp; Items</h4>
                  <textarea id="cs_equipment" rows="5" maxlength="10000" placeholder="Armor, weapons, rations, magical trinkets..."></textarea>
                </section>
              </div>
            </div>
          </section>
        `
        : '<div class="alert red">Character not found or you do not have permission to edit it.</div>'
      : '';
    contentHtml = `
      <section class="card">
        <h3>${isAdmin ? 'Campaign Characters' : 'Your Characters'}</h3>
        ${canManageOwnCharacters
          ? `<p class="muted">${isAdmin ? 'All campaign characters are visible to you. You can create and edit campaign characters.' : 'Create a character or edit your existing character details below.'}</p>${req.query.edit_char ? '' : `<button id="open-character-creator" class="btn btn-green" type="button">+ Create New Character</button><section id="character-creator-view" class="card" hidden><div class="sheet-section-heading"><h4>Create New Character</h4><button id="close-character-creator" class="btn btn-secondary" type="button">Cancel</button></div><div id="character-creator-root"></div><script src="/admin/assets/character-creator.js" defer></script></section>`}`
          : '<p class="muted">All campaign characters are visible to DMs and admins.</p>'}
      </section>
      ${editFormHtml}
      ${characters.length === 0
        ? `<section class="card"><p class="muted">${isAdmin ? 'No characters have been created yet.' : 'You have not created any characters yet.'}</p></section>`
        : `
          <section class="character-sheet-grid" aria-label="Character sheets">
            ${characters.map(character => {
              const classRows = db.getCharacterClasses(character.character_id);
              const classesHtml = classRows.length > 0
                ? classRows.map(classRow => `
                  <li>
                    <strong>${escapeHtml(classRow.class_name)}</strong>${classRow.subclass_name ? ` <span class="muted">(${escapeHtml(classRow.subclass_name)})</span>` : ''}
                    <span class="muted"> · Level ${classRow.class_level}</span>
                  </li>
                `).join('')
                : `<li>${escapeHtml(character.character_class || 'Unknown')}</li>`;
              const editButton = isAdmin || (canManageOwnCharacters && character.player_id === currentUser.id)
                ? `<a href="/admin?tab=character-sheet&edit_char=${character.character_id}" class="btn btn-small">Edit Character Sheet</a>`
                : '';
              return `
                <article class="card character-sheet">
                  <div class="character-sheet-header">
                    <h3>${escapeHtml(character.character_name)}</h3>
                    <span class="tag ${character.character_status === 'alive' ? 'green' : 'red'}">${character.character_status === 'alive' ? 'Alive' : 'Dead'}</span>
                  </div>
                  ${isAdmin ? `<p class="muted small">Player: ${escapeHtml(character.discord_tag)}</p>` : ''}
                  <dl class="character-sheet-details">
                    <div><dt>Race</dt><dd>${escapeHtml(character.character_race || 'Unknown')}</dd></div>
                    <div><dt>Level</dt><dd>${character.character_level || 3}</dd></div>
                    <div><dt>XP</dt><dd>${character.character_xp ?? 0}</dd></div>
                  </dl>
                  <h4>Classes</h4>
                  <ul class="character-sheet-classes">${classesHtml}</ul>
                  ${editButton ? `<div class="character-sheet-actions">${editButton}</div>` : ''}
                </article>
              `;
            }).join('')}
          </section>
        `}
      <script>
        const sheetClassTree = ${sheetClassTreeJson};
        const sheetSpecies = ${sheetSpeciesJson};
        const sheetBackgrounds = ${sheetBackgroundsJson};
        const sheetClassRules = ${sheetClassRulesJson};
        const fullSheetCharacterId = ${canEditRequestedCharacter ? Number(characterToEdit.id) : 'null'};

        function initFullCharacterSheet() {
          const container = document.getElementById('fullCharacterSheetContainer');
          if (!container) return;

          const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
          const skills = [
            ['Acrobatics', 'dex'], ['Animal Handling', 'wis'], ['Arcana', 'int'],
            ['Athletics', 'str'], ['Deception', 'cha'], ['History', 'int'],
            ['Insight', 'wis'], ['Intimidation', 'cha'], ['Investigation', 'int'],
            ['Medicine', 'wis'], ['Nature', 'int'], ['Perception', 'wis'],
            ['Performance', 'cha'], ['Persuasion', 'cha'], ['Religion', 'int'],
            ['Sleight of Hand', 'dex'], ['Stealth', 'dex'], ['Survival', 'wis']
          ];
          const abilityContainer = document.getElementById('cs_ability_container');
          const classSelect = document.getElementById('cs_class');
          const subclassSelect = document.getElementById('cs_subclass');
          const speciesSelect = document.getElementById('cs_species');
          const backgroundSelect = document.getElementById('cs_background');
          const autoFeatures = document.getElementById('cs_auto_features');
          const speciesSkillChoicesContainer = document.getElementById('cs_species_skill_choices');
          abilities.forEach(ability => {
            const row = document.createElement('div');
            row.className = 'sheet-ability';
            const name = document.createElement('strong');
            name.textContent = ability.toUpperCase();
            const score = document.createElement('input');
            score.type = 'number';
            score.min = '1';
            score.max = '30';
            score.step = '1';
            score.dataset.ability = ability;
            score.setAttribute('aria-label', ability.toUpperCase() + ' score');
            score.value = '8';
            const modifier = document.createElement('span');
            modifier.className = 'sheet-ability-modifier';
            modifier.dataset.modifier = ability;
            row.append(name, score, modifier);
            abilityContainer.appendChild(row);
          });

          const savesContainer = document.getElementById('cs_saves_container');
          const skillsContainer = document.getElementById('cs_skills_container');
          abilities.forEach(ability => {
            const row = document.createElement('label');
            row.className = 'sheet-check-row';
            row.innerHTML = '<input type="checkbox" data-save="' + ability + '"><span>' +
              ability.toUpperCase() + '</span><strong class="sheet-check-modifier"></strong>';
            savesContainer.appendChild(row);
          });
          skills.forEach(([skill, ability]) => {
            const row = document.createElement('label');
            row.className = 'sheet-check-row';
            row.innerHTML = '<input type="checkbox" data-skill="' + skill + '"><span>' + skill +
              '</span><small>' + ability.toUpperCase() + '</small><strong class="sheet-check-modifier"></strong>';
            skillsContainer.appendChild(row);
          });

          const message = document.getElementById('cs_message');
          const pointBuyError = document.getElementById('cs_point_buy_error');
          const abilityScores = [...abilityContainer.querySelectorAll('[data-ability]')];
          const proficiencyBonus = document.getElementById('cs_prof_bonus');
          let sheetCharacterLevel = 1;
          let classLevel = 1;
          let classLevels = {};
          let selectedClassSkills = [];
          let selectedSpeciesSkills = [];
          let savedSpeciesSkills = [];

          function updateRuleDrivenFields() {
            const classData = sheetClassRules[classSelect.value] || {};
            const backgroundData = sheetBackgrounds[backgroundSelect.value] || {};
            const speciesData = sheetSpecies[speciesSelect.value] || {};
            const fixedSkills = new Set([
              ...(backgroundData.skillProficiencies || []),
              ...(speciesData.skillProficiencies || []),
              ...selectedSpeciesSkills,
              ...savedSpeciesSkills
            ]);
            const classOptions = new Set(
              classData.skillChoices ? classData.skillChoices.options : []
            );
            selectedClassSkills = selectedClassSkills.filter(skill =>
              classOptions.has(skill) && !fixedSkills.has(skill)
            );
            const classChoiceCount = classData.skillChoices ? classData.skillChoices.count : 0;
            speciesSkillChoicesContainer.replaceChildren();
            if (speciesData.skillChoiceCount) {
              const label = document.createElement('label');
              label.className = 'sheet-species-skill-choice';
              label.textContent = 'Choose ' + speciesData.skillChoiceCount + ' species skill proficiency';
              for (let index = 0; index < speciesData.skillChoiceCount; index += 1) {
                const select = document.createElement('select');
                select.setAttribute('aria-label', 'Species skill choice ' + (index + 1));
                select.add(new Option('Choose a skill', ''));
                skills.forEach(([skill]) => select.add(new Option(skill, skill)));
                select.value = selectedSpeciesSkills[index] || '';
                select.addEventListener('change', () => {
                  selectedSpeciesSkills = [...speciesSkillChoicesContainer.querySelectorAll('select')]
                    .map(item => item.value)
                    .filter(Boolean);
                  updateRuleDrivenFields();
                });
                label.appendChild(select);
              }
              speciesSkillChoicesContainer.appendChild(label);
            }
            skills.forEach(([skill]) => {
              const checkbox = skillsContainer.querySelector('[data-skill="' + skill + '"]');
              const automatic = fixedSkills.has(skill);
              checkbox.checked = automatic || selectedClassSkills.includes(skill);
              checkbox.disabled = automatic || !classOptions.has(skill);
              const row = checkbox.closest('.sheet-check-row');
              row.classList.toggle('is-automatic-proficiency', automatic);
              const source = (backgroundData.skillProficiencies || []).includes(skill)
                ? 'Background'
                : (speciesData.skillProficiencies || []).includes(skill)
                  ? 'Species'
                  : 'Character feature';
              row.title = automatic
                ? 'Granted by ' + source
                : classOptions.has(skill) ? 'Choose as a class proficiency' : 'Not available from this class';
            });
            abilities.forEach(ability => {
              const checkbox = savesContainer.querySelector('[data-save="' + ability + '"]');
              checkbox.checked = (classData.savingThrows || []).includes(ability);
              checkbox.disabled = true;
              checkbox.closest('.sheet-check-row').classList.toggle('is-automatic-proficiency', checkbox.checked);
            });
            const chosenCount = selectedClassSkills.length;
            const speciesChoiceCount = speciesData.skillChoiceCount || 0;
            document.getElementById('cs_skill_guidance').textContent = classChoiceCount
              ? 'Choose ' + classChoiceCount + ' skill proficiencies for ' + classSelect.value +
                ' (' + chosenCount + ' selected). Background and species proficiencies are automatic.'
              : 'Background and species proficiencies are automatic.';
            const classFeatures = [];
            Object.entries(classData.featuresByLevel || {})
              .filter(([level]) => Number(level) <= classLevel)
              .forEach(([, names]) => classFeatures.push(...names));
            const autoLines = [
              ...classFeatures.map(name => 'Class: ' + name),
              ...(subclassSelect.value && classLevel >= 3
                ? ['Subclass selected: ' + subclassSelect.value]
                : []),
              ...(backgroundData.skillProficiencies || []).map(skill => 'Background proficiency: ' + skill),
              ...(speciesData.traits || []).map(trait => trait.name + ': ' + trait.description)
            ];
            autoFeatures.replaceChildren();
            if (autoLines.length) {
              const list = document.createElement('ul');
              autoLines.forEach(line => {
                const item = document.createElement('li');
                item.textContent = line;
                list.appendChild(item);
              });
              autoFeatures.appendChild(list);
            } else {
              autoFeatures.textContent = 'Choose a class, species, and background to see features and proficiencies.';
            }
            updateDerivedStats(sheetCharacterLevel);
            updateAbilityValidation();
          }

          function updateSubclasses(selected = subclassSelect.value) {
            subclassSelect.replaceChildren(new Option('-- None / Base --', ''));
            (sheetClassTree[classSelect.value] || []).forEach(subclass => {
              subclassSelect.add(new Option(subclass, subclass));
            });
            if ([...subclassSelect.options].some(option => option.value === selected)) {
              subclassSelect.value = selected;
            }
          }

          function updateDerivedStats(level) {
            const bonus = Math.ceil(Math.max(1, Number(level) || 1) / 4) + 1;
            proficiencyBonus.textContent = '+' + bonus;
            abilityScores.forEach(input => {
              const ability = input.dataset.ability;
              const base = Number(input.value);
              const modifier = Number.isInteger(base) && base >= 1 && base <= 30
                ? Math.floor((base - 10) / 2)
                : null;
              const label = document.querySelector('[data-modifier="' + ability + '"]');
              label.textContent = modifier === null
                ? '—'
                : (modifier >= 0 ? '+' : '') + modifier;
            });
            abilities.forEach(ability => {
              const scoreInput = abilityContainer.querySelector('[data-ability="' + ability + '"]');
              const score = Number(scoreInput.value);
              const modifier = Number.isInteger(score) && score >= 1 && score <= 30
                ? Math.floor((score - 10) / 2)
                : 0;
              const saveRow = savesContainer.querySelector('[data-save="' + ability + '"]').closest('.sheet-check-row');
              const saveTotal = modifier + (saveRow.querySelector('input').checked ? bonus : 0);
              saveRow.querySelector('.sheet-check-modifier').textContent =
                (saveTotal >= 0 ? '+' : '') + saveTotal;
            });
            skills.forEach(([skill, ability]) => {
              const scoreInput = abilityContainer.querySelector('[data-ability="' + ability + '"]');
              const score = Number(scoreInput.value);
              const modifier = Number.isInteger(score) && score >= 1 && score <= 30
                ? Math.floor((score - 10) / 2)
                : 0;
              const skillRow = skillsContainer.querySelector('[data-skill="' + skill + '"]').closest('.sheet-check-row');
              const total = modifier + (skillRow.querySelector('input').checked ? bonus : 0);
              skillRow.querySelector('.sheet-check-modifier').textContent =
                (total >= 0 ? '+' : '') + total;
            });
          }

          function updateAbilityValidation() {
            const inputs = abilityScores.map(input => Number(input.value));
            const validAbilities = inputs.every(score =>
              Number.isInteger(score) && score >= 1 && score <= 30
            );
            const classData = sheetClassRules[classSelect.value] || {};
            const requiredSkills = classData.skillChoices ? classData.skillChoices.count : 0;
            const speciesChoiceCount = (sheetSpecies[speciesSelect.value] || {}).skillChoiceCount || 0;
            const validClassSkills = selectedClassSkills.length === requiredSkills &&
              selectedSpeciesSkills.length === speciesChoiceCount &&
              new Set(selectedSpeciesSkills).size === selectedSpeciesSkills.length;
            const error = !validAbilities
              ? 'Ability scores must be whole numbers from 1 to 30.'
              : !validClassSkills
                ? 'Choose exactly ' + requiredSkills + ' skill proficiencies for ' + classSelect.value +
                  (speciesChoiceCount ? ' and ' + speciesChoiceCount + ' species skill proficiency.' : '.')
                : '';
            pointBuyError.textContent = error;
            pointBuyError.classList.toggle('is-error', Boolean(error));
            pointBuyError.hidden = !error;
            document.getElementById('cs_save').disabled = Boolean(error);
            return !error;
          }

          function getAbilityScores() {
            if (!updateAbilityValidation()) {
              throw new Error(pointBuyError.textContent || 'Ability scores must be whole numbers from 1 to 30.');
            }
            return Object.fromEntries(abilityScores.map(input => [
              input.dataset.ability, Number(input.value)
            ]));
          }

          function addAttackRow(attack = { bonus: '+5', damage: '1d8+3' }) {
            const row = document.createElement('tr');
            [
              ['name', 'Weapon name'], ['bonus', 'Attack bonus'],
              ['damage', 'Damage / type'], ['notes', 'Notes']
            ].forEach(([field, placeholder]) => {
              const cell = document.createElement('td');
              const input = document.createElement('input');
              input.type = 'text';
              input.maxLength = field === 'notes' ? 300 : 100;
              input.dataset.attackField = field;
              input.setAttribute('aria-label', placeholder);
              input.placeholder = placeholder;
              input.value = typeof attack[field] === 'string' ? attack[field] : '';
              cell.appendChild(input);
              row.appendChild(cell);
            });
            const actionCell = document.createElement('td');
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn btn-small sheet-remove-attack';
            remove.textContent = 'Remove';
            remove.setAttribute('aria-label', 'Remove attack');
            actionCell.appendChild(remove);
            row.appendChild(actionCell);
            document.getElementById('cs_attacks_tbody').appendChild(row);
          }

          document.getElementById('cs_add_attack').addEventListener('click', () => addAttackRow());
          document.getElementById('cs_attacks_tbody').addEventListener('click', event => {
            if (event.target.matches('.sheet-remove-attack')) event.target.closest('tr').remove();
          });
          abilityContainer.addEventListener('input', event => {
            if (event.target.matches('[data-ability]')) {
              updateAbilityValidation();
              updateDerivedStats(sheetCharacterLevel);
            }
          });
          savesContainer.addEventListener('change', () => updateDerivedStats(sheetCharacterLevel));
          skillsContainer.addEventListener('change', () => updateDerivedStats(sheetCharacterLevel));
          skillsContainer.addEventListener('change', () => {
            const classData = sheetClassRules[classSelect.value] || {};
            const classOptions = new Set(classData.skillChoices ? classData.skillChoices.options : []);
            const backgroundData = sheetBackgrounds[backgroundSelect.value] || {};
            const speciesData = sheetSpecies[speciesSelect.value] || {};
            const fixedSkills = new Set([
              ...(backgroundData.skillProficiencies || []),
              ...(speciesData.skillProficiencies || []),
              ...savedSpeciesSkills
            ]);
            selectedClassSkills = skills
              .map(([skill]) => skill)
              .filter(skill => classOptions.has(skill) && !fixedSkills.has(skill) &&
                skillsContainer.querySelector('[data-skill="' + skill + '"]').checked);
            updateRuleDrivenFields();
          });
          classSelect.addEventListener('change', () => {
            classLevel = classLevels[classSelect.value] || sheetCharacterLevel;
            selectedClassSkills = [];
            updateSubclasses('');
            updateRuleDrivenFields();
          });
          subclassSelect.addEventListener('change', updateRuleDrivenFields);
          speciesSelect.addEventListener('change', updateRuleDrivenFields);
          backgroundSelect.addEventListener('change', updateRuleDrivenFields);

          async function loadSheet() {
            message.textContent = 'Loading character sheet...';
            try {
              const response = await fetch('/api/characters/' + fullSheetCharacterId);
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'Could not load character sheet.');
              const character = result.character;
              const data = result.sheetData || {};
              sheetCharacterLevel = character.level || 1;
              const classRows = Array.isArray(result.classes) ? result.classes : [];
              classLevels = Object.fromEntries(classRows.map(classRow => [
                classRow.class_name, classRow.class_level
              ]));
              classLevel = classLevels[character.class] || sheetCharacterLevel;
              document.getElementById('cs_name').value = character.name || '';
              speciesSelect.value = character.race || '';
              classSelect.value = character.class || '';
              updateSubclasses(character.subclass || '');
              const savedBackground = data.pointBuy && data.pointBuy.background
                ? data.pointBuy.background
                : data.background;
              backgroundSelect.value = Object.prototype.hasOwnProperty.call(sheetBackgrounds, savedBackground)
                ? savedBackground
                : '';
              const savedSkills = Array.isArray(data.skillProficiencies) ? data.skillProficiencies : [];
              const backgroundSkills = sheetBackgrounds[backgroundSelect.value]
                ? sheetBackgrounds[backgroundSelect.value].skillProficiencies
                : [];
              const speciesSkills = (sheetSpecies[speciesSelect.value] || {}).skillProficiencies || [];
              const classSkillOptions = (sheetClassRules[classSelect.value] || {}).skillChoices
                ? sheetClassRules[classSelect.value].skillChoices.options
                : [];
              const savedSpeciesChoices = savedSkills.filter(skill =>
                !classSkillOptions.includes(skill) &&
                !backgroundSkills.includes(skill) &&
                !speciesSkills.includes(skill)
              );
              selectedSpeciesSkills = Array.isArray(data.speciesSkillChoices)
                ? data.speciesSkillChoices
                : savedSpeciesChoices.slice(0, ((sheetSpecies[speciesSelect.value] || {}).skillChoiceCount || 0));
              savedSpeciesSkills = savedSkills.filter(skill =>
                !classSkillOptions.includes(skill) &&
                !backgroundSkills.includes(skill) &&
                !speciesSkills.includes(skill) &&
                !selectedSpeciesSkills.includes(skill)
              );
              selectedClassSkills = savedSkills.filter(skill =>
                classSkillOptions.includes(skill) &&
                !backgroundSkills.includes(skill) &&
                !speciesSkills.includes(skill)
              );
              updateRuleDrivenFields();
              document.getElementById('cs_header_name').textContent = character.name || 'Character Sheet';
              document.getElementById('cs_header_sub').textContent =
                'Level ' + (character.level || 1) + ' ' + (character.race || '') + ' ' +
                (character.class || 'Adventurer') +
                (character.subclass ? ' (' + character.subclass + ')' : '');
              abilities.forEach(ability => {
                const input = abilityContainer.querySelector('[data-ability="' + ability + '"]');
                const scores = data.abilities || {};
                let value = scores[ability];
                if (value && typeof value === 'object') {
                  value = value.score === undefined ? value.total : value.score;
                }
                if (value === undefined && data.abilityDetails && data.abilityDetails[ability]) {
                  value = data.abilityDetails[ability].total;
                }
                if (value === undefined) {
                  const pointBuy = data.pointBuy || null;
                  const oldBase = pointBuy && pointBuy.baseScores
                    ? pointBuy.baseScores[ability]
                    : data.baseAbilityScores && data.baseAbilityScores[ability];
                  if (oldBase !== undefined) {
                    value = Number(oldBase) + Number((data.backgroundBonuses || {})[ability] || 0);
                  }
                }
                if (value === undefined) value = scores[ability.toUpperCase()];
                input.value = value === undefined || value === null
                  ? 10
                  : Math.max(1, Math.min(30, Number(value) || 1));
              });
              const fields = {
                cs_ac: 'armorClass', cs_initiative: 'initiative', cs_speed: 'speed',
                cs_hp_current: 'hpCurrent', cs_hp_max: 'hpMax', cs_hp_temp: 'hpTemp',
                cs_hit_dice: 'hitDice', cs_features: 'features', cs_equipment: 'equipmentText'
              };
              Object.entries(fields).forEach(([id, key]) => {
                const legacyKey = {
                  hpCurrent: 'currentHp',
                  hpMax: 'maxHp',
                  hpTemp: 'tempHp',
                  equipmentText: 'equipment'
                }[key];
                const value = data[key] === undefined && legacyKey ? data[legacyKey] : data[key];
                const defaultValue = {
                  cs_ac: 10,
                  cs_hp_current: 10,
                  cs_hp_max: 10,
                  cs_hp_temp: 0,
                  cs_hit_dice: sheetCharacterLevel + 'd8'
                }[id];
                document.getElementById(id).value = value === undefined || value === null
                  ? (defaultValue === undefined ? '' : defaultValue)
                  : value;
              });
              document.getElementById('cs_initiative').value =
                data.initiative === undefined
                  ? (Math.floor((Number(abilityContainer.querySelector('[data-ability="dex"]').value) - 10) / 2) >= 0
                    ? '+' : '') + Math.floor((Number(abilityContainer.querySelector('[data-ability="dex"]').value) - 10) / 2)
                  : data.initiative;
              document.getElementById('cs_speed').value =
                data.speed === undefined ? '30 ft.' : data.speed;
              const attacks = Array.isArray(data.attacks) ? data.attacks : [];
              if (attacks.length > 0) attacks.forEach(addAttackRow);
              else addAttackRow();
              updateAbilityValidation();
              updateDerivedStats(character.level);
              message.textContent = '';
            } catch (error) {
              message.textContent = error.message;
              message.classList.add('is-error');
            }
          }

          async function saveSheet() {
            const button = document.getElementById('cs_save');
            button.disabled = true;
            message.classList.remove('is-error');
            message.textContent = 'Saving character sheet...';
            let currentScores;
            try {
              currentScores = getAbilityScores();
            } catch (error) {
              message.textContent = error.message;
              message.classList.add('is-error');
              button.disabled = false;
              return;
            }
            button.disabled = true;
            const sheetData = {
              abilities: currentScores,
              savingProficiencies: (sheetClassRules[classSelect.value] || {}).savingThrows || [],
              skillProficiencies: [...new Set([
                ...selectedClassSkills,
                ...selectedSpeciesSkills,
                ...savedSpeciesSkills,
                ...((sheetBackgrounds[backgroundSelect.value] || {}).skillProficiencies || []),
                ...((sheetSpecies[speciesSelect.value] || {}).skillProficiencies || [])
              ])],
              classSkillChoices: selectedClassSkills,
              speciesSkillChoices: selectedSpeciesSkills,
              background: backgroundSelect.value,
              armorClass: document.getElementById('cs_ac').value === ''
                ? null : Number(document.getElementById('cs_ac').value),
              initiative: document.getElementById('cs_initiative').value,
              speed: document.getElementById('cs_speed').value,
              hpCurrent: document.getElementById('cs_hp_current').value === ''
                ? null : Number(document.getElementById('cs_hp_current').value),
              hpMax: document.getElementById('cs_hp_max').value === ''
                ? null : Number(document.getElementById('cs_hp_max').value),
              hpTemp: document.getElementById('cs_hp_temp').value === ''
                ? 0 : Number(document.getElementById('cs_hp_temp').value),
              hitDice: document.getElementById('cs_hit_dice').value,
              attacks: [...document.querySelectorAll('#cs_attacks_tbody tr')].map(row =>
                Object.fromEntries([...row.querySelectorAll('[data-attack-field]')].map(input =>
                  [input.dataset.attackField, input.value.trim()]
                ))
              ),
              features: document.getElementById('cs_features').value,
              equipmentText: document.getElementById('cs_equipment').value
            };
            try {
              const response = await fetch('/api/characters/' + fullSheetCharacterId + '/sheet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: document.getElementById('cs_name').value,
                  species: document.getElementById('cs_species').value,
                  character_class: classSelect.value,
                  subclass: subclassSelect.value,
                  background: backgroundSelect.value,
                  sheetData
                })
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'Could not save character sheet.');
              document.getElementById('cs_header_name').textContent =
                document.getElementById('cs_name').value;
              document.getElementById('cs_header_sub').textContent =
                'Level ' + sheetCharacterLevel + ' ' +
                document.getElementById('cs_species').value + ' ' + classSelect.value +
                (subclassSelect.value ? ' (' + subclassSelect.value + ')' : '');
              message.textContent = result.message || 'Character sheet saved.';
              message.classList.remove('is-error');
            } catch (error) {
              message.textContent = error.message;
              message.classList.add('is-error');
            } finally {
              updateAbilityValidation();
            }
          }

          document.getElementById('cs_save').addEventListener('click', saveSheet);
          loadSheet();
        }

        initFullCharacterSheet();
        const creatorView = document.getElementById('character-creator-view');
        const openCreatorButton = document.getElementById('open-character-creator');
        const closeCreatorButton = document.getElementById('close-character-creator');
        if (creatorView && openCreatorButton && closeCreatorButton) {
          openCreatorButton.addEventListener('click', () => {
            creatorView.hidden = false;
            creatorView.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
          closeCreatorButton.addEventListener('click', () => {
            creatorView.hidden = true;
            openCreatorButton.focus();
          });
        }
      </script>
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
    const allPlayers = (db.getAllPlayers ? db.getAllPlayers() : [])
      .filter(player => isAdmin || player.id === currentUser.id);
    const playerView = isRootAdmin && req.query.view === 'accounts' ? 'accounts' : 'roster';
    const playersSubnavHtml = isRootAdmin ? `
      <div class="player-subtabs" role="tablist" aria-label="Players sections">
        <a href="/admin?tab=players&view=roster" class="${playerView === 'roster' ? 'active' : ''}" role="tab" aria-selected="${playerView === 'roster'}">Character Roster</a>
        <a href="/admin?tab=players&view=accounts" class="${playerView === 'accounts' ? 'active' : ''}" role="tab" aria-selected="${playerView === 'accounts'}">Passwords &amp; Roles</a>
      </div>
    ` : '';
    const playerRows = (db.getAllPlayersWithCharacters ? db.getAllPlayersWithCharacters() : [])
      .filter(row => isAdmin || row.player_id === currentUser.id);

    const editCharId = isAdmin && req.query.edit_char ? parseInt(req.query.edit_char, 10) : null;
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
    const dndSpeciesJson = JSON.stringify(DND_DATA.species).replace(/</g, '\\u003c');
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
                <div id="editSpeciesTraits" class="species-traits" aria-live="polite"></div>
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
              <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; align-items: flex-end;">
                <div>
                  <label style="font-size: 12px;">Adventure XP (Override):</label><br>
                  <input type="number" name="xp" min="0" value="${charToEdit.xp}" required style="width: 100%; margin-top: 4px;">
                </div>
                <div>
                  <label style="font-size: 12px;">Gold (gp):</label><br>
                  <input type="number" name="gold_gp" min="0" step="1" value="${charToEdit.gold_gp}" required style="width: 100%; margin-top: 4px;">
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
                  <select name="status" id="char-status-select" style="width: 100%; margin-top: 4px;" required>
                    <option value="alive" ${charToEdit.status === 'alive' ? 'selected' : ''}>Alive</option>
                    <option value="dead" ${charToEdit.status === 'dead' ? 'selected' : ''}>Dead</option>
                  </select>
                </div>
              </div>
            </div>

            <div id="cause-of-death-box" style="display: ${charToEdit.status === 'dead' ? 'block' : 'none'}; background: #232428; border: 1px solid #f23f43; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <h4 style="margin: 0 0 8px 0; color: #f23f43; font-size: 13px;">Cause of Death / Demise Chronicle</h4>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div>
                  <label for="death-adventure">Fateful Adventure:</label>
                  <select id="death-adventure" name="death_adventure_id" style="width: 100%; margin-top: 4px;">
                    <option value="">Unknown / not recorded</option>
                    ${availableAdventures.map(adventure => `<option value="${adventure.id}" ${Number(charToEdit.death_adventure_id) === Number(adventure.id) ? 'selected' : ''}>${escapeHtml(adventure.title)} (#${adventure.id})</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label for="death-dm">Dungeon Master (Host):</label>
                  <select id="death-dm" name="death_dm_player_id" style="width: 100%; margin-top: 4px;">
                    <option value="">Unknown / not recorded</option>
                    ${allPlayers.map(player => `<option value="${player.id}" ${Number(charToEdit.death_dm_player_id) === Number(player.id) ? 'selected' : ''}>${escapeHtml(player.discord_tag)}</option>`).join('')}
                  </select>
                </div>
                <div style="grid-column: 1 / -1;">
                  <label for="death-notes">Death Circumstances / Last Words:</label>
                  <textarea id="death-notes" name="death_notes" rows="2" maxlength="2000" placeholder="e.g. Slain by an ancient red dragon in the fiery caverns..." style="width: 100%; margin-top: 4px;">${escapeHtml(charToEdit.death_notes || '')}</textarea>
                </div>
              </div>
            </div>

            <div style="background: #232428; padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <label style="font-weight: bold; color: #d4af37; font-size: 13px;">
                <input type="checkbox" id="edit-class-allocations">
                Redistribute multiclass levels
              </label>
              <p style="color: #949ba4; font-size: 12px; margin: 6px 0;">
                Leave unchecked to assign level-ups automatically to the primary class. You can still remove secondary classes; their levels return to the primary class. When enabled, set secondary class levels; the primary class receives the remaining XP-derived levels.
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

            const characterStatus = document.getElementById('char-status-select');
            const deathDetails = document.getElementById('cause-of-death-box');
            if (characterStatus && deathDetails) {
              characterStatus.addEventListener('change', () => {
                deathDetails.style.display = characterStatus.value === 'dead' ? 'block' : 'none';
              });
            }

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
            let hasRemovedClassAllocation = false;

            function updateAllocationMode() {
              const enabled = allocationToggle.checked;
              allocationJson.disabled = !enabled && !hasRemovedClassAllocation;
              allocationContainer.querySelectorAll('select, input').forEach(control => {
                control.disabled = !enabled;
              });
              allocationContainer.querySelectorAll('.remove-class-allocation').forEach(button => {
                button.disabled = false;
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
                hasRemovedClassAllocation = true;
                if (!allocationContainer.querySelector('.class-allocation-row')) {
                  const emptyMessage = document.createElement('p');
                  emptyMessage.id = 'no-secondary-classes';
                  emptyMessage.style.cssText = 'color: #949ba4; font-size: 12px;';
                  emptyMessage.textContent = 'No secondary classes.';
                  allocationContainer.appendChild(emptyMessage);
                }
                updateAllocationMode();
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
              if (allocationToggle.checked || hasRemovedClassAllocation) {
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

   const rosterHtml = `
      ${charFormHtml}

      <!-- Top Forms Grid: 1fr (Player Registration) to 2fr (Character Creation) -->
     ${isAdmin ? `<div style="display: ${charToEdit ? 'none' : 'grid'}; grid-template-columns: 1fr 2fr; gap: 20px; margin-bottom: 20px;">
        
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
                  <div id="addSpeciesTraits" class="species-traits" aria-live="polite"></div>
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
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: 14px; align-items: flex-end;">
                <div>
                  <label style="white-space: nowrap; font-size: 12px;">Starting XP (0 = Lvl 3):</label><br>
                  <input type="number" name="xp" min="0" value="0" required style="width: 100%; margin-top: 4px;">
                </div>
                <div>
                  <label style="white-space: nowrap; font-size: 12px;">Starting Gold (gp):</label><br>
                  <input type="number" name="gold_gp" min="0" step="1" value="0" required style="width: 100%; margin-top: 4px;">
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
      </div>` : ''}

      <!-- Character Roster Table: Full-width container matching top grid -->
      <div class="card" style="width: 100%;">
        <h3>${isAdmin ? 'Campaign Characters & Roster' : 'My Characters'} (${playerRows.filter(r => r.character_id).length} characters)</h3>
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
              <th class="sortable">Purse</th>
              <th class="sortable">Status</th>
              ${isAdmin ? '<th>Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${playerRows.length === 0 ? `<tr><td colspan="${9 + (isAdmin ? 1 : 0)}">${isAdmin ? 'No players or characters registered yet.' : 'No characters are linked to your player account yet.'}</td></tr>` : playerRows.map(row => `
              <tr class="${row.player_id === currentUser.id ? 'player-self' : ''}">
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
                <td data-sort="${row.character_gold_gp || 0}">${row.character_id ? formatCp(Math.round((row.character_gold_gp || 0) * 100)) : '—'}</td>
                <td data-sort="${row.character_status || ''}">
                  ${row.character_status === 'alive' 
                    ? '<span class="tag green">Alive</span>' 
                    : row.character_status === 'dead' 
                      ? '<span class="tag red">Dead</span>' 
                      : '—'}
                </td>
                ${isAdmin ? `<td style="white-space: nowrap;">
                  ${row.character_id ? `
                    <a href="/admin?tab=players&edit_char=${row.character_id}" class="btn btn-small">Edit Character</a>
                    <button type="button" class="btn btn-small btn-gold edit-character-gold" data-character-id="${row.character_id}" data-character-name="${escapeHtml(row.character_name)}" data-character-gold="${row.character_gold_gp || 0}">💰 Edit GP</button>
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
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      ${isAdmin ? `
        <div id="goldEditModal" class="shop-modal" role="dialog" aria-modal="true" aria-labelledby="goldEditTitle" hidden>
          <div class="card shop-modal-card">
            <h3 id="goldEditTitle">🪙 Edit Character Gold</h3>
            <p>Target Character: <strong id="goldModalCharName"></strong></p>
            <input type="hidden" id="goldModalCharId">
            <label for="goldModalInput">Gold Amount (gp)</label>
            <input type="number" id="goldModalInput" min="0" step="0.01" style="width: 100%; margin: 8px 0 12px;">
            <p id="goldModalFeedback" role="status" aria-live="polite"></p>
            <div style="display: flex; justify-content: flex-end; gap: 8px;">
              <button type="button" id="goldModalCancel" class="btn">Cancel</button>
              <button type="button" id="goldModalSave" class="btn btn-gold">Update Gold</button>
            </div>
          </div>
        </div>
      ` : ''}

      <script>
        const classTree = ${dndClassesJson};
        const speciesData = ${dndSpeciesJson};

        const goldEditModal = document.getElementById('goldEditModal');
        if (goldEditModal) {
          const goldModalFeedback = document.getElementById('goldModalFeedback');
          const goldModalSave = document.getElementById('goldModalSave');

          document.querySelectorAll('.edit-character-gold').forEach(button => {
            button.addEventListener('click', () => {
              document.getElementById('goldModalCharId').value = button.dataset.characterId;
              document.getElementById('goldModalCharName').textContent = button.dataset.characterName;
              document.getElementById('goldModalInput').value = button.dataset.characterGold;
              goldModalFeedback.textContent = '';
              goldEditModal.hidden = false;
            });
          });
          document.getElementById('goldModalCancel').addEventListener('click', () => {
            goldEditModal.hidden = true;
          });
          goldModalSave.addEventListener('click', async () => {
            const characterId = document.getElementById('goldModalCharId').value;
            const gold = document.getElementById('goldModalInput').value;
            const parsedGold = Number(gold);
            const goldInCopper = Math.round(parsedGold * 100);
            if (gold === '' || !Number.isFinite(parsedGold) || parsedGold < 0 ||
                !Number.isSafeInteger(goldInCopper) ||
                Math.abs(parsedGold * 100 - goldInCopper) >
                  Number.EPSILON * Math.max(1, Math.abs(parsedGold * 100))) {
              goldModalFeedback.textContent = 'Gold must be non-negative and have no more than two decimal places.';
              return;
            }

            goldModalSave.disabled = true;
            goldModalFeedback.textContent = 'Updating character purse...';
            try {
              const response = await fetch('/api/admin/character-gold', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId, gold: parsedGold })
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error || 'Could not update character gold.');
              goldModalFeedback.textContent =
                'Purse for ' + data.updated.name + ' set to ' + data.updated.newGold + ' gp.';
              window.setTimeout(() => window.location.reload(), 700);
            } catch (error) {
              goldModalFeedback.textContent = error.message;
              goldModalSave.disabled = false;
            }
          });
        }

        function updateSpeciesTraits(selectId, displayId) {
          const select = document.getElementById(selectId);
          const display = document.getElementById(displayId);
          if (!select || !display) return;

          const species = speciesData[select.value];
          if (!species) {
            display.replaceChildren();
            return;
          }

          const heading = document.createElement('strong');
          heading.textContent = 'Traits';
          const details = document.createElement('p');
          details.className = 'muted small';
          details.textContent = 'Size: ' + species.size + ' · Speed: ' + species.speed + ' ft.';
          const list = document.createElement('ul');
          species.traits.forEach(trait => {
            const item = document.createElement('li');
            const name = document.createElement('strong');
            name.textContent = trait.name;
            item.append(name, document.createTextNode(' — ' + trait.description));
            list.appendChild(item);
          });
          display.replaceChildren(heading, details, list);
        }

        document.getElementById('addSpeciesSelect')?.addEventListener('change', () => {
          updateSpeciesTraits('addSpeciesSelect', 'addSpeciesTraits');
        });
        document.getElementById('editSpeciesSelect')?.addEventListener('change', () => {
          updateSpeciesTraits('editSpeciesSelect', 'editSpeciesTraits');
        });
        updateSpeciesTraits('addSpeciesSelect', 'addSpeciesTraits');
        updateSpeciesTraits('editSpeciesSelect', 'editSpeciesTraits');

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
            if (selectId.includes('SpeciesSelect')) {
              const isEdit = selectId.startsWith('edit');
              updateSpeciesTraits(
                selectId,
                isEdit ? 'editSpeciesTraits' : 'addSpeciesTraits'
              );
            }
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

    const accountAccessHtml = `
      <section class="card">
        <h3>Passwords &amp; Roles (${allPlayers.length} accounts)</h3>
        <p class="muted">Set or reset a player's password and choose whether they can manage the campaign as a DM.</p>
        <div class="analytics-table-wrap">
          <table>
            <thead>
              <tr>
                <th class="sortable">Player (Discord Tag)</th>
                <th class="sortable">Discord ID</th>
                <th class="sortable">Current Role</th>
                <th>Account Access</th>
              </tr>
            </thead>
            <tbody>
              ${allPlayers.length === 0 ? '<tr><td colspan="4" class="analytics-empty">No players registered yet.</td></tr>' : allPlayers.map(player => `
                <tr>
                  <td><strong>${escapeHtml(player.discord_tag)}</strong></td>
                  <td><small class="muted">${escapeHtml(player.discord_id)}</small></td>
                  <td><span class="analytics-badge ${player.role === 'admin' ? 'primary' : ''}">${player.role === 'admin' ? 'Admin (DM)' : 'Player'}</span></td>
                  <td>
                    <form method="POST" action="/admin/players/set-access" class="player-credentials-form">
                      <input type="hidden" name="player_id" value="${player.id}">
                      <input type="password" name="password" placeholder="${player.has_password ? 'New Password' : 'Set Password'}" aria-label="Set password for ${escapeHtml(player.discord_tag)}" autocomplete="new-password" minlength="4" required>
                      <select name="role" aria-label="Role for ${escapeHtml(player.discord_tag)}">
                        <option value="player" ${player.role !== 'admin' ? 'selected' : ''}>Player</option>
                        <option value="admin" ${player.role === 'admin' ? 'selected' : ''}>Admin (DM)</option>
                      </select>
                      <button type="submit" class="btn btn-small btn-gold">Save</button>
                    </form>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    contentHtml = `${playersSubnavHtml}${playerView === 'accounts' ? accountAccessHtml : rosterHtml}`;
  }

  // Główny layout HTML
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Grimbold Admin Panel</title>
      ${currentTab === 'analytics' ? '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>' : ''}
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
        .shop-modal:not([hidden]) { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, 0.72); }
        .shop-modal[hidden] { display: none; }
        .shop-modal-card { width: min(460px, 100%); max-height: 90vh; overflow: auto; margin: 0; }
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
        .analytics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-bottom: 20px; }
        .analytics-card { min-width: 0; margin-bottom: 0; }
        .analytics-card-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid #3b3e45; }
        .analytics-chart-wrap { position: relative; width: 100%; max-width: 520px; height: 300px; margin: 12px auto 0; }
        .analytics-chart-wrap canvas { max-height: 280px; max-width: 100%; }
        .analytics-dice { margin-bottom: 20px; }
        .analytics-dice-stats { display: flex; flex-wrap: wrap; gap: 6px; }
        .analytics-badge.dice-success { background: #10b981; }
        .analytics-dice-chart-wrap { position: relative; width: 100%; height: 260px; margin-top: 14px; }
        .player-self { background: rgba(245, 158, 11, 0.12); }
        .character-sheet-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
        .character-sheet { margin: 0; }
        .character-sheet-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .character-sheet-header h3 { margin: 0; }
        .character-sheet-details { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
        .character-sheet-details div { min-width: 0; }
        .character-sheet-details dt { color: #949ba4; font-size: 12px; }
        .character-sheet-details dd { margin: 4px 0 0; font-weight: bold; overflow-wrap: anywhere; }
        .character-sheet h4 { margin: 12px 0 6px; color: #d4af37; }
        .character-sheet-classes { margin: 0; padding-left: 20px; }
        .character-sheet-classes li { padding: 3px 0; }
        .character-editor { display: grid; gap: 12px; margin-top: 14px; }
        .character-editor label { display: grid; gap: 5px; }
        .character-editor input, .character-editor select { width: 100%; }
        .character-editor-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .character-creation-abilities { display: grid; gap: 10px; padding: 14px; border: 1px solid #3f4147; border-radius: 8px; background: #1e1f22; }
        .character-creation-abilities h4, .character-creation-abilities h5 { margin: 0; color: #f1c40f; }
        .character-creation-abilities > label { display: grid; gap: 5px; }
        .character-creation-score-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
        .character-creation-score-grid label { display: grid; gap: 4px; color: #949ba4; font-size: 11px; }
        .character-creation-score-grid input, .character-creation-score-grid select { min-width: 0; width: 100%; }
        .character-sheet-actions { margin-top: 14px; }
        #character-creator-view[hidden] { display: none; }
        .species-traits { margin-top: 10px; padding: 10px; background: #232428; border-radius: 4px; font-size: 12px; }
        .species-traits p { margin: 5px 0; }
        .species-traits ul { margin: 6px 0 0; padding-left: 18px; }
        .species-traits li { padding: 3px 0; }
        .character-creator { display: grid; gap: 14px; margin-top: 14px; }
        .creator-field { display: grid; gap: 5px; }
        .creator-field select, .creator-field input { width: 100%; }
        .creator-section { display: grid; gap: 10px; padding: 14px; border: 1px solid #3f4147; border-radius: 8px; background: #1e1f22; }
        .creator-section h4 { margin: 0; color: #f1c40f; }
        .creator-section h5 { margin: 6px 0 4px; color: #dbdee1; }
        .creator-section p { margin: 0; }
        .creator-section-body { display: grid; gap: 10px; }
        .creator-choice { display: grid; gap: 6px; }
        .creator-choice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 4px 12px; }
        .creator-check { display: flex; align-items: baseline; gap: 6px; font-size: 13px; }
        .creator-check.is-locked { color: #949ba4; }
        .creator-equipment { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; }
        .creator-subchoice { display: grid; gap: 8px; padding-left: 10px; border-left: 2px solid #3f4147; }
        .creator-score { display: grid; gap: 4px; justify-items: stretch; text-align: center; color: #949ba4; font-size: 11px; }
        .creator-score input, .creator-score select { min-width: 0; width: 100%; }
        .creator-final-score { color: #dbdee1; font-size: 13px; }
        .creator-summary { padding: 10px; background: #232428; border-radius: 4px; font-size: 13px; }
        .creator-summary-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
        .character-sheet-full { max-width: 1200px; margin: 0 auto; color: #dbdee1; }
        .sheet-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; border-bottom: 2px solid #3f4147; padding-bottom: 14px; margin-bottom: 12px; }
        .sheet-identity { min-width: 0; flex: 1; }
        .sheet-identity h2 { margin: 0; color: #f2f3f5; }
        .sheet-identity > span { display: block; color: #949ba4; font-size: 13px; margin: 3px 0 12px; }
        .sheet-identity-fields { display: grid; grid-template-columns: 1.2fr repeat(3, minmax(130px, 1fr)); gap: 10px; }
        .sheet-identity-fields label, .sheet-vitals label { display: grid; gap: 5px; color: #949ba4; font-size: 12px; }
        .sheet-header-actions { display: flex; gap: 10px; align-items: center; }
        .btn-secondary { background: #4e5058; color: #fff; }
        .btn-success { background: #23a55a; color: #fff; font-weight: bold; }
        .sheet-message { min-height: 20px; margin: 0 0 10px; color: #23a55a; font-size: 13px; }
        .sheet-message.is-error { color: #f23f43; }
        .sheet-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
        .sheet-col { display: grid; gap: 14px; min-width: 0; }
        .sheet-card { min-width: 0; background: #1e1f22; border: 1px solid #3f4147; border-radius: 8px; padding: 12px; }
        .sheet-card h4 { margin: 0 0 10px; color: #f1c40f; text-transform: uppercase; font-size: 12px; }
        .point-buy-card { max-width: 850px; margin: 0 auto 16px; padding: 20px; }
        .point-buy-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid #3f4147; padding-bottom: 12px; margin-bottom: 16px; }
        .point-buy-header h3 { margin: 0; color: #f2f3f5; }
        .point-buy-header > div:first-child > span { color: #949ba4; font-size: 12px; }
        .point-buy-total { display: grid; grid-template-columns: auto auto; align-items: baseline; column-gap: 4px; text-align: right; }
        .point-buy-total > span { grid-column: 1 / -1; color: #949ba4; font-size: 10px; }
        .point-buy-total strong { color: #f1c40f; font-size: 28px; }
        .point-buy-total small { color: #6b7280; font-size: 15px; }
        .point-buy-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .point-buy-origin { margin-top: 18px; padding: 14px; background: #2b2d31; border: 1px solid #3f4147; border-radius: 8px; }
        .point-buy-origin h4 { margin: 0 0 8px; color: #f1c40f; font-size: 13px; }
        .point-buy-origin p { margin: 0 0 12px; color: #949ba4; font-size: 12px; }
        .point-buy-bonus-options { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
        .point-buy-bonus-options label { display: grid; flex: 1 1 170px; gap: 4px; color: #949ba4; font-size: 11px; }
        .point-buy-bonus-options select { width: 100%; min-width: 0; padding: 6px; }
        .point-buy-bonus-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
        .point-buy-bonus-select { display: grid; gap: 4px; color: #949ba4; text-align: center; font-size: 11px; }
        .point-buy-bonus-select select { width: 100%; padding: 5px; background: #1e1f22; border: 1px solid #3f4147; border-radius: 4px; color: #fff; }
        .point-buy-bonus-select select:disabled { opacity: .45; }
        .point-buy-bonus-choice { min-height: 38px; border: 1px solid #4a4d55; border-radius: 5px; background: #1e1f22; color: #dbdee1; cursor: pointer; }
        .point-buy-bonus-choice.selected { border-color: #f1c40f; background: rgba(241, 196, 15, .15); color: #f1c40f; font-weight: bold; }
        .point-buy-bonus-choice:disabled { opacity: .4; cursor: not-allowed; }
        .point-buy-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
        .btn-primary { background: #5865f2; color: #fff; font-weight: 600; }
        .point-buy-error { min-height: 16px; }
        .point-buy-error.is-error { color: #f23f43; }
        .point-buy-total[hidden], .point-buy-origin[hidden], .point-buy-error[hidden] { display: none; }
        .sheet-abilities { display: grid; gap: 8px; }
        .sheet-ability { display: grid; grid-template-columns: minmax(40px, 1fr) minmax(70px, 110px) 36px; gap: 8px; align-items: center; background: #232428; border: 1px solid #3f4147; border-radius: 6px; padding: 9px; }
        .sheet-ability strong { color: #f1c40f; font-size: 13px; }
        .sheet-ability input { width: 100%; padding: 5px; text-align: center; font-weight: bold; }
        .sheet-ability-final { color: #dbdee1; text-align: center; font-weight: bold; }
        .sheet-ability-modifier { text-align: center; color: #f2f3f5; font-weight: bold; }
        .sheet-check-list { display: grid; gap: 5px; }
        .sheet-check-row { display: grid; grid-template-columns: 18px 1fr auto; gap: 7px; align-items: center; min-height: 24px; font-size: 13px; }
        .sheet-check-row input { width: 15px; height: 15px; accent-color: #d4af37; }
        .sheet-check-row small { color: #949ba4; }
        .sheet-check-row.is-automatic-proficiency { color: #f1c40f; }
        .sheet-species-skill-choice { display: grid; gap: 6px; margin: 8px 0; color: #949ba4; font-size: 12px; }
        .sheet-auto-features { max-height: 320px; overflow: auto; margin-bottom: 10px; }
        .sheet-auto-features ul { margin: 0; padding-left: 18px; }
        .sheet-auto-features li { padding: 3px 0; font-size: 12px; line-height: 1.45; }
        .sheet-notes-label { display: grid; gap: 5px; color: #949ba4; font-size: 12px; }
        .sheet-combat-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .sheet-stat { display: grid; gap: 5px; align-content: center; min-width: 0; background: #1e1f22; border: 1px solid #3f4147; border-radius: 8px; padding: 9px 6px; text-align: center; }
        .sheet-stat span { color: #949ba4; text-transform: uppercase; font-size: 10px; }
        .sheet-stat input { width: 100%; min-width: 0; padding: 3px; border: 0; background: transparent; color: #fff; text-align: center; font-size: 18px; font-weight: bold; }
        .sheet-stat strong { color: #f1c40f; font-size: 18px; }
        .sheet-vitals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .sheet-vitals input, .sheet-card textarea { width: 100%; min-width: 0; padding: 7px; background: #2b2d31; border: 1px solid #3f4147; border-radius: 4px; color: #dbdee1; }
        .sheet-vitals input { text-align: center; font-size: 16px; font-weight: bold; }
        .sheet-section-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
        .sheet-section-heading h4 { margin: 0; }
        .sheet-table-wrap { overflow-x: auto; }
        .sheet-attacks { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 12px; }
        .sheet-attacks th { color: #949ba4; text-align: left; border-bottom: 1px solid #3f4147; }
        .sheet-attacks td, .sheet-attacks th { padding: 5px 4px; }
        .sheet-attacks input { width: 100%; min-width: 70px; padding: 5px; }
        .sheet-remove-attack { padding: 4px 7px; }
        .sheet-skills { max-height: 440px; overflow-y: auto; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .player-subtabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid #3b3e45; }
        .player-subtabs a { padding: 8px 12px; color: #dbdee1; text-decoration: none; border-bottom: 2px solid transparent; }
        .player-subtabs a.active { color: #d4af37; border-bottom-color: #d4af37; font-weight: bold; }
        .player-credentials-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
        .player-credentials-form input { min-width: 160px; flex: 1 1 200px; }
        .player-credentials-form select { min-width: 110px; }
        .metric-toggle { display: inline-flex; gap: 4px; }
        .metric-toggle input { position: absolute; opacity: 0; pointer-events: none; }
        .metric-toggle label { border: 1px solid #d4af37; color: #d4af37; padding: 5px 9px; cursor: pointer; font-size: 12px; }
        .metric-toggle label:first-of-type { border-radius: 4px 0 0 4px; }
        .metric-toggle label:last-of-type { border-radius: 0 4px 4px 0; }
        .metric-toggle input:checked + label { background: #d4af37; color: #1e1f22; }
        .metric-toggle input:focus-visible + label { outline: 2px solid #fff; outline-offset: 2px; }
        .analytics-breakdown { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; padding-top: 14px; }
        .analytics-breakdown h4 { color: #d4af37; font-size: 12px; text-transform: uppercase; margin: 0 0 8px; }
        .analytics-list { list-style: none; padding: 0; margin: 0; }
        .analytics-list li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 8px; border-bottom: 1px solid #3b3e45; font-size: 13px; }
        .analytics-class-list { max-height: 210px; overflow-y: auto; }
        .analytics-badge { display: inline-block; border-radius: 4px; background: #4e5058; color: #fff; padding: 3px 7px; font-size: 12px; white-space: nowrap; }
        .analytics-badge.primary { background: #5865f2; }
        .analytics-badge.fallen { background: #f23f43; }
        .analytics-graveyard { padding: 0; overflow: hidden; }
        .analytics-graveyard > .analytics-card-header { padding: 14px 18px; background: #232428; color: #f23f43; }
        .analytics-table-wrap { overflow-x: auto; }
        .analytics-table-wrap table { margin: 0; }
        .analytics-empty { text-align: center; color: #949ba4; font-style: italic; padding: 24px; }
        .muted { color: #949ba4; }
        .small { font-size: 12px; }
        .gold { color: #d4af37; }
        .italic { font-style: italic; }
        @media (max-width: 760px) {
          .adventure-layout { grid-template-columns: minmax(0, 1fr); }
          .analytics-grid { grid-template-columns: minmax(0, 1fr); }
          .character-editor-fields { grid-template-columns: minmax(0, 1fr); }
          .character-creation-score-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .creator-summary-grid, .creator-choice-grid { grid-template-columns: minmax(0, 1fr); }
          .sheet-layout { grid-template-columns: minmax(0, 1fr); }
          .sheet-identity-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .point-buy-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .point-buy-bonus-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 480px) {
          .analytics-breakdown { grid-template-columns: minmax(0, 1fr); }
          .sheet-header { flex-direction: column; }
          .sheet-header-actions { width: 100%; }
          .sheet-header-actions > * { flex: 1; text-align: center; }
          .sheet-combat-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .sheet-vitals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .point-buy-card { padding: 12px; }
          .point-buy-header { align-items: flex-start; }
          .point-buy-header > div:first-child > span { display: block; }
          .point-buy-actions { flex-wrap: wrap; }
          .point-buy-actions button { flex: 1; }
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
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="small">${escapeHtml(currentUser.discord_tag)} (${escapeHtml(currentUser.role)})</span>
            <a href="/logout" class="btn btn-small">Logout</a>
          </div>
        </div>
        ${statusBanner}
        <div class="tabs">
          ${visibleTabs.map(tab => `<a href="/admin?tab=${tab}" class="tab-btn ${currentTab === tab ? 'active' : ''}">${tabLabels[tab]}</a>`).join('')}
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