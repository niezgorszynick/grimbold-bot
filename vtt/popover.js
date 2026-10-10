// vtt/popover.js — The "Grimbold's Dice" window in Owlbear Rodeo: connect
// with the key from the panel, see whether it works, and read the roll log.

import { store, onStoreChange } from './shared.js';

const app = document.getElementById('app');

function el(tag, attrs, children) {
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
function detail(text) {
  const span = el('span', { className: 'detail' });
  String(text || '').split(/(~~\d+~~)/).forEach(part => {
    span.append(/^~~\d+~~$/.test(part) ? el('s', { text: part.slice(2, -2) }) : document.createTextNode(part));
  });
  return span;
}

function keyForm() {
  const input = el('input', { type: 'password', placeholder: 'Paste your key from the panel', autocomplete: 'off', 'aria-label': 'Key' });
  return el('form', {
    onsubmit: event => {
      event.preventDefault();
      if (input.value.trim()) store.setKey(input.value.trim());
      render();
    }
  }, [input, el('button', { type: 'submit', text: 'Connect' })]);
}

function render() {
  const key = store.key();
  const status = store.status();
  const settings = store.settings();
  const parts = [];
  if (!key) {
    parts.push(
      el('p', { text: 'Rolls you make on your character sheet in the Grimbold panel show up here for the whole table.' }),
      el('p', { className: 'muted', text: 'In the panel, open your character sheet → dice bar → "Owlbear key", copy it and paste it here.' }),
      keyForm()
    );
  } else {
    const ok = status && status.ok;
    parts.push(el('div', { className: 'status ' + (ok ? 'ok' : status ? 'bad' : '') }, [
      ok ? `Connected as ${status.player}. Your rolls go to everyone in this room.` : status ? status.error : 'Connecting…'
    ]));
    parts.push(el('div', { className: 'row' }, [
      el('label', {}, [
        Object.assign(el('input', { type: 'checkbox' }), { checked: settings.notify, onchange: event => store.setSettings({ notify: event.target.checked }) }),
        ' Pop-up for each roll'
      ]),
      el('span', {}, [
        el('button', { type: 'button', className: 'secondary', text: 'Clear log', onclick: () => { store.clearLog(); render(); } }), ' ',
        el('button', { type: 'button', className: 'secondary', text: 'Disconnect', onclick: () => { store.setKey(''); render(); } })
      ])
    ]));
  }
  const log = store.log();
  parts.push(log.length
    ? el('ol', {}, log.map(roll => el('li', {
      className: [roll.private ? 'private' : '', roll.natural === 20 ? 'nat20' : roll.natural === 1 ? 'nat1' : ''].join(' ').trim()
    }, [
      el('span', { className: 'total', text: String(roll.total) }),
      el('strong', { text: roll.character }), ' — ', roll.label,
      roll.mode && roll.mode !== 'normal' ? el('span', { className: 'muted', text: ` (${roll.mode})` }) : null,
      roll.private ? el('span', { className: 'muted', text: ' 🔒 GM only' }) : null,
      el('br'), detail(roll.text),
      el('span', { className: 'detail', text: roll.player ? ` · ${roll.player}` : '' })
    ])))
    : el('p', { className: 'muted', text: 'No rolls yet.' }));
  app.replaceChildren(...parts);
}

onStoreChange(render);
render();
