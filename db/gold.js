// db/gold.js — Purses edited by hand (players on their own sheet, DMs in the
// panel), each change logged in gold_changes; and which Discord thread in the
// character channel belongs to a character.

'use strict';

const { db } = require('./connection');
const { coinsToCp, splitCp } = require('../currency');

const MAX_REASON = 200;

function loadCharacter(characterId) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) throw new Error('Character not found.');
  return character;
}

function canEditPurse(character, user) {
  return Boolean(user && (user.role === 'admin' || character.player_id === Number(user.id)));
}

// Writes one gold_changes row; returns it with the character's name and player.
function recordGoldChange({ characterId, user, oldCp, newCp, reason }) {
  const id = Number(db.prepare(`
    INSERT INTO gold_changes (character_id, changed_by, changed_by_admin, old_cp, new_cp, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(characterId, user && Number(user.id) > 0 ? Number(user.id) : null, user && user.role === 'admin' ? 1 : 0,
    oldCp, newCp, String(reason || '').trim().slice(0, MAX_REASON)).lastInsertRowid);
  return getGoldChange(id);
}

function getGoldChange(id) {
  return db.prepare(`
    SELECT g.*, c.name AS character_name, c.player_id, p.discord_tag AS changed_by_tag
    FROM gold_changes g JOIN characters c ON c.id = g.character_id
    LEFT JOIN players p ON p.id = g.changed_by
    WHERE g.id = ?
  `).get(Number(id));
}

// coins: { gp, sp, cp }. The owner or an admin; the change is logged.
function setCharacterPurse({ characterId, user, coins, reason }) {
  return db.transaction(() => {
    const character = loadCharacter(characterId);
    if (!canEditPurse(character, user)) throw new Error('Forbidden.');
    const newCp = coinsToCp(coins);
    if (newCp === character.gold_cp) throw new Error('The purse already holds that much.');
    db.prepare('UPDATE characters SET gold_cp = ? WHERE id = ?').run(newCp, character.id);
    return recordGoldChange({ characterId: character.id, user, oldCp: character.gold_cp, newCp, reason });
  })();
}

function getCharacterPurse({ characterId, user }) {
  const character = loadCharacter(characterId);
  if (!canEditPurse(character, user)) throw new Error('Forbidden.');
  const changes = db.prepare(`
    SELECT g.id, g.old_cp, g.new_cp, g.reason, g.changed_by_admin, g.created_at, p.discord_tag AS changed_by_tag
    FROM gold_changes g LEFT JOIN players p ON p.id = g.changed_by
    WHERE g.character_id = ? ORDER BY g.id DESC LIMIT 10
  `).all(character.id);
  return { goldCp: character.gold_cp, coins: splitCp(character.gold_cp), changes };
}

// "https://discord.com/channels/<guild>/<thread>" or a bare ID → the thread ID.
function parseThreadId(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const fromLink = text.match(/discord(?:app)?\.com\/channels\/\d+\/(\d{15,25})/);
  if (fromLink) return fromLink[1];
  if (/^\d{15,25}$/.test(text)) return text;
  throw new Error('Paste the thread link (Copy Link in Discord) or its ID.');
}

function setCharacterThread(characterId, threadInput) {
  const character = loadCharacter(characterId);
  const threadId = parseThreadId(threadInput);
  db.prepare('UPDATE characters SET discord_thread_id = ? WHERE id = ?').run(threadId, character.id);
  return threadId;
}

module.exports = {
  recordGoldChange,
  getGoldChange,
  setCharacterPurse,
  getCharacterPurse,
  parseThreadId,
  setCharacterThread
};
