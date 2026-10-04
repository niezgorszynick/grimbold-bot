// currency.js — obsługa przeliczania i formatowania walut D&D 5e
function parsePriceToCp(raw) {
  if (!raw && raw !== 0) return 100;
  const clean = String(raw).replace(/GP/i, '').replace(/,/g, '').trim();
  const val = parseFloat(clean);
  if (isNaN(val) || val < 0) return 100;
  return Math.max(1, Math.round(val * 100));
}

function formatCp(totalCp) {
  const cpVal = parseInt(totalCp, 10);
  if (isNaN(cpVal) || cpVal <= 0) return '0 cp';

  const gp = Math.floor(cpVal / 100);
  const remSp = cpVal % 100;
  const sp = Math.floor(remSp / 10);
  const cp = remSp % 10;

  const parts = [];
  if (gp > 0) parts.push(`${gp} gp`);
  if (sp > 0) parts.push(`${sp} sp`);
  if (cp > 0) parts.push(`${cp} cp`);

  return parts.length > 0 ? parts.join(', ') : '0 cp';
}

module.exports = { parsePriceToCp, formatCp };