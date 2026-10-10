// vtt/shared.js — What the background page and the popover of "Grimbold's
// Dice" share: the player's key, the roll log and settings (localStorage of
// this site inside Owlbear), and a BroadcastChannel to tell the popover.

export const CHANNEL = 'grimbold.dice/roll';
const PREFIX = 'grimbold-dice.';
const LOG_SIZE = 60;
const bus = typeof BroadcastChannel === 'function' ? new BroadcastChannel('grimbold-dice') : null;

function read(name, fallback) {
  try {
    const value = localStorage.getItem(PREFIX + name);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function write(name, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + name);
    else localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the extension then forgets between sessions.
  }
  if (bus) bus.postMessage({ changed: name });
}

export const store = {
  key: () => read('key', ''),
  setKey(key) {
    write('key', key || null);
    write('after', null); // learn the latest roll again, don't replay old ones
    write('status', null);
  },
  after: () => read('after', null),
  setAfter: id => write('after', id),
  status: () => read('status', null),
  setStatus: status => write('status', status),
  settings: () => ({ notify: true, ...read('settings', {}) }),
  setSettings: update => write('settings', { ...store.settings(), ...update }),
  log: () => read('log', []),
  addToLog(roll) {
    const log = [roll, ...store.log().filter(entry => entry.id !== roll.id)].slice(0, LOG_SIZE);
    write('log', log);
  },
  clearLog: () => write('log', [])
};

export function onStoreChange(callback) {
  if (bus) bus.addEventListener('message', event => callback(event.data && event.data.changed));
  window.addEventListener('storage', event => {
    if (event.key && event.key.startsWith(PREFIX)) callback(event.key.slice(PREFIX.length));
  });
}

// "Thorin Ironfist — Greatsword attack: 18 (2d20 [13, ~~7~~] + 5)"
export function describe(roll) {
  const extra = roll.natural === 20 ? ' — natural 20!' : roll.natural === 1 ? ' — natural 1' : '';
  const mode = roll.mode === 'advantage' ? ' (advantage)' : roll.mode === 'disadvantage' ? ' (disadvantage)' : '';
  return `${roll.private ? '🔒 ' : ''}${roll.character} — ${roll.label}${mode}: ${roll.total}${extra}`;
}
