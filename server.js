// server.js — Admin panel routes: authentication, form actions (shop, catalog,
// restock, players, characters, adventures) and the page itself (views/adminPage.js).
const express = require('express');
const path = require('path');
const router = express.Router();
const { REST, Routes, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { coinsToCp } = require('./currency');
const { escapeHtml } = require('./views/helpers');
const renderAdminPage = require('./views/adminPage');
const { loadSessionUser, isAdmin, isRootAdmin } = require('./auth');
const { restockShop } = require('./restock');

// Parse form and JSON bodies
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

function requireAuth(req, res, next) {
  const user = loadSessionUser(req);
  if (!user) {
    req.session = null;
    return res.redirect('/login');
  }
  // Keep the session in step with role or tag changes made by an admin.
  req.session.user = { id: user.id, discord_tag: user.discord_tag, role: user.role };
  return next();
}

function requireAdmin(req, res, next) {
  if (isAdmin(req.session.user)) return next();
  return res.status(403).send('Forbidden: Dungeon Master privileges required.');
}

function requireRootAdmin(req, res, next) {
  if (isRootAdmin(req.session.user)) return next();
  return res.status(403).send('Forbidden: Only the emergency admin can manage account passwords and roles.');
}

router.use(requireAuth);
router.use((req, res, next) => {
  // Every panel form POST is a DM action; players change their characters through /api.
  return req.method === 'POST' ? requireAdmin(req, res, next) : next();
});

// Client scripts for the admin panel (only files listed here are served).
const ADMIN_ASSETS = {
  'character-creator.js': path.join(__dirname, 'public', 'character-creator.js'),
  'character-vitals.js': path.join(__dirname, 'public', 'character-vitals.js'),
  'admin.css': path.join(__dirname, 'public', 'admin.css'),
  'admin-ui.js': path.join(__dirname, 'public', 'admin-ui.js'),
  'character-levelup.js': path.join(__dirname, 'public', 'character-levelup.js'),
  'character-spells.js': path.join(__dirname, 'public', 'character-spells.js'),
  'character-magic-items.js': path.join(__dirname, 'public', 'character-magic-items.js'),
  'character-inventory.js': path.join(__dirname, 'public', 'character-inventory.js'),
  'character-combat.js': path.join(__dirname, 'public', 'character-combat.js'),
  'adventure-table.js': path.join(__dirname, 'public', 'adventure-table.js'),
  'dice.js': path.join(__dirname, 'public', 'dice.js'),
  'character-purse.js': path.join(__dirname, 'public', 'character-purse.js')
};
router.get('/assets/:file', (req, res) => {
  const file = Object.hasOwn(ADMIN_ASSETS, req.params.file) ? ADMIN_ASSETS[req.params.file] : null;
  if (!file) return res.status(404).send('Not found');
  return res.sendFile(file);
});



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

// Manual restock from the panel
router.post('/restock', async (req, res) => {
  try {
    await restockShop();
    res.redirect('/admin?tab=items&status=restocked');
  } catch (err) {
    console.error('Manual restock failed:', err);
    res.status(500).send(`Restock failed: ${escapeHtml(err.message)} <br><a href="/admin?tab=items">Back</a>`);
  }
});

// Send a custom message to a Discord channel
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

// POST /admin/adventures/start — open an adventure by hand (no Discord thread)
router.post('/adventures/start', (req, res) => {
  try {
    const id = db.startAdventure({ title: req.body.title, dmPlayerId: req.body.dm_player_id || null });
    res.redirect(`/admin?tab=adventures&table=${id}`);
  } catch (err) {
    res.redirect(`/admin?tab=adventures&err=${encodeURIComponent(err.message)}`);
  }
});

// POST /admin/catalog/add — add a catalog item (price in gp/sp/cp)
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

// POST /admin/catalog/update — update a catalog item (price in gp/sp/cp)
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
      class_allocations,
      death_adventure_id,
      death_dm_player_id,
      death_notes
    } = req.body;
    // The purse comes in gold, silver and copper (or, from older forms, gp).
    const gold_gp = req.body.purse_gp !== undefined || req.body.purse_sp !== undefined || req.body.purse_cp !== undefined
      ? (coinsToCp({ gp: req.body.purse_gp, sp: req.body.purse_sp, cp: req.body.purse_cp }) / 100).toFixed(2)
      : req.body.gold_gp;
    if (req.body.discord_thread !== undefined) db.setCharacterThread(id, req.body.discord_thread);
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
    const updated = db.updateCharacterWithAdventures({
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
    if (updated && updated.goldChange) require('./characterThreads').announceGoldChange(updated.goldChange);
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

// POST: spend 1 DM point on a character
router.post('/players/assign-dm-point', (req, res) => {
  try {
    const { player_id, character_id } = req.body;
    db.assignDmPointToCharacter(parseInt(player_id, 10), parseInt(character_id, 10));
    res.redirect('/admin?tab=players&status=dm_point_assigned');
  } catch (err) {
    res.redirect(`/admin?tab=players&err=${encodeURIComponent(err.message)}`);
  }
});

// POST: record a finished adventure and award XP / DM point
router.post('/adventures/add', (req, res) => {
  try {
    const { title, description, xp_awarded, dm_player_id, dm_character_id, character_ids } = req.body;
    
    // HTML checkboxes send a string (one checked) or an array (several)
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
  res.send(renderAdminPage(req));
});

module.exports = router;