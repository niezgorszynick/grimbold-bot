// views/tabs/sales.js — "sales" tab of the admin panel.

'use strict';

const { formatCp } = require('../../currency');
const { escapeHtml } = require('../helpers');

module.exports = function renderSalesTab(ctx) {
  const { sales } = ctx;
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
  `;
  return contentHtml;
};
