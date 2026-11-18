// voiceBot.js — The voice bot: a second Discord bot (VOICE_BOT_TOKEN) that
// speaks for one Notable NPC (Głos) in players' DMs, under its own name and
// avatar instead of Grimbold's. It stays invisible (offline in the member
// list), has no permissions in the server and only handles DMs: sending the
// NPC's messages and passing the players' replies to the voice page
// (npcVoice.js). Its name and avatar can be changed from the panel; Discord
// allows only a couple of name changes an hour, and every message the bot
// ever sent shows the new ones.

'use strict';

const { Client, GatewayIntentBits, Partials } = require('discord.js');

let client = null;

const token = () => String(process.env.VOICE_BOT_TOKEN || '').trim();

function startVoiceBot() {
  if (!token() || client) return;
  client = new Client({
    intents: [GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
    // A name or avatar change over Discord's limit fails at once (the panel
    // says so) instead of waiting, maybe an hour, for the limit to pass.
    rest: { rejectOnRateLimit: info => String((info && (info.route || info.url)) || '').includes('/users/@me') }
  });
  client.once('clientReady', () => {
    // Offline in the member list.
    try { client.user.setPresence({ status: 'invisible' }); } catch (error) { /* not fatal */ }
    console.log(`🗣  Voice bot ${client.user.tag} is listening (invisible).`);
  });
  client.on('messageCreate', message => {
    try {
      require('./npcVoice').handleBotDirectMessage(message);
    } catch (error) {
      console.warn('Could not keep a reply to the voice bot:', error.message);
    }
  });
  client.login(token()).catch(error => console.warn(`The voice bot could not log in: ${error.message}`));
}

const isReady = () => Boolean(client && typeof client.isReady === 'function' && client.isReady());

// What the panel shows: whether it's set up and connected, its name and avatar.
function voiceBotStatus() {
  const user = isReady() ? client.user : null;
  return {
    configured: Boolean(token()) || Boolean(client),
    ready: Boolean(user),
    id: user ? user.id : null,
    name: user ? (user.globalName || user.username) : null,
    avatarURL: user && typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ size: 128 }) : null
  };
}

function requireReady() {
  if (!isReady()) throw new Error(token() || client ? 'The voice bot is not connected to Discord right now.' : 'There is no voice bot: put its token in VOICE_BOT_TOKEN on the server and restart.');
  return client;
}

// A DM from the bot: plain text, as the bot itself.
async function sendAsVoiceBot(discordId, content) {
  const user = await requireReady().users.fetch(String(discordId));
  return user.send({ content, allowedMentions: { parse: [] } });
}

async function renameVoiceBot(name) {
  await requireReady().user.edit({ username: name });
  return voiceBotStatus();
}

async function setVoiceBotAvatar(buffer) {
  await requireReady().user.edit({ avatar: buffer });
  return voiceBotStatus();
}

function setVoiceBotClientForTests(fake) {
  client = fake;
}

module.exports = { startVoiceBot, voiceBotStatus, sendAsVoiceBot, renameVoiceBot, setVoiceBotAvatar, setVoiceBotClientForTests };
