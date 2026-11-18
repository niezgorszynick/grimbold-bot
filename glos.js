// glos.js — Głos ("The Voice"): one DM writes to players privately in their
// Discord DMs. Grimbold delivers it, but the message is an embed under Głos's
// name and icon, in a dark colour, so it reads as something else talking.
// Whatever a player writes back to Grimbold's DMs after Głos has written to
// them is kept for that DM (db/glos.js). Only that DM sees any of it.
//
// GLOS_ICON_URL (a public image link) gives Głos its own icon on the embed.

'use strict';

const db = require('./db');

const COLOR = 0x5c0a0a;
const MAX_TEXT = 4000; // an embed description holds 4096
const MAX_REPLY_SAVED = 4000;

let client = null;
function setGlosClient(discordClient) {
  client = discordClient;
}

const iconUrl = () => String(process.env.GLOS_ICON_URL || '').trim() || undefined;

function glosEmbed(text, imageUrl) {
  const embed = { author: { name: 'Głos' }, description: text, color: COLOR };
  const icon = iconUrl();
  if (icon) embed.author.icon_url = icon;
  if (imageUrl) embed.image = { url: imageUrl };
  return embed;
}

function cleanImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  if (!/^https:\/\/\S+$/i.test(url)) throw new Error('The image has to be an https:// link.');
  return url;
}

function failureReason(error) {
  if (error && error.code === 50007) return 'their DMs are closed to Grimbold';
  if (error && error.code === 10013) return 'Discord does not know this account';
  return (error && error.message) || 'Discord refused it';
}

// Sends one message to each chosen player. Returns [{ playerId, tag, ok, error }].
async function sendGlos({ playerIds, text, imageUrl }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Write something first.');
  if (body.length > MAX_TEXT) throw new Error(`Too long: ${body.length} characters (Discord takes ${MAX_TEXT}).`);
  const image = cleanImageUrl(imageUrl);
  const ids = [...new Set([].concat(playerIds || []).map(Number).filter(Number.isSafeInteger))];
  if (!ids.length) throw new Error('Choose who hears it.');
  if (!client || !client.isReady || !client.isReady()) throw new Error('Grimbold is not connected to Discord right now.');

  const recipients = db.getGlosRecipients();
  const results = [];
  for (const id of ids) {
    const player = recipients.find(entry => entry.id === id);
    if (!player) {
      results.push({ playerId: id, tag: `#${id}`, ok: false, error: 'no such player' });
      continue;
    }
    try {
      const user = await client.users.fetch(player.discord_id);
      const sent = await user.send({ embeds: [glosEmbed(body, image)], allowedMentions: { parse: [] } });
      db.recordGlosMessage({ playerId: player.id, discordId: player.discord_id, direction: 'out', text: body, imageUrl: image, discordMessageId: sent && sent.id });
      results.push({ playerId: player.id, tag: player.discord_tag, ok: true });
    } catch (error) {
      const reason = failureReason(error);
      db.recordGlosMessage({ playerId: player.id, discordId: player.discord_id, direction: 'out', text: body, imageUrl: image, status: 'failed', error: reason });
      results.push({ playerId: player.id, tag: player.discord_tag, ok: false, error: reason });
    }
  }
  return results;
}

// A DM to Grimbold (messageCreate). Kept when Głos has written to that person.
function handleDirectMessage(message) {
  if (!message || message.guild || message.guildId || !message.author || message.author.bot) return false;
  const discordId = message.author.id;
  if (!db.hasGlosConversation(discordId)) return false;
  const attachments = message.attachments ? [...message.attachments.values()].map(file => file.url) : [];
  const text = [String(message.content || ''), ...attachments].filter(Boolean).join('\n').slice(0, MAX_REPLY_SAVED);
  if (!text) return false;
  const player = db.glosPlayerByDiscordId(discordId);
  db.recordGlosMessage({ playerId: player ? player.id : null, discordId, direction: 'in', text, discordMessageId: message.id });
  return true;
}

module.exports = { setGlosClient, sendGlos, handleDirectMessage, glosEmbed, MAX_TEXT };
