// views/tabs/sales.js — "sales" tab of the admin panel.

'use strict';

const { formatCp } = require('../../currency');
const { escapeHtml } = require('../helpers');

const db = require('../../db');

const GIFT_KINDS = { item: 'From the pack', magic: 'Magic item', shop: 'Bought at the counter' };

module.exports = function renderSalesTab(ctx) {
  const { sales } = ctx;
  const gifts = db.listGifts({ limit: 100 });
  let contentHtml = '';
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
    <div class="card">
      <h3>🎁 Gifts (Last 100)</h3>
      <table>
        <thead>
          <tr>
            <th class="sortable">Date</th>
            <th class="sortable">From</th>
            <th class="sortable">To</th>
            <th class="sortable">Item</th>
            <th class="sortable">Qty</th>
            <th class="sortable">How</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${gifts.length === 0 ? '<tr><td colspan="7">No gifts yet.</td></tr>' : gifts.map(gift => `
            <tr>
              <td data-sort="${escapeHtml(gift.createdAt)}">${escapeHtml(gift.createdAt)}</td>
              <td>${escapeHtml(gift.from.name)}${gift.givenBy ? ` <span class="muted small">(${escapeHtml(gift.givenBy)})</span>` : ''}</td>
              <td>${escapeHtml(gift.to.name)}</td>
              <td><strong>${escapeHtml(gift.item)}</strong></td>
              <td data-sort="${gift.quantity}">${gift.quantity}</td>
              <td>${GIFT_KINDS[gift.kind] || escapeHtml(gift.kind)}${gift.costCp ? ` · ${formatCp(gift.costCp)}` : ''}</td>
              <td class="small">${escapeHtml(gift.note)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  return contentHtml;
};
