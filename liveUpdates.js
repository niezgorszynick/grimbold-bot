// liveUpdates.js — Pushes changes to open adventure tables as they happen.
//
// Database triggers (migration 7) write a row to change_log on every change
// to a character, their classes, a party, an adventure or a roll, whatever
// code made it. While anyone is listening, this reads the new rows twice a
// second (a tiny local query) and hands them to the listeners, which send
// them to browsers as Server-Sent Events (see the /live route in webShopApi.js).

'use strict';

const { db } = require('./db/connection');

const POLL_MS = 500;
const PRUNE_EVERY_MS = 10 * 60 * 1000;
const KEEP_ROWS = 5000;

const listeners = new Set();
let timer = null;
let lastId = 0;
let lastPrune = 0;

function latestId() {
  return db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM change_log').get().id;
}

// changes: [{ kind: 'character' | 'adventure' | 'roll', refId }]
function poll() {
  const rows = db.prepare('SELECT id, kind, ref_id FROM change_log WHERE id > ? ORDER BY id').all(lastId);
  if (rows.length) {
    lastId = rows[rows.length - 1].id;
    // One entry per kind and id, however many writes there were.
    const seen = new Map();
    rows.forEach(row => seen.set(`${row.kind}:${row.ref_id}`, { kind: row.kind, refId: row.ref_id }));
    const changes = [...seen.values()];
    for (const listener of listeners) {
      try {
        listener(changes);
      } catch (error) {
        console.warn('Live update listener failed:', error.message);
      }
    }
  }
  if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
    lastPrune = Date.now();
    db.prepare('DELETE FROM change_log WHERE id <= ?').run(lastId - KEEP_ROWS);
  }
}

function tick() {
  try {
    poll();
  } catch (error) {
    console.warn('Live updates could not read the change log:', error.message);
  }
}

// Calls listener(changes) for every batch of changes. Returns an unsubscribe function.
function subscribe(listener) {
  listeners.add(listener);
  if (!timer) {
    // Only what happens from now on.
    lastId = latestId();
    timer = setInterval(tick, POLL_MS);
    if (timer.unref) timer.unref();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = { subscribe, poll: tick };
