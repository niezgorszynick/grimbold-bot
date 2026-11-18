// npcVoice.js — A DM speaks as a Notable NPC from its voice page (the NPCs
// tab): in the speak channel or an adventure thread, under the NPC's name and
// portrait (a webhook, adventureThreads.js), or privately in chosen players'
// Discord DMs. Grimbold delivers those, as an embed under the NPC's name and
// portrait in the NPC's colour. What a player writes back to Grimbold's DMs
// goes to the last NPC that wrote to them (db/npcVoice.js).

'use strict';

const db = require('./db');
const threads = require('./adventureThreads');
const voiceBot = require('./voiceBot');

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

  // The NPC with the voice bot writes as itself (plain text); others as Grimbold's card.
  const viaBot = db.getVoiceBotSettings().npcId === npc.id;
  const limit = viaBot ? MAX_CHANNEL : MAX_DM;
  if (body.length > limit) throw new Error(`Too long: ${body.length} characters (Discord takes ${limit}).`);
  const ids = [...new Set([].concat(playerIds || []).map(Number).filter(Number.isSafeInteger))];
  if (!ids.length) throw new Error('Choose who gets it.');
  if (viaBot) {
    if (!voiceBot.voiceBotStatus().ready) throw new Error(`${npc.name}'s bot is not connected to Discord right now.`);
  } else if (!client || !client.isReady || !client.isReady()) {
    throw new Error('Grimbold is not connected to Discord right now.');
  }
  if (!viaBot) db.setNpcVoiceColor(npc.id, color);
  const embed = viaBot ? null : dmEmbed(npc, body, color);
  const recipients = db.getVoiceRecipients();
  const results = [];
  for (const id of ids) {
    const player = recipients.find(entry => entry.id === id);
    if (!player) {
      results.push({ label: `#${id}`, ok: false, error: 'no such player' });
      continue;
    }
    const record = extra => db.recordNpcVoice({ npcId: npc.id, direction: 'out', target: 'dm', via: viaBot ? 'bot' : 'grimbold', playerId: player.id, discordId: player.discord_id, text: body, sentBy, ...extra });
    try {
      const sent = viaBot
        ? await voiceBot.sendAsVoiceBot(player.discord_id, body)
        : await (await client.users.fetch(player.discord_id)).send({ embeds: [embed], allowedMentions: { parse: [] } });
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

// A player's DM, kept for the NPC it answers.
function keepReply(message, via, npcIdFor) {
  if (!message || message.guild || message.guildId || !message.author || message.author.bot) return false;
  const discordId = String(message.author.id);
  const npcId = npcIdFor(discordId);
  if (!npcId || !db.prepare('SELECT 1 FROM npcs WHERE id = ?').get(npcId)) return false;
  const attachments = message.attachments ? [...message.attachments.values()].map(file => file.url) : [];
  const text = [String(message.content || ''), ...attachments].filter(Boolean).join('\n').slice(0, MAX_REPLY_SAVED);
  if (!text) return false;
  const player = db.prepare('SELECT id FROM players WHERE discord_id = ?').get(discordId);
  db.recordNpcVoice({ npcId, direction: 'in', target: 'dm', via, playerId: player ? player.id : null, discordId, text, discordMessageId: message.id ? String(message.id) : null });
  return true;
}

// A DM to Grimbold: for the last NPC whose card he delivered to them.
const handleDirectMessage = message => keepReply(message, 'grimbold', discordId => db.lastNpcToDm(discordId, 'grimbold'));

// A DM to the voice bot: for the last NPC it spoke for to them, else the one it speaks for now.
const handleBotDirectMessage = message => keepReply(message, 'bot', discordId => db.lastNpcToDm(discordId, 'bot') || db.getVoiceBotSettings().npcId);

// ─── The voice bot (voiceBot.js) ────────────────────────────────────────────

// Who may link, rename or re-avatar it: anyone while it speaks for nobody;
// then the DM of the NPC it speaks for, and the Root DM.
function canManageVoiceBot(user) {
  if (!user || user.role !== 'admin') return false;
  const { npcId } = db.getVoiceBotSettings();
  if (!npcId) return true;
  if (Number(user.id) === 0) return true;
  const linked = db.prepare('SELECT * FROM npcs WHERE id = ?').get(npcId);
  return !linked || (db.canSeeNpc(linked, user) && linked.owner_player_id === Number(user.id));
}

// The voice bot as one NPC's page shows it. Another NPC's bot is mentioned
// only to those who may see that NPC.
function voiceBotView(npc, user) {
  const status = voiceBot.voiceBotStatus();
  if (!status.configured) return { configured: false };
  const settings = db.getVoiceBotSettings();
  const linked = settings.npcId ? db.prepare('SELECT * FROM npcs WHERE id = ?').get(settings.npcId) : null;
  const linkedHere = Boolean(linked && linked.id === npc.id);
  return {
    ...status,
    linkedHere,
    linkedTo: linked && !linkedHere ? (db.canSeeNpc(linked, user) ? linked.name : 'another NPC') : null,
    canManage: canManageVoiceBot(user),
    renamedAt: settings.renamedAt,
    avatarAt: settings.avatarAt,
    hasPortrait: Boolean(npc.portrait_file)
  };
}

const BOT_NAME = /^[^@#:`]{2,32}$/;

// { npcId, user, action: 'link' | 'unlink' | 'rename' | 'avatar', name }.
async function manageVoiceBot({ npcId, user, action, name }) {
  const npc = voiceNpc(npcId, user);
  if (!voiceBot.voiceBotStatus().configured) throw new Error('There is no voice bot: put its token in VOICE_BOT_TOKEN on the server and restart.');
  if (!canManageVoiceBot(user)) throw new Error('The voice bot speaks for another DM\'s NPC.');
  const settings = db.getVoiceBotSettings();
  if (action === 'link') {
    db.setVoiceBotSettings({ npcId: npc.id });
  } else if (action === 'unlink') {
    if (settings.npcId === npc.id) db.setVoiceBotSettings({ npcId: null });
  } else if (action === 'rename' || action === 'avatar') {
    if (settings.npcId !== npc.id) throw new Error(`The voice bot doesn't speak for ${npc.name}: link it first.`);
    try {
      if (action === 'rename') {
        const clean = String(name || '').trim();
        if (!BOT_NAME.test(clean) || /discord|clyde|everyone|here/i.test(clean)) throw new Error('A bot name is 2 to 32 characters, without @ # : ` and not "discord", "clyde", "everyone" or "here".');
        await voiceBot.renameVoiceBot(clean);
        db.setVoiceBotSettings({ renamedAt: new Date().toISOString() });
      } else {
        const file = db.getNpcFile({ npcId: npc.id, kind: 'portrait' });
        if (!file) throw new Error(`${npc.name} has no portrait: upload one on the NPC form first.`);
        await voiceBot.setVoiceBotAvatar(require('fs').readFileSync(file.file));
        db.setVoiceBotSettings({ avatarAt: new Date().toISOString() });
      }
    } catch (error) {
      // Discord's own limit: say so plainly.
      if (error && (error.status === 429 || error.name === 'RateLimitError' || (error.timeToReset !== undefined) || (error.code === 50035 && /too fast|rate/i.test(error.message)))) throw new Error('Discord says it changed too recently: try again later (about two changes an hour).');
      throw error;
    }
  } else {
    throw new Error('Unknown action.');
  }
  return voiceBotView(npc, user);
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
    limits: { dm: MAX_DM, channel: MAX_CHANNEL },
    voiceBot: voiceBotView(npc, user)
  };
}

module.exports = { setNpcVoiceClient, sendNpcVoice, handleDirectMessage, handleBotDirectMessage, manageVoiceBot, voicePage, dmEmbed, DEFAULT_COLOR };
