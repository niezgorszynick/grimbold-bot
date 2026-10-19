// vtt/popover.js — The "Grimbold's Dice" window in Owlbear Rodeo: connect
// with the key from the panel, see whether it works, and read the roll log.
// The GM also sees the running encounter of their adventure and puts its
// creatures into Owlbear's Initiative Tracker, matched to tokens by name.

import OBR from 'https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm';
import { store, onStoreChange, matchTokens, putInTracker, tokenName } from './shared.js';

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

// ─── The GM's running encounter ───────────────────────────────────────────
let isGm = false;
let encounterState = { loading: false, error: '', encounters: null, note: '' };
let sceneItems = [];

async function loadEncounters() {
  const key = store.key();
  if (!key || !isGm) return;
  encounterState = { ...encounterState, loading: true, error: '' };
  render();
  try {
    const url = new URL('/vtt/encounter', window.location.origin);
    url.searchParams.set('key', key);
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The panel did not accept the key.');
    encounterState = { ...encounterState, loading: false, encounters: data.encounters };
  } catch (error) {
    encounterState = { ...encounterState, loading: false, error: error.message };
  }
  render();
}

async function addToTracker(matches) {
  const pairs = matches.filter(entry => entry.token && entry.initiative !== null).map(entry => ({ itemId: entry.token.id, initiative: entry.initiative }));
  try {
    await putInTracker(OBR, pairs);
    encounterState = { ...encounterState, note: pairs.length + ' token' + (pairs.length === 1 ? '' : 's') + ' put into the initiative tracker.' };
  } catch (error) {
    encounterState = { ...encounterState, note: 'Could not update the tokens: ' + error.message };
  }
  render();
}

function encounterSection() {
  if (!isGm || !store.key()) return null;
  const state = encounterState;
  const header = el('div', { className: 'row' }, [
    el('strong', { text: '⚔ Encounter' }),
    el('button', { type: 'button', className: 'secondary', text: state.loading ? 'Loading…' : 'Refresh', onclick: loadEncounters })
  ]);
  if (state.error) return el('section', { className: 'encounter' }, [header, el('p', { className: 'muted', text: state.error })]);
  if (!state.encounters) return el('section', { className: 'encounter' }, [header]);
  if (!state.encounters.length) {
    return el('section', { className: 'encounter' }, [header, el('p', { className: 'muted', text: 'No encounter running in your adventures. Run one on the adventure table in the panel.' })]);
  }
  return el('section', { className: 'encounter' }, [header, ...state.encounters.map(encounter => {
    const matches = matchTokens(sceneItems, encounter.combatants);
    const ready = matches.filter(entry => entry.token && entry.initiative !== null);
    return el('div', {}, [
      el('p', { className: 'muted', text: encounter.adventure + ' — ' + encounter.name }),
      el('ul', { className: 'combatants' }, matches.map(entry => el('li', { className: entry.down ? 'down' : '' }, [
        el('span', { className: 'init', text: entry.initiative === null ? '—' : String(entry.initiative) }),
        entry.label,
        el('span', { className: 'muted', text: entry.token
          ? (tokenName(entry.token) !== entry.label ? ' → ' + tokenName(entry.token) : ' ✓')
          : ' · no token named "' + entry.label + '"' + (entry.baseName !== entry.label ? ' or "' + entry.baseName + '"' : '') })
      ]))),
      matches.some(entry => entry.initiative === null) ? el('p', { className: 'muted', text: 'Some have no initiative yet: roll it on the adventure table.' }) : null,
      el('button', { type: 'button', text: 'Put ' + ready.length + ' into the initiative tracker', disabled: ready.length ? null : true, onclick: () => addToTracker(matches) })
    ]);
  }), state.note ? el('p', { className: 'muted', text: state.note }) : null]);
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
      el('span', {}, [
        el('label', {}, [
          Object.assign(el('input', { type: 'checkbox' }), { checked: settings.notify, onchange: event => store.setSettings({ notify: event.target.checked }) }),
          ' Pop-up for each roll'
        ]),
        isGm ? el('label', { title: "Players' initiative rolls set the initiative of the token with their character's name." }, [
          Object.assign(el('input', { type: 'checkbox' }), { checked: settings.tracker, onchange: event => store.setSettings({ tracker: event.target.checked }) }),
          ' Initiative rolls → tracker'
        ]) : null
      ]),
      el('span', {}, [
        el('button', { type: 'button', className: 'secondary', text: 'Clear log', onclick: () => { store.clearLog(); render(); } }), ' ',
        el('button', { type: 'button', className: 'secondary', text: 'Disconnect', onclick: () => { store.setKey(''); render(); } })
      ])
    ]));
  }
  parts.push(encounterSection());
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

onStoreChange(name => { if (name === 'key') loadEncounters(); render(); });
render();
OBR.onReady(async () => {
  isGm = (await OBR.player.getRole()) === 'GM';
  OBR.player.onChange(player => {
    const wasGm = isGm;
    isGm = player.role === 'GM';
    if (isGm && !wasGm) loadEncounters();
    render();
  });
  const refreshItems = items => { sceneItems = items; render(); };
  const watchScene = async ready => {
    if (!ready) return refreshItems([]);
    refreshItems(await OBR.scene.items.getItems());
  };
  OBR.scene.onReadyChange(watchScene);
  OBR.scene.items.onChange(refreshItems);
  watchScene(await OBR.scene.isReady());
  loadEncounters();
});
