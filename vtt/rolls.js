// vtt/rolls.js — The popped-out rolls window of Grimbold's Dice: the same
// roll log as the Dice window, in a window you can move, resize and shrink.

import OBR from 'https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm';
import { store, onStoreChange } from './shared.js';
import { el, rollList } from './ui.js';
import { createFrame } from './frame.js';

const frame = createFrame({ OBR, name: 'rolls', title: '🎲 Rolls', onClose: () => store.setRollsOut(false) });

function render() {
  const log = store.log();
  const last = log[0];
  frame.setSummary(last ? last.character + ' ' + last.total : '');
  frame.body.replaceChildren(
    store.key() ? rollList(log) : el('p', { className: 'muted', text: 'Connect your key in the Dice window first.' }),
    log.length ? el('p', {}, [el('button', { type: 'button', className: 'secondary', text: 'Clear log', onclick: () => { store.clearLog(); render(); } })]) : null
  );
}

onStoreChange(name => { if (name === 'log' || name === 'key') render(); });
render();
