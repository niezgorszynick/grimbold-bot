// views/tabs/restock.js — "Restock Engine" tab: how the weekly restock fills
// Grimbold's shelf (rules in db/restock.js), and a button to run it now.

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

function numberField(name, label, value, hint, { min = 0, max = 20 } = {}) {
  return `
    <label class="restock-field">
      <span>${label}</span>
      <input type="number" name="${name}" min="${min}" max="${max}" value="${escapeHtml(value)}" required>
      <small class="muted">${hint}</small>
    </label>`;
}

module.exports = function renderRestockTab() {
  const cfg = db.readRestockConfig();
  const level = db.restockPartyLevel(cfg);
  const median = db.medianCharacterLevel();
  const shelf = db.prepare('SELECT source, COUNT(*) AS count FROM items GROUP BY source').all();
  const count = source => (shelf.find(row => row.source === source) || {}).count || 0;

  return `
    <div class="restock-layout">
      <div class="card">
        <h3>Weekly Restock</h3>
        <p class="muted small">Every restock fills the shelf in four parts:</p>
        <ul class="restock-rules small">
          <li><strong>Mundane counter</strong> — every mundane item in the Master Catalog (no rarity) up to the party level, always in stock at catalog price.</li>
          <li><strong>Staples</strong> — catalog items with the <em>staple</em> tier (Potion of Healing, rations…): always there, stock rolled weekly.</li>
          <li><strong>Magic vault</strong> — the counts below, drawn from Common / Uncommon items (and Rare from party level 5) that are set to <em>Shop</em>. Each item stays two weeks unless it sells out, so about half changes every week. Adventure-only items never appear.</li>
          <li><strong>Scroll case</strong> — new spell scrolls each week from the whole spell list: two cantrip/level 1, two level 2–3, one level 4+, never above half the party level (rounded up).</li>
        </ul>
        <form method="POST" action="/admin/restock-settings" class="restock-form">
          <h4>Party level</h4>
          <label class="creator-check"><input type="checkbox" name="party_level_auto" value="1" ${cfg.party_level_auto ? 'checked' : ''}> Work it out from the characters (median level of living characters${median ? `: now <strong>${median}</strong>` : ''})</label>
          ${numberField('party_level', 'Party level (when not worked out)', cfg.party_level, 'Gates items by their minimum level.', { min: 1, max: 20 })}
          <h4>Magic vault</h4>
          <div class="restock-grid">
            ${numberField('magic_common_count', 'Common items', cfg.magic_common_count, 'On the shelf at once.')}
            ${numberField('magic_uncommon_count', 'Uncommon items', cfg.magic_uncommon_count, 'On the shelf at once.')}
            ${numberField('magic_rare_count', 'Rare items', cfg.magic_rare_count, 'From party level 5; only Rares a DM opened to the shop.', { max: 10 })}
          </div>
          <h4>Scroll case</h4>
          ${numberField('scroll_count', 'Scrolls per week', cfg.scroll_count, 'Beyond five, the extra scrolls can be of any level up to the cap.')}
          <h4>Price fluctuation (magic items and scrolls)</h4>
          <div class="restock-grid">
            <label class="restock-field"><span>Min multiplier</span><input type="number" step="0.01" min="0.1" name="fluctuation_min" value="${cfg.fluctuation_min}" required><small class="muted">0.85 = up to 15% cheaper</small></label>
            <label class="restock-field"><span>Max multiplier</span><input type="number" step="0.01" min="0.1" name="fluctuation_max" value="${cfg.fluctuation_max}" required><small class="muted">1.15 = up to 15% dearer</small></label>
          </div>
          <button type="submit" class="btn btn-green">Save Restock Settings</button>
        </form>
      </div>

      <div>
        <div class="card">
          <h3>Restock now</h3>
          <p class="muted small">Party level for the next restock: <strong>${level}</strong>${cfg.party_level_auto ? ' (worked out from the characters)' : ''}.</p>
          <p class="muted small">On the shelf now: ${count('mundane')} mundane, ${count('staple')} staples, ${count('magic')} magic, ${count('scroll')} scrolls, ${count('manual')} added by hand${count('legacy') ? `, ${count('legacy')} from the old restock (cleared next time)` : ''}.</p>
          <p class="muted small">Items a DM added by hand stay until they sell out or you delete them.</p>
          <form method="POST" action="/admin/restock" onsubmit="return confirm('Run the weekly restock now and announce it on Discord?');">
            <button type="submit" class="btn btn-gold restock-now">🔄 Run Restock &amp; Announce Now</button>
          </form>
        </div>
      </div>
    </div>
  `;
};
