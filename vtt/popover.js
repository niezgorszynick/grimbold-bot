// vtt/popover.js — The "Grimbold's Dice" window in Owlbear Rodeo: connect
// with the key from the panel, see whether it works, and read the roll log.
// The GM also sees the running encounter of their adventure and puts its
// creatures into Owlbear's Initiative Tracker, matched to tokens by name.
// Everyone sees a running skill challenge, rolls on their turn, and the GM
// can act for anyone and rule on turns.

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

// ─── Skill challenges (the running ones this player is in, or DMs) ─────────
const CHALLENGE_SKILLS = ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation',
  'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival'];
let challengeState = { loading: false, error: '', challenges: null, note: '' };
// What was picked in the selects, kept across re-renders: "challengeId:characterId" → { skill, mode }.
const challengePicks = {};

async function loadChallenges() {
  const key = store.key();
  if (!key) return;
  challengeState = { ...challengeState, loading: true, error: '' };
  render();
  try {
    const url = new URL('/vtt/challenges', window.location.origin);
    url.searchParams.set('key', key);
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The panel did not accept the key.');
    challengeState = { ...challengeState, loading: false, challenges: data.challenges };
  } catch (error) {
    challengeState = { ...challengeState, loading: false, error: error.message };
  }
  render();
}

async function challengeAction(challenge, body, note) {
  try {
    const response = await fetch(new URL('/vtt/challenges/' + challenge.adventureId + '/' + challenge.id, window.location.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: store.key(), ...body })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'That did not work.');
    challengeState = { ...challengeState, challenges: data.challenges, note: note || '' };
  } catch (error) {
    challengeState = { ...challengeState, note: error.message };
  }
  render();
}

function tallyLine(challenge) {
  if (challenge.successes === null) return el('p', { className: 'muted', text: 'The DM keeps the tally hidden.' });
  const pips = (filled, total, on) => Array.from({ length: total }, (_, i) => (i < filled ? on : '○')).join('');
  return el('p', {}, [
    el('span', { className: 'pips ok', text: pips(challenge.successes, challenge.successesNeeded, '●') }), ' ' + challenge.successes + '/' + challenge.successesNeeded + '  ',
    el('span', { className: 'pips bad', text: pips(challenge.failures, challenge.failuresAllowed, '✕') }), ' ' + challenge.failures + '/' + challenge.failuresAllowed
  ]);
}

function challengeTurn(challenge, participant) {
  const dm = challenge.dm;
  const allowed = participant.allowedSkills;
  const pickKey = challenge.id + ':' + participant.characterId;
  const pick = challengePicks[pickKey] || (challengePicks[pickKey] = { skill: '', mode: 'normal' });
  const skill = el('select', { 'aria-label': 'Skill' }, [el('option', { value: '', text: '-- Skill --' }),
    ...(dm ? CHALLENGE_SKILLS : allowed).map(name => el('option', { value: name, text: name + (dm && !allowed.includes(name) ? ' (used)' : '') }))]);
  skill.value = pick.skill;
  skill.onchange = () => { pick.skill = skill.value; };
  const mode = el('select', { 'aria-label': 'Mode' }, [['normal', 'Normal'], ['advantage', 'Adv.'], ['disadvantage', 'Disadv.']].map(([value, text]) => el('option', { value, text })));
  mode.value = pick.mode;
  mode.onchange = () => { pick.mode = mode.value; };
  const send = action => {
    if (!skill.value) { challengeState = { ...challengeState, note: 'Choose a skill first.' }; render(); return; }
    const override = dm && !allowed.includes(skill.value);
    if (override && !window.confirm(skill.value + ' was already used. Allow it anyway?')) return;
    pick.skill = '';
    challengeAction(challenge, { action, characterId: participant.characterId, skill: skill.value, mode: mode.value, override },
      action === 'help' ? participant.name + ' helps: the next roll has Advantage.' : '');
  };
  return el('div', { className: 'turn' }, [
    skill, mode,
    el('button', { type: 'button', text: '🎲 Roll', onclick: () => send('check') }),
    el('button', { type: 'button', className: 'secondary', text: '🤝 Help', title: 'The next roller gets Advantage', onclick: () => send('help') }),
    dm && !participant.usedFeature ? el('button', {
      type: 'button', className: 'secondary', text: '✨', title: 'A spell, feature or item counts as a success (once per character)',
      onclick: () => {
        const what = window.prompt('Which spell, feature or item counts as a success for ' + participant.name + '?');
        if (what && what.trim()) challengeAction(challenge, { action: 'feature', characterId: participant.characterId, what }, participant.name + "'s " + what.trim() + ' counts as a success.');
      }
    }) : null
  ]);
}

function challengeSection() {
  if (!store.key()) return null;
  const state = challengeState;
  if (!state.challenges || !state.challenges.length) return state.error ? el('p', { className: 'muted', text: state.error }) : null;
  return el('section', { className: 'challenge' }, [
    el('div', { className: 'row' }, [
      el('strong', { text: '🎯 Skill challenge' }),
      el('button', { type: 'button', className: 'secondary', text: state.loading ? 'Loading…' : 'Refresh', onclick: loadChallenges })
    ]),
    ...state.challenges.map(challenge => {
      const current = challenge.participants.find(participant => participant.turn);
      const over = Boolean(challenge.finishedBy);
      const lastAttempts = challenge.attempts.slice(-4);
      return el('div', {}, [
        el('p', {}, [el('strong', { text: challenge.name }), el('span', { className: 'muted', text: ' · ' + challenge.adventure + (challenge.dm ? ' · DC ' + challenge.dc : '') })]),
        challenge.situation ? el('p', { className: 'muted', text: challenge.situation }) : null,
        tallyLine(challenge),
        el('p', {}, ['Round ' + challenge.round + '. ', current ? el('strong', { text: current.name + "'s turn." }) : 'No one is taking part.',
          challenge.helpBy ? ' 🤝 ' + challenge.helpBy + ' helped: Advantage next.' : '']),
        over ? el('p', { className: 'muted', text: challenge.dm ? 'Decided: end it on the adventure table in the panel.' : 'The challenge is decided. The DM will tell you how it ends.' }) : null,
        el('ul', { className: 'combatants' }, challenge.participants.map(participant => el('li', { className: participant.turn ? 'turn-now' : '' }, [
          el('span', { className: 'init', text: participant.initiative === null ? '—' : String(participant.initiative) }),
          participant.name,
          participant.usedSkills.length ? el('span', { className: 'muted', text: ' · ' + participant.usedSkills.join(', ') }) : null,
          !over && (challenge.dm ? participant.turn : participant.mine && participant.turn) ? challengeTurn(challenge, participant) : null
        ]))),
        lastAttempts.length ? el('ul', { className: 'combatants' }, lastAttempts.map(attempt => el('li', { className: attempt.voided ? 'down' : '' }, [
          attempt.character + ' — ' + (attempt.kind === 'help' ? 'helps (' + attempt.skill + ')' : attempt.kind === 'feature' ? '✨ ' + attempt.detail : attempt.skill + ' ' + attempt.total),
          attempt.success === 1 ? ' ✓' : attempt.success === 0 ? ' ✗' : '',
          challenge.dm && !attempt.voided && attempt.kind === 'check'
            ? el('button', { type: 'button', className: 'secondary tiny', text: '+5 DC', title: 'A stretch: this roll needed 5 more', onclick: () => challengeAction(challenge, { action: 'raise', attemptId: attempt.id }, 'DC raised for that roll.') })
            : null,
          challenge.dm && !attempt.voided
            ? el('button', { type: 'button', className: 'secondary tiny', text: 'Void', onclick: () => challengeAction(challenge, { action: 'void', attemptId: attempt.id }, 'That turn no longer counts.') })
            : null
        ]))) : null,
        challenge.dm && !over ? el('button', { type: 'button', className: 'secondary', text: '⏭ Skip turn', onclick: () => challengeAction(challenge, { action: 'skip' }, 'Turn skipped.') }) : null
      ]);
    }),
    state.note ? el('p', { className: 'muted', text: state.note }) : null
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
  parts.push(challengeSection());
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

onStoreChange(name => {
  if (name === 'key') { loadEncounters(); loadChallenges(); }
  // A new roll may be someone's turn in a skill challenge.
  if (name === 'log') loadChallenges();
  render();
});
// Help, skips and the DM's rulings make no roll: look again now and then.
setInterval(() => { if (store.key() && document.visibilityState !== 'hidden') loadChallenges(); }, 15000);
loadChallenges();
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
