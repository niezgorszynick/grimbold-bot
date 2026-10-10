// vtt/background.js — Runs while the Owlbear Rodeo room is open. Every few
// seconds it asks the panel for rolls this player made, sends each to everyone
// in the room, and shows the rolls others send (private ones to the GM only).

import OBR from 'https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm';
import { CHANNEL, store, describe } from './shared.js';

const POLL_MS = 2000;

OBR.onReady(async () => {
  const myConnection = await OBR.player.getConnectionId();
  let isGm = (await OBR.player.getRole()) === 'GM';
  OBR.player.onChange(player => { isGm = player.role === 'GM'; });
  const seen = new Set();

  OBR.broadcast.onMessage(CHANNEL, ({ data, connectionId }) => {
    const roll = data;
    if (!roll || typeof roll !== 'object' || seen.has(roll.id)) return;
    seen.add(roll.id);
    const mine = connectionId === myConnection;
    if (roll.private && !isGm && !mine) return;
    store.addToLog({ ...roll, mine });
    if (store.settings().notify) {
      const variant = roll.natural === 20 ? 'SUCCESS' : roll.natural === 1 ? 'ERROR' : roll.private ? 'WARNING' : 'DEFAULT';
      OBR.notification.show(describe(roll), variant);
    }
  });

  let busy = false;
  async function poll() {
    const key = store.key();
    if (!key || busy) return;
    busy = true;
    try {
      const url = new URL('/vtt/rolls', window.location.origin);
      url.searchParams.set('key', key);
      const after = store.after();
      if (after !== null) url.searchParams.set('after', String(after));
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        store.setStatus({ ok: false, error: data.error || 'The panel did not accept the key.' });
        return;
      }
      store.setStatus({ ok: true, player: data.player, at: Date.now() });
      // First contact: start from the newest roll instead of replaying history.
      if (after === null) {
        store.setAfter(data.latest);
        return;
      }
      for (const roll of data.rolls) {
        await OBR.broadcast.sendMessage(CHANNEL, roll, { destination: 'ALL' });
        store.setAfter(roll.id);
      }
    } catch (error) {
      store.setStatus({ ok: false, error: `Can't reach the panel (${error.message}).` });
    } finally {
      busy = false;
    }
  }
  setInterval(poll, POLL_MS);
  poll();
});
