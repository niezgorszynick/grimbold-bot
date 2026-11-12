// vtt/popover.js — The "Grimbold's Dice" window in Owlbear Rodeo: connect
// with the key from the panel, see whether it works, and read the roll log.
// The GM also sees the running encounter of their adventure and puts its
// creatures into Owlbear's Initiative Tracker, matched to tokens by name.
// A running skill challenge has its own window (vtt/challenge.js); here, a
// line that opens it.

import OBR from 'https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm';
import { store, onStoreChange, matchTokens, putInTracker, tokenName, isToken, linkToken, openChallengeWindow, openWindow } from './shared.js';
import { el, rollList } from './ui.js';

const app = document.getElementById('app');

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

// The tokens selected on the map join the encounter (matched by name on the
// server), each linked to its new combatant.
async function addSelected(encounter) {
  try {
    const selection = (await OBR.player.getSelection()) || [];
    const picked = sceneItems.filter(item => isToken(item) && selection.includes(item.id));
    if (!picked.length) throw new Error('Select the tokens on the map first (drag a box, or Shift-click).');
    const response = await fetch(new URL('/vtt/encounter/' + encounter.id + '/tokens', window.location.origin), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: store.key(), tokens: picked.map(item => ({ id: item.id, name: tokenName(item) })) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'That did not work.');
    for (const entry of data.added) await linkToken(OBR, { tokenId: entry.tokenId, combatantId: entry.combatantId, characterId: entry.characterId });
    encounterState = { ...encounterState, note: [
      data.added.length ? 'Added: ' + data.added.map(entry => entry.label).join(', ') + '.' : '',
      data.skipped.length ? 'Not added: ' + data.skipped.map(entry => '"' + entry.name + '" (' + entry.reason + ')').join('; ') + '.' : ''
    ].filter(Boolean).join(' ') };
    await loadEncounters();
  } catch (error) {
    encounterState = { ...encounterState, note: error.message };
    render();
  }
}

async function chooseToken(entry, tokenId) {
  try {
    await linkToken(OBR, { tokenId: tokenId || null, combatantId: entry.id, characterId: entry.kind === 'pc' ? entry.characterId : null });
    encounterState = { ...encounterState, note: tokenId ? entry.label + ' is linked to its token.' : entry.label + ' has no token now.' };
  } catch (error) {
    encounterState = { ...encounterState, note: 'Could not link the token: ' + error.message };
  }
  render();
}

// One combatant's token: a list of the scene's tokens, each usable once.
function tokenPicker(entry, matches) {
  const takenBy = new Map(matches.filter(other => other.token && other !== entry).map(other => [other.token.id, other.label]));
  const select = el('select', { className: 'token-pick', 'aria-label': 'Token for ' + entry.label, title: entry.token && !entry.linked ? 'Matched by name: pick it to link it for good' : 'The token on the map' }, [
    el('option', { value: '', text: '— no token —' }),
    ...sceneItems.filter(isToken).map(item => el('option', {
      value: item.id,
      text: (tokenName(item) || '(unnamed)') + (takenBy.has(item.id) ? ' · ' + takenBy.get(item.id) : ''),
      disabled: takenBy.has(item.id) ? true : null
    }))
  ]);
  select.value = entry.token ? entry.token.id : '';
  select.onchange = () => chooseToken(entry, select.value);
  return select;
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
        el('span', { className: 'who' }, [entry.label, entry.token ? el('span', { className: 'muted', text: entry.linked ? ' 🔗' : ' (by name)' }) : null]),
        tokenPicker(entry, matches)
      ]))),
      el('p', { className: 'muted', text: '🔗 linked tokens keep working whatever they are called. Pick a token for each, or select tokens on the map and add them:' }),
      el('div', { className: 'row' }, [
        el('button', { type: 'button', className: 'secondary', text: '+ Add selected tokens', title: 'Party members, NPCs and monsters, recognised by their names; each is linked to its token', onclick: () => addSelected(encounter) }),
        el('button', { type: 'button', text: 'Put ' + ready.length + ' into the initiative tracker', disabled: ready.length ? null : true, onclick: () => addToTracker(matches) })
      ]),
      matches.some(entry => entry.initiative === null) ? el('p', { className: 'muted', text: 'Some have no initiative yet: roll it on the adventure table.' }) : null
    ]);
  }), state.note ? el('p', { className: 'muted', text: state.note }) : null]);
}

// A running skill challenge: one line here, the details in its own window.
function challengeLine() {
  const challenges = store.key() ? store.challenges() : [];
  if (!challenges.length) return null;
  return el('div', { className: 'challenge row' }, [
    el('span', {}, ['🎯 ', el('strong', { text: challenges.map(challenge => challenge.name).join(', ') }), ' is running']),
    el('button', { type: 'button', text: 'Open', onclick: () => openChallengeWindow(OBR) })
  ]);
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
  parts.push(challengeLine());
  parts.push(encounterSection());
  if (key) {
    parts.push(el('div', { className: 'row' }, [
      el('strong', { text: 'Rolls' }),
      el('button', {
        type: 'button', className: 'secondary', text: '⧉ Pop out', title: 'The rolls in a window of their own: move it, resize it, shrink it',
        onclick: async () => { store.setRollsOut(true); await openWindow(OBR, 'rolls'); }
      })
    ]));
  }
  parts.push(rollList(store.log()));
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
