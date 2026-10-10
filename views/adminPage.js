// views/adminPage.js — The admin panel page: who is viewing, which tab, the
// status banner, the tab content (views/tabs) and the surrounding layout.

'use strict';

const db = require('../db');
const { getUserRoll, getDiscount } = require('../rollTracker');
const { escapeHtml } = require('./helpers');

const TAB_RENDERERS = {
  'items': require('./tabs/items'),
  'catalog': require('./tabs/catalog'),
  'adventures': require('./tabs/adventures'),
  'restock': require('./tabs/restock'),
  'analytics': require('./tabs/analytics'),
  'sales': require('./tabs/sales'),
  'auctions': require('./tabs/auctions'),
  'character-sheet': require('./tabs/characterSheet'),
  'rolls': require('./tabs/rolls'),
  'players': require('./tabs/players')
};

module.exports = function renderAdminPage(req) {
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
  } else if (status === 'magic_imported') {
    const added = Number(req.query.added) || 0;
    const skipped = Number(req.query.skipped) || 0;
    statusBanner = `<div class="alert green">✅ Imported ${added} magic item${added === 1 ? '' : 's'} into the catalog${skipped ? ` (${skipped} already there, left unchanged)` : ''}.</div>`;
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
    statusBanner = '<div class="alert green">✨ DM point assigned! The character gained 1 XP and their level was recalculated.</div>';
  } else if (status === 'adventure_recorded') {
    statusBanner = '<div class="alert green">⚔️ Adventure recorded! XP awarded to the participants and a DM point to the host.</div>';
  } else if (status === 'adventure_updated') {
    statusBanner = '<div class="alert green">⚔️ Adventure updated and rewards adjusted successfully.</div>';
  }
  
  

  const ctx = {
    // Lets a tab replace the status banner (e.g. a missing record).
    setStatusBanner: html => { statusBanner = html; },
    req, currentUser, isAdmin, isRootAdmin, currentTab, status, partyLevel, catalogItems, activeItems, shopPlayer, shopRoll, shopModifier, sales, rolls
  };
  const renderTab = TAB_RENDERERS[currentTab];
  const contentHtml = renderTab ? renderTab(ctx) : '';

  // Main HTML layout
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Grimbold Admin Panel</title>
      ${currentTab === 'analytics' ? '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>' : ''}
      <link rel="stylesheet" href="/admin/assets/admin.css">
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

      <script src="/admin/assets/admin-ui.js"></script>
    </body>
    </html>
  `;
};
