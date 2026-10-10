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
        .tag.gold { background: #d4af37; color: #1e1f22; }
        .levelup { border: 1px solid #d4af37; margin-bottom: 14px; }
        .levelup-banner { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; }
        .levelup-banner strong { color: #f1c40f; }
        .levelup-wizard { display: grid; gap: 12px; }
        .levelup-wizard h4 { margin: 0; color: #f1c40f; }
        .levelup-wizard select { width: 100%; }
        .levelup-details { display: grid; gap: 10px; }
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
        .sheet-identity-fields label { display: grid; gap: 5px; color: #949ba4; font-size: 12px; }
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
        .character-sheet-full input:disabled, .character-sheet-full select:disabled { opacity: 0.6; cursor: not-allowed; }
        .sheet-card textarea { width: 100%; min-width: 0; padding: 7px; background: #2b2d31; border: 1px solid #3f4147; border-radius: 4px; color: #dbdee1; }
        .vitals { display: grid; gap: 12px; }
        .vitals.is-busy { opacity: 0.6; pointer-events: none; }
        .vitals input[type=number], .vitals select { width: 90px; padding: 5px; background: #2b2d31; border: 1px solid #3f4147; border-radius: 4px; color: #dbdee1; }
        .vitals h5 { margin: 0 0 4px; color: #dbdee1; }
        .vitals p { margin: 0; }
        .vitals-hp-numbers { display: flex; align-items: baseline; gap: 6px; }
        .vitals-hp-current { font-size: 28px; color: #23a55a; }
        .vitals-hp.is-bloodied .vitals-hp-current { color: #f0b232; }
        .vitals-hp.is-down .vitals-hp-current { color: #f23f43; }
        .vitals-temp { padding: 2px 6px; border-radius: 3px; background: #5865f2; color: #fff; font-size: 12px; font-weight: bold; }
        .vitals-bar { height: 6px; margin: 6px 0 10px; background: #3f4147; border-radius: 3px; overflow: hidden; }
        .vitals-bar span { display: block; height: 100%; background: #23a55a; }
        .vitals-hp.is-bloodied .vitals-bar span { background: #f0b232; }
        .vitals-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
        .vitals-inline { display: inline-flex; align-items: center; gap: 6px; color: #dbdee1; font-size: 13px; }
        .vitals-breakdown { margin-top: 8px; font-size: 12px; color: #949ba4; }
        .vitals-breakdown summary { cursor: pointer; }
        .vitals-dying { padding: 10px; border: 1px solid #f23f43; border-radius: 6px; background: rgba(242, 63, 67, 0.12); }
        .vitals-dying.is-stable { border-color: #949ba4; background: #232428; }
        .vitals-saves { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; }
        .vitals-pips { display: inline-flex; gap: 3px; }
        .vitals-pip { width: 12px; height: 12px; border: 2px solid #949ba4; border-radius: 50%; }
        .vitals-pips.is-success .vitals-pip.is-filled { background: #23a55a; border-color: #23a55a; }
        .vitals-pips.is-failure .vitals-pip.is-filled { background: #f23f43; border-color: #f23f43; }
        .vitals-exhaustion { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .vitals-hitdie, .vitals-slot-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 3px 0; font-size: 13px; }
        .vitals-slot-label { min-width: 120px; }
        .vitals-slot-boxes { display: inline-flex; gap: 4px; }
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
  `;
};
