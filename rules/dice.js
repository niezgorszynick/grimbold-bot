// rules/dice.js — Dice formulas ("1d20+5", "2d6+1d8+3", "4d6kh3") rolled with
// a cryptographically random source, with advantage/disadvantage on d20 rolls
// and doubled dice for critical hits.

const crypto = require('crypto');

const MAX_DICE = 50;
const MAX_SIDES = 1000;
const MAX_TERMS = 20;

const defaultRng = sides => crypto.randomInt(1, sides + 1);

// "2d6+1d4-1" → [{ sign: 1, count: 2, sides: 6 }, { sign: 1, count: 1, sides: 4 }, { sign: -1, flat: 1 }]
function parseFormula(formula) {
  const text = String(formula || '').replace(/\s+/g, '').toLowerCase();
  if (!text || text.length > 120) throw new Error('Enter a dice formula such as 1d20+5 or 2d6+3.');
  const terms = [];
  const pattern = /([+-]?)(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?|(\d+))/gy;
  let match;
  let position = 0;
  while (position < text.length) {
    pattern.lastIndex = position;
    match = pattern.exec(text);
    if (!match || match.index !== position || match[0] === '') throw new Error(`Can't read the dice formula "${formula}".`);
    if (terms.length && !match[1]) throw new Error(`Can't read the dice formula "${formula}".`);
    const sign = match[1] === '-' ? -1 : 1;
    if (match[3] !== undefined) {
      const count = match[2] === '' ? 1 : Number(match[2]);
      const sides = Number(match[3]);
      if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) throw new Error('Dice must be 1–50 dice of 2–1000 sides.');
      const term = { sign, count, sides };
      if (match[4]) {
        term.keep = match[4] === 'kh' ? 'highest' : 'lowest';
        term.keepCount = Number(match[5]);
        if (term.keepCount < 1 || term.keepCount > count) throw new Error('Keep fewer dice than you roll.');
      }
      terms.push(term);
    } else {
      terms.push({ sign, flat: Number(match[6]) });
    }
    position = pattern.lastIndex;
    if (terms.length > MAX_TERMS) throw new Error('That formula has too many parts.');
  }
  return terms;
}

function formatTerms(terms) {
  return terms.map((term, index) => {
    const sign = term.sign < 0 ? '-' : (index ? '+' : '');
    if (term.flat !== undefined) return `${sign}${term.flat}`;
    return `${sign}${term.count}d${term.sides}${term.keep ? `${term.keep === 'highest' ? 'kh' : 'kl'}${term.keepCount}` : ''}`;
  }).join('');
}

// options.mode: 'advantage' | 'disadvantage' turns the first lone d20 into
// 2d20 keep highest/lowest. options.critical doubles the number of dice.
function rollFormula(formula, { mode = 'normal', critical = false, rng = defaultRng } = {}) {
  let terms = parseFormula(formula);
  if (critical) terms = terms.map(term => (term.sides ? { ...term, count: Math.min(MAX_DICE, term.count * 2), keepCount: term.keepCount ? term.keepCount * 2 : undefined } : term));
  if (mode === 'advantage' || mode === 'disadvantage') {
    const index = terms.findIndex(term => term.sides === 20 && term.count === 1 && !term.keep);
    if (index >= 0) terms[index] = { ...terms[index], count: 2, keep: mode === 'advantage' ? 'highest' : 'lowest', keepCount: 1 };
  }
  let total = 0;
  const parts = terms.map(term => {
    if (term.flat !== undefined) {
      total += term.sign * term.flat;
      return { flat: term.sign * term.flat };
    }
    const rolls = Array.from({ length: term.count }, () => rng(term.sides));
    let kept = rolls.map((value, index) => index);
    if (term.keep) {
      kept = rolls.map((value, index) => ({ value, index }))
        .sort((a, b) => (term.keep === 'highest' ? b.value - a.value : a.value - b.value))
        .slice(0, term.keepCount).map(entry => entry.index);
    }
    const sum = kept.reduce((acc, index) => acc + rolls[index], 0);
    total += term.sign * sum;
    return { dice: `${term.count}d${term.sides}`, sign: term.sign, rolls, kept, sum };
  });
  // A natural 20 or 1 on the kept d20 of a d20 roll.
  const d20 = parts.find(part => part.dice === '1d20' || part.dice === '2d20');
  const natural = d20 ? d20.rolls[d20.kept[0]] : null;
  return { formula: formatTerms(terms), total, parts, natural };
}

// "d20 [13, 7] + 5" style text for logs and notifications.
function describeRoll(result) {
  return result.parts.map((part, index) => {
    if (part.flat !== undefined) return `${part.flat < 0 ? '−' : (index ? '+' : '')} ${Math.abs(part.flat)}`.trim();
    const shown = part.rolls.map((value, i) => (part.kept.includes(i) ? String(value) : `~~${value}~~`)).join(', ');
    return `${part.sign < 0 ? '− ' : (index ? '+ ' : '')}${part.dice} [${shown}]`;
  }).join(' ');
}

module.exports = { parseFormula, rollFormula, describeRoll, formatDiceTerms: formatTerms };
