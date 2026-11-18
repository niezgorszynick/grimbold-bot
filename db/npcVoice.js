// db/npcVoice.js — What NPCs said through the panel (npcVoice.js) and what
// players wrote back to their DMs. Each NPC's voice page reads its own; a
// private NPC's only by those who may see it (db/npcs.js canSeeNpc).

'use strict';

const { db } = require('./connection');

const COLOR = /^#[0-9a-f]{6}$/i;

// Players who can be written to, with their living characters' names.
function getVoiceRecipients() {
  const players = db.prepare(`
    SELECT id, discord_id, discord_tag FROM players
    WHERE discord_id IS NOT NULL AND discord_id != ''
    ORDER BY discord_tag COLLATE NOCASE
  `).all();
  const characters = db.prepare("SELECT player_id, name FROM characters WHERE status = 'alive' ORDER BY name COLLATE NOCASE").all();
  return players.map(player => ({
    ...player,
    characters: characters.filter(character => character.player_id === player.id).map(character => character.name)
  }));
}

function recordNpcVoice({ npcId, direction, target = 'dm', playerId = null, discordId = null, placeLabel = null, text = '', status = 'sent', error = null, discordMessageId = null, sentBy = null }) {
  return Number(db.prepare(`
    INSERT INTO npc_voice_messages (npc_id, direction, target, player_id, discord_id, place_label, text, status, error, discord_message_id, sent_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Number(npcId), direction, target, playerId, discordId === null ? null : String(discordId), placeLabel, String(text), status, error, discordMessageId, sentBy).lastInsertRowid);
}

// One NPC's messages after an id, oldest first.
function getNpcVoiceMessages(npcId, { afterId = 0 } = {}) {
  return db.prepare(`
    SELECT m.id, m.direction, m.target, m.player_id, m.discord_id, m.place_label, m.text, m.status, m.error, m.created_at,
           p.discord_tag
    FROM npc_voice_messages m LEFT JOIN players p ON p.id = m.player_id
    WHERE m.npc_id = ? AND m.id > ? ORDER BY m.id
  `).all(Number(npcId), Number(afterId) || 0);
}

// The NPC whose DM a player's reply answers: the last one that reached them.
function lastNpcToDm(discordId) {
  const row = db.prepare(`
    SELECT npc_id FROM npc_voice_messages
    WHERE discord_id = ? AND direction = 'out' AND target = 'dm' AND status = 'sent'
    ORDER BY id DESC LIMIT 1
  `).get(String(discordId));
  return row ? row.npc_id : null;
}

function setNpcVoiceColor(npcId, color) {
  if (!COLOR.test(String(color || ''))) return;
  db.prepare('UPDATE npcs SET voice_color = ? WHERE id = ?').run(String(color).toLowerCase(), Number(npcId));
}

module.exports = { getVoiceRecipients, recordNpcVoice, getNpcVoiceMessages, lastNpcToDm, setNpcVoiceColor };
