// views/tabs/restock.js — "restock" tab of the admin panel.

'use strict';

const db = require('../../db');

module.exports = function renderRestockTab(ctx) {
  const { rolls } = ctx;
  let contentHtml = '';
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
  return contentHtml;
};
