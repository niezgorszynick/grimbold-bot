// sheets.js — Google Sheets integration (read inventory + write sales log)
//
// Expected sheet layout:
//
//   Sheet "Items"  (A1:F1 = headers, data from row 2)
//     A: Name | B: Description | C: Price (gp) | D: Stock (number or ∞) | E: Category | F: [auto] Status
//
//   Sheet "Sales"  (auto-created headers on first sale)
//     A: Timestamp | B: Item | C: Category | D: Qty | E: Buyer | F: Buyer ID
//     G: Base Price (ea) | H: Discount % | I: Final Price (ea) | J: Total Paid
//
// ⚠️  Service account needs EDITOR access (not just Viewer) to write.

const { google } = require('googleapis');

let sheets;

async function initSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],  // full read+write
  });
  sheets = google.sheets({ version: 'v4', auth });
}

// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * Returns all items from the Items sheet.
 * Each item includes `rowNumber` (1-based spreadsheet row) for targeted writes.
 */
async function getItems() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Items!A2:F',
  });

  const rows = response.data.values || [];
  return rows
    .map((row, idx) => ({
      rowNumber:   idx + 2,                          // row 1 is the header
      name:        (row[0] || '').trim(),
      description: (row[1] || 'No description.').trim(),
      price:       parseInt(row[2]) || 0,
      stock:       (row[3] || '∞').trim(),
      category:    (row[4] || 'General').trim(),
      status:      (row[5] || '').trim(),            // "Sold Out" written by the bot
    }))
    .filter(item => item.name);
}

// ─── WRITE: stock update ──────────────────────────────────────────────────────

/**
 * Decrements stock for a limited-stock item after a purchase.
 * If stock reaches 0, marks the Status column (F) as "Sold Out".
 * Does nothing for ∞-stock items.
 */
async function decrementStock(item, quantity) {
  if (item.stock === '∞') return;

  const currentStock = parseInt(item.stock) || 0;
  const newStock     = Math.max(0, currentStock - quantity);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: process.env.SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `Items!D${item.rowNumber}`, values: [[String(newStock)]] },
        { range: `Items!F${item.rowNumber}`, values: [[newStock === 0 ? 'Sold Out' : '']] },
      ],
    },
  });
}

// ─── WRITE: sales log ─────────────────────────────────────────────────────────

/**
 * Appends a row to the Sales sheet recording the full transaction.
 * Writes the header row automatically if the sheet is empty.
 */
async function logSale({ item, quantity, buyer, buyerId, basePrice, discountPercent, finalPrice }) {
  // Write header if Sales sheet is empty
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sales!A1:A1',
  }).catch(() => ({ data: { values: [] } }));

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'Sales!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Timestamp', 'Item', 'Category', 'Qty', 'Buyer', 'Buyer ID',
                  'Base Price (ea)', 'Discount %', 'Final Price (ea)', 'Total Paid']],
      },
    });
  }

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sales!A:J',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        timestamp, item.name, item.category, quantity,
        buyer, buyerId,
        basePrice, discountPercent, finalPrice, finalPrice * quantity,
      ]],
    },
  });
}

module.exports = { initSheets, getItems, decrementStock, logSale };
