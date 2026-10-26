// vtt/shared.js — What the background page and the popover of "Grimbold's
// Dice" share: the player's key, the roll log and settings (localStorage of
// this site inside Owlbear), and a BroadcastChannel to tell the popover.

export const CHANNEL = 'grimbold.dice/roll';
const PREFIX = 'grimbold-dice.';
const LOG_SIZE = 60;
const bus = typeof BroadcastChannel === 'function' ? new BroadcastChannel('grimbold-dice') : null;
// Node (the tests) would otherwise wait on the channel forever.
if (bus && typeof bus.unref === 'function') bus.unref();

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
    write('afterReveal', null);
    write('status', null);
  },
  after: () => read('after', null),
  setAfter: id => write('after', id),
  // The last monster roll the DM revealed that this room has seen.
  afterReveal: () => read('afterReveal', null),
  setAfterReveal: seq => write('afterReveal', seq),
  status: () => read('status', null),
  setStatus: status => write('status', status),
  // tracker: the GM's copy puts initiative rolls into Owlbear's initiative tracker.
  settings: () => ({ notify: true, tracker: true, ...read('settings', {}) }),
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

// ─── Owlbear's own Initiative Tracker ─────────────────────────────────────
// It lists the image tokens that carry this metadata ({ count: '17', active })
// under the token's label (or name). We only set the count; whose turn it is
// stays the tracker's business.
export const TRACKER_KEY = 'rodeo.owlbear.initiative-tracker/metadata';
const normal = text => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const tokenName = item => (item.text && item.text.plainText) || item.name || '';
const isToken = item => item.type === 'IMAGE' && (item.layer === 'CHARACTER' || item.layer === 'MOUNT');

// wanted: [{ label, baseName }] → the same list with .token (or null). Exact
// names first ("Goblin Warrior 2"), then the base name ("Goblin Warrior"),
// each token used once.
export function matchTokens(items, wanted) {
  const tokens = items.filter(isToken);
  const used = new Set();
  const take = name => {
    const token = tokens.find(item => !used.has(item.id) && normal(tokenName(item)) === normal(name));
    if (token) used.add(token.id);
    return token || null;
  };
  const result = wanted.map(entry => ({ ...entry, token: take(entry.label) }));
  result.forEach(entry => { if (!entry.token && entry.baseName && entry.baseName !== entry.label) entry.token = take(entry.baseName); });
  return result;
}

// pairs: [{ itemId, initiative }]
export async function putInTracker(OBR, pairs) {
  if (!pairs.length) return;
  const byId = new Map(pairs.map(pair => [pair.itemId, pair.initiative]));
  await OBR.scene.items.updateItems([...byId.keys()], items => {
    items.forEach(item => {
      const old = item.metadata[TRACKER_KEY];
      item.metadata[TRACKER_KEY] = { count: String(byId.get(item.id)), active: Boolean(old && old.active) };
    });
  });
}
