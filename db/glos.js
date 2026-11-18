// db/glos.js — Głos ("The Voice"): the messages one DM sends players in
// Discord DMs, and what the players write back (glos.js sends and listens).
// Only that DM sees any of it (auth.js isGlosOwner).

'use strict';

const { db } = require('./connection');

// Players who can be written to, with their living characters' names.
function getGlosRecipients() {
  const players = db.prepare(`
    SELECT id, discord_id, discord_tag FROM players
    WHERE discord_id IS NOT NULL AND discord_id != ''
    ORDER BY discord_tag COLLATE NOCASE
  `).all();
  const characters = db.prepare(`
    SELECT player_id, name FROM characters WHERE status = 'alive' ORDER BY name COLLATE NOCASE
  `).all();
  return players.map(player => ({
    ...player,
    characters: characters.filter(character => character.player_id === player.id).map(character => character.name)
  }));
}

function recordGlosMessage({ playerId = null, discordId, direction, text = '', imageUrl = null, status = 'sent', error = null, discordMessageId = null }) {
  if (!discordId) throw new Error('A Głos message needs a Discord user.');
  const result = db.prepare(`
    INSERT INTO glos_messages (player_id, discord_id, direction, text, image_url, status, error, discord_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(playerId, String(discordId), direction, String(text), imageUrl || null, status, error, discordMessageId);
  return Number(result.lastInsertRowid);
}

// Messages after an id, oldest first (the tab loads them all, then polls).
function getGlosMessages({ afterId = 0 } = {}) {
  return db.prepare(`
    SELECT m.*, p.discord_tag
    FROM glos_messages m LEFT JOIN players p ON p.id = m.player_id
    WHERE m.id > ? ORDER BY m.id
  `).all(Number(afterId) || 0);
}

// Głos only listens to people it has written to.
function hasGlosConversation(discordId) {
  return Boolean(db.prepare(`SELECT 1 FROM glos_messages WHERE discord_id = ? AND direction = 'out' AND status = 'sent' LIMIT 1`).get(String(discordId)));
}

function glosPlayerByDiscordId(discordId) {
  return db.prepare('SELECT id, discord_id, discord_tag FROM players WHERE discord_id = ?').get(String(discordId)) || null;
}

module.exports = { getGlosRecipients, recordGlosMessage, getGlosMessages, hasGlosConversation, glosPlayerByDiscordId };
