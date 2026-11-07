// vtt/background.js — Runs while the Owlbear Rodeo room is open. Every few
// seconds it asks the panel for rolls this player made, sends each to everyone
// in the room, and shows the rolls others send (private ones to the GM only).
// The GM's copy also puts initiative rolls into Owlbear's Initiative Tracker,
// on the token named like the character ("Thorin Ironfist" or "Thorin").
// It also watches for skill challenges in this player's adventures: a new
// one opens the challenge window, and it closes when none is running.
// A window moved by the player is reopened here at its new place, and a
// popped-out rolls window comes back with the room.

import OBR from 'https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm';
import { CHANNEL, CHALLENGE_POPOVER, WINDOWS, store, describe, matchTokens, putInTracker, openChallengeWindow, openWindow, onStoreChange, reopenRequest } from './shared.js';

const POLL_MS = 2000;
const CHALLENGE_POLL_MS = 4000;

OBR.onReady(async () => {
  const myConnection = await OBR.player.getConnectionId();
  let isGm = (await OBR.player.getRole()) === 'GM';
  OBR.player.onChange(player => { isGm = player.role === 'GM'; });
  const seen = new Set();

  async function trackInitiative(roll) {
    if (!isGm || roll.kind !== 'initiative' || !store.settings().tracker || !Number.isFinite(roll.total)) return;
    try {
      if (!(await OBR.scene.isReady())) return;
      const firstName = String(roll.character || '').split(' ')[0];
      const [match] = matchTokens(await OBR.scene.items.getItems(), [{ label: roll.character, baseName: firstName }]);
      if (!match.token) return;
      await putInTracker(OBR, [{ itemId: match.token.id, initiative: roll.total }]);
    } catch (error) {
      console.warn("Grimbold's Dice: could not update the initiative tracker", error);
    }
  }

  OBR.broadcast.onMessage(CHANNEL, ({ data, connectionId }) => {
    const roll = data;
    if (!roll || typeof roll !== 'object' || seen.has(roll.id)) return;
    seen.add(roll.id);
    const mine = connectionId === myConnection;
    if (roll.private && !isGm && !mine) return;
    store.addToLog({ ...roll, mine });
    trackInitiative(roll);
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
      const afterReveal = store.afterReveal();
      if (afterReveal !== null) url.searchParams.set('afterReveal', String(afterReveal));
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        store.setStatus({ ok: false, error: data.error || 'The panel did not accept the key.' });
        return;
      }
      store.setStatus({ ok: true, player: data.player, at: Date.now() });
      // Monster rolls the DM revealed (their key only): sent like any roll.
      if (afterReveal === null) {
        store.setAfterReveal(data.latestReveal || 0);
      } else {
        for (const roll of data.monsterRolls || []) {
          await OBR.broadcast.sendMessage(CHANNEL, roll, { destination: 'ALL' });
          store.setAfterReveal(roll.revealSeq);
        }
      }
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

  let wasRunning = false;
  async function watchChallenges() {
    const key = store.key();
    if (!key) return;
    try {
      const url = new URL('/vtt/challenges', window.location.origin);
      url.searchParams.set('key', key);
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return;
      const challenges = (await response.json()).challenges || [];
      store.setChallenges(challenges);
      const shown = store.challengesShown();
      const fresh = challenges.filter(challenge => !shown.includes(challenge.id));
      if (fresh.length) {
        store.setChallengesShown([...shown, ...fresh.map(challenge => challenge.id)]);
        await openChallengeWindow(OBR);
      } else if (!challenges.length && wasRunning) {
        await OBR.popover.close(CHALLENGE_POPOVER);
      }
      wasRunning = challenges.length > 0;
    } catch (error) {
      console.warn("Grimbold's Dice: could not check skill challenges", error);
    }
  }
  setInterval(watchChallenges, CHALLENGE_POLL_MS);
  watchChallenges();

  let lastReopen = 0;
  onStoreChange(async name => {
    if (name !== 'reopen') return;
    const request = reopenRequest();
    if (!request || !WINDOWS[request.name] || request.at <= lastReopen) return;
    lastReopen = request.at;
    try {
      await OBR.popover.close(WINDOWS[request.name].id);
      await openWindow(OBR, request.name);
    } catch (error) {
      console.warn("Grimbold's Dice: could not move the window", error);
    }
  });
  if (store.rollsOut()) openWindow(OBR, 'rolls').catch(() => {});
});
