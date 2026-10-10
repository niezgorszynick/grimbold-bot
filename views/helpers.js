// views/helpers.js — Small HTML helpers shared by the admin panel views and routes.

'use strict';

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

module.exports = { escapeHtml, decomposeCp };
