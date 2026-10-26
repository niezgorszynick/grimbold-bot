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
  'gift-form.js': path.join(__dirname, 'public', 'gift-form.js'),
  'character-combat.js': path.join(__dirname, 'public', 'character-combat.js'),
  'adventure-table.js': path.join(__dirname, 'public', 'adventure-table.js'),
  'dice.js': path.join(__dirname, 'public', 'dice.js'),
  'character-purse.js': path.join(__dirname, 'public', 'character-purse.js'),
  'feature-choices.js': path.join(__dirname, 'public', 'feature-choices.js'),
  'character-features.js': path.join(__dirname, 'public', 'character-features.js'),
  'character-live.js': path.join(__dirname, 'public', 'character-live.js'),
  'sheet-sections.js': path.join(__dirname, 'public', 'sheet-sections.js'),
  'character-proficiencies.js': path.join(__dirname, 'public', 'character-proficiencies.js'),
  'character-wild-shape.js': path.join(__dirname, 'public', 'character-wild-shape.js'),
  'auctions.js': path.join(__dirname, 'public', 'auctions.js')
};
router.get('/assets/:file', (req, res) => {
  const file = Object.hasOwn(ADMIN_ASSETS, req.params.file) ? ADMIN_ASSETS[req.params.file] : null;
  if (!file) return res.status(404).send('Not found');
  return res.sendFile(file);
});



// ─── POST ENDPOINTS: OPERATIONS & DISCORD ───────────────────────────────────

// Restock Engine settings: party level (or worked out from the characters),
// magic items per rarity, scroll case size and price fluctuation.
router.post('/restock-settings', (req, res) => {
  try {
    db.saveRestockConfig({ ...req.body, party_level_auto: req.body.party_level_auto === '1' });
    res.redirect('/admin?tab=restock&status=settings_updated');
  } catch (err) {
    res.redirect(`/admin?tab=restock&err=${encodeURIComponent(err.message)}`);
  }
});

// Artisans and their goods, and weekly shop events (db/artisans.js).
// The handler returns the artisan to keep open (its card folds otherwise).
const artisanRoute = (handler, anchor) => (req, res) => {
  try {
    const open = anchor === 'artisans' ? Number(handler(req.body)) || '' : (handler(req.body), '');
    res.redirect(`/admin?tab=restock&status=settings_updated${open ? `&artisan=${open}` : ''}#${anchor}`);
  } catch (err) {
    res.redirect(`/admin?tab=restock&err=${encodeURIComponent(err.message)}#${anchor}`);
  }
};
router.post('/artisans/save', artisanRoute(body => db.saveArtisan({ ...body, active: body.active === '1' }), 'artisans'));
router.post('/artisans/delete', artisanRoute(body => { db.deleteArtisan(body.id); return null; }, 'artisans'));
router.post('/artisans/goods/save', artisanRoute(body => { db.saveArtisanGood(body); return body.artisan_id; }, 'artisans'));
router.post('/artisans/goods/delete', artisanRoute(body => { db.deleteArtisanGood(body.id); return body.artisan_id; }, 'artisans'));
router.post('/shop-events/save', artisanRoute(body => db.saveShopEvent({ ...body, active: body.active === '1' }), 'shop-events'));
router.post('/shop-events/delete', artisanRoute(body => db.deleteShopEvent(body.id), 'shop-events'));

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
    const { name, category, tier, pp, gp, ep, sp, cp, description, min_level, min_stock, max_stock, rarity, availability } = req.body;

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
      max_stock,
      rarity,
      availability
    });

    res.redirect('/admin?tab=catalog&status=catalog_added');
  } catch (err) {
    res.redirect(`/admin?tab=catalog&err=${encodeURIComponent(err.message)}`);
  }
});

// POST /admin/catalog/update — update a catalog item (price in gp/sp/cp)
router.post('/catalog/update', (req, res) => {
  try {
    const { id, name, category, tier, pp, gp, ep, sp, cp, description, min_level, min_stock, max_stock, rarity, availability } = req.body;

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
      max_stock,
      rarity,
      availability
    });

    res.redirect('/admin?tab=catalog&status=catalog_updated');
  } catch (err) {
    res.redirect(`/admin?tab=catalog&err=${encodeURIComponent(err.message)}`);
  }
});

// POST /admin/catalog/review — apply the suggested rarity, price and
// availability to the ticked catalog rows (ids).
router.post('/catalog/review', (req, res) => {
  try {
    const changed = db.applyCatalogRarityReview(req.body.ids === undefined ? [] : [].concat(req.body.ids));
    res.redirect(`/admin?tab=catalog&status=catalog_reviewed&changed=${changed}`);
  } catch (err) {
    res.redirect(`/admin?tab=catalog&review=1&err=${encodeURIComponent(err.message)}`);
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

// Notable NPCs (admins): create or update, and delete.
router.post('/npcs/save', (req, res) => {
  try {
    const adventureIds = req.body.adventure_ids === undefined ? [] : [].concat(req.body.adventure_ids);
    // A new NPC belongs to the DM who adds it, unless another owner is chosen.
    const id = db.saveNpc({ ...req.body, adventure_ids: adventureIds, created_by: req.session.user.id });
    res.redirect(`/admin?tab=npcs&status=npc_saved#npc-${id}`);
  } catch (err) {
    const back = req.body.id ? `&edit_npc=${encodeURIComponent(req.body.id)}` : '&new_npc=1';
    res.redirect(`/admin?tab=npcs${back}&err=${encodeURIComponent(err.message)}`);
  }
});

router.post('/npcs/delete', (req, res) => {
  db.deleteNpc(req.body.id);
  res.redirect('/admin?tab=npcs&status=npc_deleted');
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

// A monster's statblock for the Monsters tab (DMs only).
router.get('/monsters/statblock', requireAdmin, (req, res) => {
  const monster = require('./rules').getMonster(req.query.name);
  if (!monster) return res.status(404).send('No such monster.');
  return res.send(require('./views/tabs/monsters').monsterPanel(monster));
});

// ─── GET DASHBOARD ROUTE ──────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.send(renderAdminPage(req));
});

module.exports = router;