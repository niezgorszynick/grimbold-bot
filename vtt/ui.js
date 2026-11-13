// vtt/ui.js — Small pieces the Grimbold windows in Owlbear share: building
// elements, and the roll list (Dice window and the popped-out rolls window).

export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'text') node.textContent = value;
    else if (key === 'className') node.className = value;
    else if (key === 'onclick') node.addEventListener('click', value);
    else if (key === 'onsubmit') node.addEventListener('submit', value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  [].concat(children || []).forEach(child => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

// "2d20 [13, ~~7~~] + 5" with dropped dice struck through.
export function detail(text) {
  const span = el('span', { className: 'detail' });
  String(text || '').split(/(~~\d+~~)/).forEach(part => {
    span.append(/^~~\d+~~$/.test(part) ? el('s', { text: part.slice(2, -2) }) : document.createTextNode(part));
  });
  return span;
}

// The roll log, newest first.
export function rollList(log) {
  if (!log.length) return el('p', { className: 'muted', text: 'No rolls yet.' });
  return el('ol', { className: 'rolls' }, log.map(roll => el('li', {
    className: [roll.private ? 'private' : '', roll.natural === 20 ? 'nat20' : roll.natural === 1 ? 'nat1' : '', roll.color ? 'colored' : ''].join(' ').trim(),
    // The roller's dice colour (picked in the panel or the Dice window).
    style: roll.color ? `--dice: ${roll.color.hex}` : null,
    title: roll.color ? `${roll.color.name} dice` : null
  }, [
    el('span', { className: 'total', text: String(roll.total) }),
    el('strong', { text: roll.character }), ' — ', roll.label,
    roll.mode && roll.mode !== 'normal' ? el('span', { className: 'muted', text: ` (${roll.mode})` }) : null,
    roll.private ? el('span', { className: 'muted', text: ' 🔒 GM only' }) : null,
    el('br'), detail(roll.text),
    el('span', { className: 'detail', text: roll.player ? ` · ${roll.player}` : '' })
  ])));
}

// The look of the roll list.
export const ROLLS_CSS = `
  ol.rolls { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  ol.rolls li { padding: 6px 8px; border-radius: 6px; background: rgba(255, 255, 255, .05); }
  ol.rolls li.private { background: rgba(240, 178, 50, .12); }
  .total { font-size: 18px; font-weight: bold; float: right; margin-left: 8px; }
  .nat20 .total { color: #23a55a; }
  .nat1 .total { color: #f23f43; }
  li.colored { border-left: 4px solid var(--dice); }
  li.colored:not(.nat20):not(.nat1) .total { color: var(--dice); }
  .detail { color: #a3a3a3; font-size: 11px; }
  s { opacity: .6; }
`;
