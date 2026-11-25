// index.js — main entry point for Grimbold the Shopkeeper Bot

require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const app = express();
const adminRouter = require('./server');
const webShopApiRouter = require('./webShopApi');
const db = require('./db');
const { ROOT_ADMIN } = require('./auth');
const { authPage, changePasswordRouter } = require('./changePassword');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
}

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
  name: 'grimbold_auth',
  keys: [sessionSecret],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production'
}));

// Where login leads: the panel link that sent the player here, otherwise What's new.
const START_PAGE = '/admin?tab=changelog';
function loginTarget(next) {
  return typeof next === 'string' && /^\/admin(?:[/?#]|$)/.test(next) ? next : START_PAGE;
}
const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect(loginTarget(req.query.next));
  const next = loginTarget(req.query.next) === START_PAGE ? '' : req.query.next;

  const error = req.query.error
    ? '<div class="alert alert-danger py-2 small mb-3">Invalid username or password.</div>'
    : req.query.changed ? '<div class="alert alert-success py-2 small mb-3">Password changed. Log in with the new one.</div>' : '';
  res.send(authPage('Login', `
        ${error}
        <form method="POST" action="/login">
          ${next ? `<input type="hidden" name="next" value="${escapeAttr(next)}">` : ''}
          <div class="mb-3">
            <label for="username" class="form-label text-light small fw-bold">Discord Tag</label>
            <input id="username" type="text" name="username" class="form-control bg-dark text-light border-secondary" placeholder="e.g. alastar" autocomplete="username" required autofocus>
          </div>
          <div class="mb-3">
            <label for="password" class="form-label text-light small fw-bold">Password</label>
            <input id="password" type="password" name="password" class="form-control bg-dark text-light border-secondary" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-warning w-100 fw-bold">Enter the Realm</button>
        </form>
        <p class="text-center small mt-3 mb-0"><a href="/change-password" class="link-warning">Change password</a></p>
  `));
});

// Change password (from the login page, or signed in): changePassword.js.
app.use(changePasswordRouter({ startPage: START_PAGE }));

app.post('/login', (req, res) => {
  const { username, password, next } = req.body || {};
  const configuredAdminPassword = process.env.ADMIN_PASSWORD;
  const passwordBytes = typeof password === 'string' ? Buffer.from(password) : null;
  const configuredPasswordBytes = typeof configuredAdminPassword === 'string'
    ? Buffer.from(configuredAdminPassword)
    : null;
  const isEmergencyAdminLogin = typeof username === 'string' &&
    username.trim().toLowerCase() === 'admin' &&
    passwordBytes !== null &&
    configuredPasswordBytes !== null &&
    passwordBytes.length === configuredPasswordBytes.length &&
    crypto.timingSafeEqual(passwordBytes, configuredPasswordBytes);

  const user = isEmergencyAdminLogin
    ? ROOT_ADMIN
    : db.authenticatePlayer(username, password);
  if (!user) {
    const target = loginTarget(next);
    return res.redirect('/login?error=1' + (target === START_PAGE ? '' : '&next=' + encodeURIComponent(target)));
  }

  req.session = null;
  req.session = { user };
  return res.redirect(loginTarget(next));
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// News pages for players (public/news/*.html, e.g. /news/shop-update): public,
// so a Discord link works without a panel login.
app.use('/news', express.static(require('path').join(__dirname, 'public', 'news'), { extensions: ['html'], index: false }));

// NPC portraits as webhook avatars: Discord fetches these without a login
// (an NPC speaking in an adventure thread, see adventureThreads.js).
app.get('/avatars/npc/:file', (req, res) => {
  const found = db.getNpcPortraitByName(req.params.file);
  if (!found) return res.status(404).end();
  res.set({ 'Content-Type': found.contentType, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  return res.sendFile(found.file);
});
// The same for characters a player speaks as.
app.get('/avatars/character/:file', (req, res) => {
  const found = db.getCharacterPortraitByName(req.params.file);
  if (!found) return res.status(404).end();
  res.set({ 'Content-Type': found.contentType, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  return res.sendFile(found.file);
});

// DM Panel route
// The Owlbear Rodeo extension (public, works without a panel login).
app.use('/vtt', require('./vtt'));
// Personal calendar feeds of adventure sessions (public; the token is the secret).
app.use('/calendar', require('./calendar'));
app.use('/api', webShopApiRouter);
app.use('/admin', adminRouter);

// Health check endpoint
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => {
  res.send('Grimbold is awake and tending the shop!');
});

app.listen(PORT, () => {
  console.log(`🌐 Health check web server & Admin Panel listening on port ${PORT}`);
});

const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
  // DirectMessages (and the Channel partial, as DM channels are not cached):
  // players' replies to NPCs who wrote to them (npcVoice.js).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

client.commands = new Collection();

// New threads in the adventures channel open adventures in the panel.
require('./adventureThreads').registerAdventureThreads(client);
// Grimbold's notes (purchases, purse changes) in each character's thread.
require('./characterThreads').setCharacterThreadsClient(client);
// Google Docs about characters shared in the docs channel (Chronicles tab).
require('./chronicles').setChroniclesClient(client);
// Art posted in the art channel, tagged with its characters (Art tab, art.js).
require('./art').setArtClient(client);
// Docs and art about characters without a sheet, from their own two channels (Legends tab).
require('./legends').setLegendsClient(client);
// Natural 1s and 20s from every source, in one channel (NAT_ROLLS_CHANNEL_ID).
require('./naturalRolls').setNaturalRollsClient(client);
// Session changes made in the panel are announced in the adventure's thread.
require('./scheduleDiscord').setScheduleClient(client);
// Auction news (listings, bids, results) and settling auctions that are due.
require('./auctionNews').setAuctionNewsClient(client);
// Login details DMed to players without a password (Players → Passwords & Roles).
require('./loginInvites').setLoginInvitesClient(client);
// NPC voices: DMs to players as an NPC, and the players' replies (npcVoice.js).
require('./npcVoice').setNpcVoiceClient(client);
// An NPC's own bot for its DMs (Głos), if VOICE_BOT_TOKEN is set (voiceBot.js).
require('./voiceBot').startVoiceBot();
client.on('messageCreate', message => {
  try {
    require('./npcVoice').handleDirectMessage(message);
  } catch (error) {
    console.warn('Could not keep a reply to an NPC:', error.message);
  }
});
// Resident artisans who deliver on their own days, announced in the shop channel.
require('./artisanDeliveries').startArtisanDeliveries();

// ─── Load all commands from /commands folder ──────────────────────────────────

const commandsDir   = path.join(__dirname, 'commands');
const commandFiles  = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsDir, file));
  if (!command.data || !command.execute) {
    console.warn(`[WARN] ${file} is missing data or execute — skipping.`);
    continue;
  }
  client.commands.set(command.data.name, command);
  console.log(`✅ Loaded command: ${command.data.type === 3 ? '' : '/'}${command.data.name}`);
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once('clientReady', () => {
  // Session reminders a day before (scheduleDiscord.js).
  require('./scheduleDiscord').startScheduleReminders(client);
  console.log(`\n🏪  ${client.user.tag} is open for business! (SQLite Backend Active)\n`);
});

// ─── Slash command handler ────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  // Handle autocompletions
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`[ERROR] Autocomplete for /${interaction.commandName}:`, error);
    }
    return;
  }

  // Scheduling: the poll buttons and the DM's lock-in menu (scheduleDiscord.js).
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('sched:')) {
    await require('./scheduleDiscord').handleScheduleInteraction(interaction);
    return;
  }

  // Tag art: the menu's selects and buttons (art.js).
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('art:')) {
    await require('./art').handleArtInteraction(interaction).catch(error => console.error('[ERROR] Tag art:', error));
    return;
  }

  // Slash commands, and right-click commands on a message (Tag art).
  if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[ERROR] /${interaction.commandName}:`, error);
    const errorMsg = {
      content: '*Grimbold scratches his head.* "Something went wrong. Try again in a moment."',
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg).catch(() => {});
    } else {
      await interaction.reply(errorMsg).catch(() => {});
    }
  }
});

// Without a token (local development) only the web panel runs.
if (process.env.DISCORD_TOKEN) {
  client.login(process.env.DISCORD_TOKEN);
} else {
  console.warn('⚠️  DISCORD_TOKEN is not set: running the web panel only, Discord bot is offline.');
}