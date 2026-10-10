// currency.js — D&D currency parsing and formatting (stored as copper pieces)
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

// Parses a gold amount typed by a DM (e.g. "12", "12.5", "12.37") into copper.
// Unlike parsePriceToCp this rejects bad input instead of using a default.
function parseGpToCp(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error('Gold must be a non-negative amount with at most two decimal places.');
  }
  const [whole, fraction = ''] = text.split('.');
  const cp = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cp)) throw new Error('Gold amount is too large.');
  return cp;
}

module.exports = { parsePriceToCp, parseGpToCp, formatCp };