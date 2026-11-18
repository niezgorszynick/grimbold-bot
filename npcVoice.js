// npcVoice.js — A DM speaks as a Notable NPC from its voice page (the NPCs
// tab): in the speak channel or an adventure thread, under the NPC's name and
// portrait (a webhook, adventureThreads.js), or privately in chosen players'
// Discord DMs. Grimbold delivers those, as an embed under the NPC's name and
// portrait in the NPC's colour. What a player writes back to Grimbold's DMs
// goes to the last NPC that wrote to them (db/npcVoice.js).

'use strict';

const db = require('./db');
const threads = require('./adventureThreads');

const DEFAULT_COLOR = '#5c0a0a';
const MAX_DM = 4000;      // an embed description holds 4096
const MAX_CHANNEL = 2000; // a message
const MAX_REPLY_SAVED = 4000;

let client = null;
function setNpcVoiceClient(discordClient) {
  client = discordClient;
}

const colorOf = value => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : DEFAULT_COLOR);

function dmEmbed(npc, text, color) {
  const embed = { author: { name: String(npc.name).slice(0, 256) }, description: text, color: parseInt(colorOf(color).slice(1), 16) };
  const icon = threads.npcPortraitUrl(npc);
  if (icon) embed.author.icon_url = icon;
  return embed;
}

function failureReason(error) {
  if (error && error.code === 50007) return 'their DMs are closed to Grimbold';
  if (error && error.code === 10013) return 'Discord does not know this account';
  return (error && error.message) || 'Discord refused it';
}

function voiceNpc(npcId, user) {
  if (!user || user.role !== 'admin') throw new Error('Only a DM can speak as an NPC.');
  return db.requireVisibleNpc(npcId, user);
}

// { npcId, user, target: 'dm' | 'channel', adventureId, playerIds, text, color }
// → { results: [{ label, ok, error }] }.
async function sendNpcVoice({ npcId, user, target, adventureId, playerIds, text, color }) {
  const npc = voiceNpc(npcId, user);
  const body = String(text || '').trim();
  if (!body) throw new Error('Write something first.');
  const sentBy = Number(user.id);

  if (target !== 'dm') {
    if (body.length > MAX_CHANNEL) throw new Error(`Too long: ${body.length} characters (a Discord message takes ${MAX_CHANNEL}).`);
    const adventure = adventureId ? db.getAdventureById(Number(adventureId)) : null;
    if (adventureId && !adventure) throw new Error('Adventure not found.');
    const placeLabel = adventure ? adventure.title : 'speak channel';
    try {
      const result = await threads.sayAsNpc({ npcId: npc.id, user, adventureId: adventure ? adventure.id : null, text: body });
      db.recordNpcVoice({ npcId: npc.id, direction: 'out', target: adventure ? 'thread' : 'channel', placeLabel, text: body, sentBy });
      return { results: [{ label: placeLabel, ok: true, webhook: result.webhook }] };
    } catch (error) {
      db.recordNpcVoice({ npcId: npc.id, direction: 'out', target: adventure ? 'thread' : 'channel', placeLabel, text: body, status: 'failed', error: error.message, sentBy });
      throw error;
    }
  }

  if (body.length > MAX_DM) throw new Error(`Too long: ${body.length} characters (Discord takes ${MAX_DM}).`);
  const ids = [...new Set([].concat(playerIds || []).map(Number).filter(Number.isSafeInteger))];
  if (!ids.length) throw new Error('Choose who gets it.');
  if (!client || !client.isReady || !client.isReady()) throw new Error('Grimbold is not connected to Discord right now.');
  db.setNpcVoiceColor(npc.id, color);
  const embed = dmEmbed(npc, body, color);
  const recipients = db.getVoiceRecipients();
  const results = [];
  for (const id of ids) {
    const player = recipients.find(entry => entry.id === id);
    if (!player) {
      results.push({ label: `#${id}`, ok: false, error: 'no such player' });
      continue;
    }
    const record = extra => db.recordNpcVoice({ npcId: npc.id, direction: 'out', target: 'dm', playerId: player.id, discordId: player.discord_id, text: body, sentBy, ...extra });
    try {
      const user = await client.users.fetch(player.discord_id);
      const sent = await user.send({ embeds: [embed], allowedMentions: { parse: [] } });
      record({ discordMessageId: sent && sent.id ? String(sent.id) : null });
      results.push({ label: player.discord_tag, ok: true });
    } catch (error) {
      const reason = failureReason(error);
      record({ status: 'failed', error: reason });
      results.push({ label: player.discord_tag, ok: false, error: reason });
    }
  }
  return { results };
}

// A DM to Grimbold (messageCreate): kept for the last NPC that wrote to them.
function handleDirectMessage(message) {
  if (!message || message.guild || message.guildId || !message.author || message.author.bot) return false;
  const discordId = String(message.author.id);
  const npcId = db.lastNpcToDm(discordId);
  if (!npcId) return false;
  const attachments = message.attachments ? [...message.attachments.values()].map(file => file.url) : [];
  const text = [String(message.content || ''), ...attachments].filter(Boolean).join('\n').slice(0, MAX_REPLY_SAVED);
  if (!text) return false;
  const player = db.prepare('SELECT id FROM players WHERE discord_id = ?').get(discordId);
  db.recordNpcVoice({ npcId, direction: 'in', target: 'dm', playerId: player ? player.id : null, discordId, text, discordMessageId: message.id ? String(message.id) : null });
  return true;
}

// What the voice page needs: places, players, Grimbold's look, the messages.
async function voicePage({ npcId, user }) {
  const npc = voiceNpc(npcId, user);
  const places = await threads.npcSpeakPlaces(user).catch(() => ({ channel: { name: null }, adventures: [] }));
  return {
    npc: { id: npc.id, name: npc.name, private: Boolean(npc.private), color: colorOf(npc.voice_color), portraitUrl: npc.portrait_file ? `/api/npcs/${npc.id}/files/portrait?v=${encodeURIComponent(npc.portrait_file)}` : null },
    bot: threads.botIdentity(),
    places,
    recipients: db.getVoiceRecipients().map(({ id, discord_tag: tag, characters }) => ({ id, tag, characters })),
    messages: db.getNpcVoiceMessages(npc.id),
    limits: { dm: MAX_DM, channel: MAX_CHANNEL }
  };
}

module.exports = { setNpcVoiceClient, sendNpcVoice, handleDirectMessage, voicePage, dmEmbed, DEFAULT_COLOR };
