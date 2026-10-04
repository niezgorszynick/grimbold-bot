// currency.js — D&D 5e Currency Helper
function parseToCp({ gp = 0, sp = 0, cp = 0 }) {
  return Math.round(gp * 100 + sp * 10 + cp);
}

function formatCp(totalCp) {
  if (totalCp === 0) return '0 gp';
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

module.exports = { parseToCp, formatCp };