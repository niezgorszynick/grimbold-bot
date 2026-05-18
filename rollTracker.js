// rollTracker.js — persists weekly d20 rolls per Discord user in a local JSON file

const fs   = require('fs');
const path = require('path');

const ROLL_FILE = path.join(__dirname, 'rolls.json');

// ─── persistence helpers ──────────────────────────────────────────────────────

function loadRolls() {
  if (!fs.existsSync(ROLL_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ROLL_FILE, 'utf8')); }
  catch { return {}; }
}

function saveRolls(data) {
  fs.writeFileSync(ROLL_FILE, JSON.stringify(data, null, 2));
}

// ─── week key (resets every Monday) ──────────────────────────────────────────

function getWeekKey() {
  const now  = new Date();
  const day  = now.getUTCDay() || 7;           // Sun=0 → treat as 7
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);    // "YYYY-MM-DD" of the Monday
}

// ─── public API ──────────────────────────────────────────────────────────────

function getUserRoll(userId) {
  const rolls  = loadRolls();
  const key    = `${userId}:${getWeekKey()}`;
  return rolls[key] ?? null;    // null = hasn't rolled yet this week
}

function setUserRoll(userId, rollResult) {
  const rolls  = loadRolls();
  const key    = `${userId}:${getWeekKey()}`;
  rolls[key]   = rollResult;
  saveRolls(rolls);
}

// ─── discount table ───────────────────────────────────────────────────────────
// Nat 20 → −20% | 17–19 → −15% | 14–16 → −10% | 11–13 → −5%
// 2–10  →   0%  | Nat 1  → +10% (prices go UP — Grimbold smells blood)
//
// `percent` is the modifier: negative = discount, positive = surcharge.

function getDiscount(roll) {
  if (roll === 20) return { percent: -20, label: '✨ **Natural 20!** Grimbold chokes on his pipe smoke. You haggle like a devil.' };
  if (roll >= 17)  return { percent: -15, label: '🎯 **17–19.** Grimbold sighs and knocks a few coins off the price.' };
  if (roll >= 14)  return { percent: -10, label: '⚔️ **14–16.** A respectable roll. He gives you a grudging nod.' };
  if (roll >= 11)  return { percent:  -5, label: '🎲 **11–13.** Barely enough to squeeze a discount out of the old miser.' };
  if (roll >= 2)   return { percent:   0, label: '😐 **2–10.** Grimbold shrugs. "Standard price, take it or leave it."' };
  /* roll === 1 */ return { percent: +10, label: '💀 **Natural 1!** You somehow make yourself look desperate. Prices go up.' };
}

/**
 * Apply a roll modifier to a base price.
 * modifier.percent is negative for discounts, positive for surcharges.
 * Returns the adjusted price (always at least 1 gp).
 */
function applyModifier(basePrice, modifier) {
  return Math.max(1, Math.round(basePrice * (1 + modifier.percent / 100)));
}

module.exports = { getUserRoll, setUserRoll, getDiscount, applyModifier };
