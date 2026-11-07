// vtt/shared.js — What the background page and the popover of "Grimbold's
// Dice" share: the player's key, the roll log and settings (localStorage of
// this site inside Owlbear), and a BroadcastChannel to tell the popover.

export const CHANNEL = 'grimbold.dice/roll';
// The separate skill challenge window (an Owlbear popover).
export const CHALLENGE_POPOVER = 'grimbold.dice/challenge';
export const ROLLS_POPOVER = 'grimbold.dice/rolls';
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
    write('challenges', null); // the new key's player sees their own
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
  clearLog: () => write('log', []),
  // The rolls window was popped out (it opens again with the room).
  rollsOut: () => read('rollsOut', false),
  setRollsOut: out => write('rollsOut', Boolean(out)),
  // The running skill challenges this key's player is in or DMs (the background page keeps it fresh).
  challenges: () => read('challenges', []),
  setChallenges(list) {
    const next = Array.isArray(list) ? list : [];
    if (JSON.stringify(next) !== JSON.stringify(store.challenges())) write('challenges', next);
  },
  // Challenge ids whose window already opened by itself (closing it keeps it closed).
  challengesShown: () => read('challengesShown', []),
  setChallengesShown: ids => write('challengesShown', ids.slice(-50))
};

// ─── Windows of their own (Owlbear popovers): skill challenge and rolls ────
// Each player's browser remembers where each one sits and how big it is.
export const WINDOWS = {
  challenge: { id: CHALLENGE_POPOVER, url: '/vtt/challenge.html', width: 380, height: 560 },
  rolls: { id: ROLLS_POPOVER, url: '/vtt/rolls.html', width: 340, height: 420 }
};
export const COLLAPSED_HEIGHT = 46;
export const MIN_SIZE = { width: 260, height: 140 };

export function windowPlace(name) {
  const saved = read('window.' + name, null);
  return saved && typeof saved === 'object' ? saved : null;
}
export function setWindowPlace(name, place) {
  write('window.' + name, { ...(windowPlace(name) || {}), ...place });
}

// Opens a window where the player left it (or near the top right).
export async function openWindow(OBR, name) {
  const spec = WINDOWS[name];
  const saved = windowPlace(name) || {};
  let viewportWidth = 1200;
  let viewportHeight = 800;
  try {
    [viewportWidth, viewportHeight] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  } catch { /* defaults */ }
  const width = Math.max(MIN_SIZE.width, Math.min(saved.width || spec.width, viewportWidth - 20));
  const height = Math.max(MIN_SIZE.height, Math.min(saved.height || spec.height, viewportHeight - 20));
  const fallbackLeft = viewportWidth - width - 70 - (name === 'rolls' ? WINDOWS.challenge.width + 12 : 0);
  const left = Math.max(0, Math.min(Number.isFinite(saved.left) ? saved.left : fallbackLeft, viewportWidth - 120));
  const top = Math.max(0, Math.min(Number.isFinite(saved.top) ? saved.top : 70, viewportHeight - COLLAPSED_HEIGHT));
  if (!Number.isFinite(saved.left)) setWindowPlace(name, { left, top });
  await OBR.popover.open({
    id: spec.id,
    url: spec.url,
    width,
    height: saved.collapsed ? COLLAPSED_HEIGHT : height,
    anchorReference: 'POSITION',
    anchorPosition: { left, top },
    anchorOrigin: { horizontal: 'LEFT', vertical: 'TOP' },
    transformOrigin: { horizontal: 'LEFT', vertical: 'TOP' },
    disableClickAway: true,
    marginThreshold: 0
  });
}
export const openChallengeWindow = OBR => openWindow(OBR, 'challenge');

// A window can't move itself (closing it ends its own page), so it asks the
// background page to close and reopen it at the new place.
export function requestReopen(name) {
  write('reopen', { name, at: Date.now() });
}
export const reopenRequest = () => read('reopen', null);

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
