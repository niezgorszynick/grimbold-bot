// public/sheet-debug.js — Debug mode on the character sheet (🐞 Debug in the
// header, remembered in this browser). When on:
//   • every roll shows how it is calculated under the result (public/dice.js
//     reads window.grimboldDebug);
//   • a card lists every roll the character has, with what adds up to it;
//   • numbers on the sheet that differ from what the roll uses are outlined
//     in red (the sheet works its numbers out in the browser, the rolls on
//     the server: a difference means one of them misses a rule).

(function () {
  const KEY = 'grimbold-sheet-debug';
  const toggle = document.getElementById('cs_debug');
  const panel = document.getElementById('cs_debug_panel');
  const sheet = document.querySelector('[data-roll-character]');
  let enabled = false;
  try { enabled = localStorage.getItem(KEY) === '1'; } catch (error) { /* off */ }
  window.grimboldDebug = () => enabled;
  if (!toggle || !panel || !sheet) return;
  const characterId = sheet.dataset.rollCharacter;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  // The bonus of a d20 formula ("1d20+5+1d4" → 5), or null for other rolls.
  function d20Bonus(formula) {
    const match = String(formula || '').match(/^1d20([+-]\d+)?/);
    return match ? (match[1] ? Number(match[1]) : 0) : null;
  }
  // A number shown on the sheet ("+3", "−1", "3"), or null.
  function shownNumber(node) {
    const text = String(node.value !== undefined && node.tagName === 'INPUT' ? node.value : node.textContent).trim().replace('−', '-');
    return /^[+-]?\d+$/.test(text) ? Number(text) : null;
  }

  function clearMarks() {
    sheet.querySelectorAll('[data-debug-mismatch]').forEach(node => {
      node.removeAttribute('data-debug-mismatch');
      if (node.dataset.debugTitle !== undefined) { node.title = node.dataset.debugTitle; delete node.dataset.debugTitle; }
    });
  }

  async function check() {
    clearMarks();
    panel.replaceChildren(el('h4', { text: '🐞 Debug: how each roll is calculated' }), el('p', { className: 'muted small', text: 'Loading…' }));
    let rolls;
    try {
      const response = await fetch('/api/characters/' + characterId + '/roll-options', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load the rolls.');
      rolls = data.rolls;
    } catch (error) {
      panel.replaceChildren(el('h4', { text: '🐞 Debug' }), el('p', { className: 'sheet-message is-error', text: error.message }));
      return;
    }
    const byId = new Map(rolls.map(roll => [roll.id, roll]));
    // Compare what the sheet shows with the roll behind it. Ability boxes show
    // the modifier (a check may add more), so they are not compared.
    const mismatches = new Map();
    sheet.querySelectorAll('[data-roll]').forEach(node => {
      const roll = byId.get(node.dataset.roll);
      if (!roll || node.dataset.roll.startsWith('check:')) return;
      const expected = d20Bonus(roll.formula);
      const shown = shownNumber(node);
      if (expected === null || shown === null || expected === shown) return;
      mismatches.set(roll.id, { shown, expected });
      node.setAttribute('data-debug-mismatch', '');
      node.dataset.debugTitle = node.title || '';
      node.title = 'Debug: the sheet shows ' + (shown >= 0 ? '+' : '') + shown + ', the roll uses ' + (expected >= 0 ? '+' : '') + expected +
        (roll.breakdown ? '\n' + roll.breakdown : '');
    });
    // Initiative is a box, not a roll link.
    const initiativeBox = document.getElementById('cs_initiative');
    const initiative = byId.get('initiative');
    if (initiativeBox && initiative && shownNumber(initiativeBox) !== null && shownNumber(initiativeBox) !== d20Bonus(initiative.formula)) {
      mismatches.set('initiative', { shown: shownNumber(initiativeBox), expected: d20Bonus(initiative.formula) });
      initiativeBox.setAttribute('data-debug-mismatch', '');
    }
    const summary = mismatches.size
      ? el('p', { className: 'sheet-message is-error sheet-debug-summary', text: '⚠️ ' + mismatches.size + ' number' + (mismatches.size === 1 ? '' : 's') +
        ' on the sheet differ from what the roll uses (outlined in red). If you changed the sheet, save it and re-check; otherwise one of them misses a rule.' })
      : el('p', { className: 'muted small sheet-debug-summary', text: '✅ Every number on the sheet matches its roll.' });
    const rows = rolls.map(roll => {
      const mismatch = mismatches.get(roll.id);
      const marks = [
        roll.advantage && roll.advantage.length ? 'Advantage: ' + roll.advantage.join(', ') : null,
        roll.disadvantage && roll.disadvantage.length ? 'Disadvantage: ' + roll.disadvantage.join(', ') : null,
        mismatch ? 'Sheet shows ' + (mismatch.shown >= 0 ? '+' : '') + mismatch.shown : null
      ].filter(Boolean).join(' · ');
      return el('tr', { className: mismatch ? 'is-mismatch' : null }, [
        el('td', { text: roll.label }),
        el('td', {}, [el('code', { text: roll.breakdown || roll.formula })]),
        el('td', { className: 'muted', text: marks })
      ]);
    });
    panel.replaceChildren(
      el('h4', { text: '🐞 Debug: how each roll is calculated' }),
      summary,
      el('p', { className: 'muted small' }, ['Rolls use the saved sheet. ',
        el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Re-check', onclick: check })]),
      el('details', {}, [el('summary', { className: 'small', text: 'Every roll (' + rolls.length + ')' }),
        el('table', { className: 'sheet-debug-table' }, [
          el('thead', {}, el('tr', {}, [el('th', { text: 'Roll' }), el('th', { text: 'How it adds up' }), el('th', { text: '' })])),
          el('tbody', {}, rows)
        ])])
    );
  }

  let timer = null;
  function schedule(delay) {
    if (!enabled) return;
    clearTimeout(timer);
    timer = setTimeout(check, delay);
  }

  function apply() {
    toggle.checked = enabled;
    panel.hidden = !enabled;
    if (enabled) schedule(0); else clearMarks();
  }
  toggle.addEventListener('change', () => {
    enabled = toggle.checked;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (error) { /* this page only */ }
    apply();
  });
  // The sheet fills itself in after loading: compare once it has.
  if (enabled) {
    toggle.checked = true;
    panel.hidden = false;
    window.addEventListener('load', () => schedule(1500));
  }
  // After a save the numbers may change on both sides.
  const save = document.getElementById('cs_save');
  if (save) save.addEventListener('click', () => schedule(2500));
})();
