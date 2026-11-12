// rules/height.js — A character's height (Appearance → Height, typed freely)
// in centimetres, for the Lineup tab. Understands "176", "176 cm", "1.76 m",
// "1,76m", "5'9\"", "5′9″", "5 ft 9 in", "5 ft", "69 in" and mixes like
// "175 cm, 5′9″" (the first height found wins). null when it can't tell.

const MIN_CM = 30;
const MAX_CM = 400;

const inRange = cm => (Number.isFinite(cm) && cm >= MIN_CM && cm <= MAX_CM ? Math.round(cm) : null);
const number = text => Number(String(text).replace(',', '.'));

function parseHeightCm(value) {
  const text = String(value || '').toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/''/g, '"').trim();
  if (!text) return null;
  let match = text.match(/(\d+(?:[.,]\d+)?)\s*cm\b/);
  if (match) return inRange(number(match[1]));
  match = text.match(/(\d+(?:[.,]\d+)?)\s*m\b/);
  if (match) return inRange(number(match[1]) * 100);
  // Feet and inches: 5'9", 5' 9, 5 ft 9 in, 5ft, 5 feet 9 inches.
  match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:'|ft\b|feet\b|foot\b)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|in\b|inch(?:es)?\b)?)?/);
  if (match) return inRange(number(match[1]) * 30.48 + (match[2] ? number(match[2]) * 2.54 : 0));
  match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:"|in\b|inch(?:es)?\b)/);
  if (match) return inRange(number(match[1]) * 2.54);
  // A bare number: centimetres (176), metres (1.76) or feet (5.5).
  match = text.match(/^(\d+(?:[.,]\d+)?)$/);
  if (match) {
    const n = number(match[1]);
    if (n >= MIN_CM) return inRange(n);
    if (n < 3) return inRange(n * 100);
    if (n <= 9) return inRange(n * 30.48);
  }
  // Words around a number without a unit ("about 180, lean"): centimetres.
  match = text.match(/\b(\d{2,3}(?:[.,]\d+)?)\b/);
  if (match && number(match[1]) >= MIN_CM) return inRange(number(match[1]));
  return null;
}

// 176 → "5′9″"
function feetAndInches(cm) {
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}′${inches % 12}″`;
}

module.exports = { parseHeightCm, feetAndInches };
