// vtt/challenge.js — The "Skill challenge" window of Grimbold's Dice in Owlbear
// Rodeo. The background page opens it when a challenge starts in one of this
// player's adventures and keeps the list fresh (store.challenges). Everyone
// sees the tally (if the DM shows it), the order and the turns; players roll
// or help on their character's turn; the DM acts for anyone and rules on turns.

import OBR from 'https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm';
import { store, onStoreChange, CHALLENGE_POPOVER } from './shared.js';

const app = document.getElementById('app');
const CHALLENGE_SKILLS = ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation',
  'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival'];
let note = '';
// What was picked in the selects, kept across re-renders: "challengeId:characterId" → { skill, mode }.
const picks = {};

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

async function refresh() {
  const key = store.key();
  if (!key) return;
  try {
    const url = new URL('/vtt/challenges', window.location.origin);
    url.searchParams.set('key', key);
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The panel did not accept the key.');
    store.setChallenges(data.challenges);
  } catch (error) {
    note = error.message;
  }
  render();
}

async function act(challenge, body, done) {
  try {
    const response = await fetch(new URL('/vtt/challenges/' + challenge.adventureId + '/' + challenge.id, window.location.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: store.key(), ...body })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'That did not work.');
    note = done || '';
    store.setChallenges(data.challenges);
  } catch (error) {
    note = error.message;
  }
  render();
}

function tally(challenge) {
  if (challenge.successes === null) return el('p', { className: 'muted', text: 'The DM keeps the tally hidden.' });
  const pips = (filled, total, on) => Array.from({ length: total }, (_, i) => (i < filled ? on : '○')).join('');
  return el('div', { className: 'tally' }, [
    el('div', {}, ['Successes ', el('span', { className: 'pips ok', text: pips(challenge.successes, challenge.successesNeeded, '●') }), ' ' + challenge.successes + '/' + challenge.successesNeeded]),
    el('div', {}, ['Failures ', el('span', { className: 'pips bad', text: pips(challenge.failures, challenge.failuresAllowed, '✕') }), ' ' + challenge.failures + '/' + challenge.failuresAllowed])
  ]);
}

function turnControls(challenge, participant) {
  const dm = challenge.dm;
  const allowed = participant.allowedSkills;
  const pickKey = challenge.id + ':' + participant.characterId;
  const pick = picks[pickKey] || (picks[pickKey] = { skill: '', mode: 'normal' });
  const skill = el('select', { 'aria-label': 'Skill' }, [el('option', { value: '', text: '-- Skill --' }),
    ...(dm ? CHALLENGE_SKILLS : allowed).map(name => el('option', { value: name, text: name + (dm && !allowed.includes(name) ? ' (used)' : '') }))]);
  skill.value = pick.skill;
  skill.onchange = () => { pick.skill = skill.value; };
  const mode = el('select', { 'aria-label': 'Mode' }, [['normal', 'Normal'], ['advantage', 'Advantage'], ['disadvantage', 'Disadvantage']].map(([value, text]) => el('option', { value, text })));
  mode.value = pick.mode;
  mode.onchange = () => { pick.mode = mode.value; };
  const send = action => {
    if (!skill.value) { note = 'Choose a skill first.'; render(); return; }
    const override = dm && !allowed.includes(skill.value);
    if (override && !window.confirm(skill.value + ' was already used. Allow it anyway?')) return;
    pick.skill = '';
    act(challenge, { action, characterId: participant.characterId, skill: skill.value, mode: mode.value, override },
      action === 'help' ? participant.name + ' helps: the next roll has Advantage.' : '');
  };
  return el('div', { className: 'turn' }, [
    skill, mode,
    el('button', { type: 'button', text: '🎲 Roll', onclick: () => send('check') }),
    el('button', { type: 'button', className: 'secondary', text: '🤝 Help', title: 'Instead of rolling: the next roller gets Advantage', onclick: () => send('help') }),
    dm && !participant.usedFeature ? el('button', {
      type: 'button', className: 'secondary', text: '✨ Spell / feature', title: 'Counts as a success, no roll (once per character)',
      onclick: () => {
        const what = window.prompt('Which spell, feature or item counts as a success for ' + participant.name + '?');
        if (what && what.trim()) act(challenge, { action: 'feature', characterId: participant.characterId, what }, participant.name + "'s " + what.trim() + ' counts as a success.');
      }
    }) : null
  ]);
}

function challengeCard(challenge) {
  const current = challenge.participants.find(participant => participant.turn);
  const over = Boolean(challenge.finishedBy);
  return el('section', { className: 'card' }, [
    el('h2', { text: challenge.name }),
    el('p', { className: 'muted', text: challenge.adventure + (challenge.dm ? ' · DC ' + challenge.dc + ' (only you see it)' : '') }),
    challenge.situation ? el('p', { className: 'situation', text: challenge.situation }) : null,
    tally(challenge),
    el('p', {}, ['Round ' + challenge.round + '. ', current ? el('strong', { text: current.name + "'s turn." }) : 'No one is taking part.']),
    challenge.helpBy ? el('p', { className: 'help', text: '🤝 ' + challenge.helpBy + ' helped: the next roll has Advantage.' }) : null,
    over ? el('p', { className: 'decided', text: challenge.dm ? 'Decided: end it on the adventure table in the panel.' : 'The challenge is decided. The DM will tell you how it ends.' }) : null,
    el('ol', { className: 'order' }, challenge.participants.map(participant => el('li', { className: participant.turn ? 'now' : '' }, [
      el('span', { className: 'init', text: participant.initiative === null ? '—' : String(participant.initiative) }),
      el('strong', { text: participant.name }),
      participant.usedSkills.length ? el('span', { className: 'muted', text: ' · ' + participant.usedSkills.join(', ') }) : null,
      participant.usedFeature ? el('span', { className: 'muted', text: ' · ✨' }) : null,
      !over && participant.turn && (challenge.dm || participant.mine) ? turnControls(challenge, participant) : null
    ]))),
    !challenge.dm && !over && challenge.participants.some(participant => participant.mine && participant.initiative === null)
      ? el('p', { className: 'muted', text: 'Roll initiative on your character sheet to take your place in the order.' }) : null,
    challenge.dm && !over ? el('button', { type: 'button', className: 'secondary', text: '⏭ Skip turn', onclick: () => act(challenge, { action: 'skip' }, 'Turn skipped.') }) : null,
    el('h3', { text: 'Turns' }),
    challenge.attempts.length ? el('ol', { className: 'log' }, challenge.attempts.slice().reverse().map(attempt => el('li', { className: attempt.voided ? 'void' : '' }, [
      el('span', { className: 'muted', text: 'R' + attempt.round + ' ' }),
      el('strong', { text: attempt.character + ' ' }),
      attempt.kind === 'help' ? 'helps (' + attempt.skill + ')' : attempt.kind === 'feature' ? '✨ ' + attempt.detail
        : attempt.skill + ' ' + attempt.total + (challenge.dm ? ' vs ' + attempt.dc : ''),
      attempt.success === 1 ? el('span', { className: 'ok', text: ' ✓' }) : attempt.success === 0 ? el('span', { className: 'bad', text: ' ✗' }) : null,
      challenge.dm && !attempt.voided && attempt.kind === 'check'
        ? el('button', { type: 'button', className: 'secondary tiny', text: '+5 DC', title: 'A stretch: this roll needed 5 more', onclick: () => act(challenge, { action: 'raise', attemptId: attempt.id }, 'DC raised for that roll.') })
        : null,
      challenge.dm && !attempt.voided
        ? el('button', { type: 'button', className: 'secondary tiny', text: 'Void', onclick: () => act(challenge, { action: 'void', attemptId: attempt.id }, 'That turn no longer counts.') })
        : null
    ]))) : el('p', { className: 'muted', text: 'No turns yet.' })
  ]);
}

function render() {
  const challenges = store.challenges();
  const parts = [el('div', { className: 'top' }, [
    el('h1', { text: '🎯 Skill challenge' }),
    el('span', {}, [
      el('button', { type: 'button', className: 'secondary', text: '↻', title: 'Refresh', onclick: refresh }), ' ',
      el('button', { type: 'button', className: 'secondary', text: '✕', title: 'Close (it opens again for the next challenge, or from the Dice window)', onclick: () => OBR.popover.close(CHALLENGE_POPOVER) })
    ])
  ])];
  if (!store.key()) parts.push(el('p', { className: 'muted', text: 'Connect your key in the Dice window first.' }));
  else if (!challenges.length) parts.push(el('p', { className: 'muted', text: 'No skill challenge is running in your adventures.' }));
  else parts.push(...challenges.map(challengeCard));
  if (note) parts.push(el('p', { className: 'note', text: note }));
  app.replaceChildren(...parts);
}

onStoreChange(name => { if (name === 'challenges' || name === 'key') render(); });
render();
OBR.onReady(refresh);
