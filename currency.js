// currency.js — D&D 5e Currency Conversion & Formatting
// 1 gp = 10 sp = 100 cp

function parsePriceToCp(raw) {
  if (!raw) return 100; // domyślnie 1 gp (100 cp)
  const clean = String(raw).replace(/GP/i, '').replace(/,/g, '').trim();
  const val = parseFloat(clean);
  if (isNaN(val) || val <= 0) return 100;
  return Math.max(1, Math.round(val * 100));
}

function formatCp(totalCp) {
  if (!totalCp || totalCp <= 0) return '0 gp';
  const gp = Math.floor(totalCp / 100);
  const remSp = totalCp % 100;
  const sp = Math.floor(remSp / 10);
  const cp = remSp % 10;

  const parts = [];
  if (gp > 0) parts.push(`${gp} gp`);
  if (sp > 0) parts.push(`${sp} sp`);
  if (cp > 0) parts.push(`${cp} cp`);
  return parts.join(', ');
}

module.exports = { parsePriceToCp, formatCp };