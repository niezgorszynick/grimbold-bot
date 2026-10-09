// index.js — main entry point for Grimbold the Shopkeeper Bot

require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const app = express();
const adminRouter = require('./server');
const webShopApiRouter = require('./webShopApi');
const db = require('./db');

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

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin');

  const error = req.query.error
    ? '<div class="alert alert-danger py-2 small mb-3">Invalid username or password.</div>'
    : '';
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Grimbold's Vault — Login</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body { background-color: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .login-card { background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; width: 100%; max-width: 400px; padding: 2rem; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
      </style>
    </head>
    <body>
      <main class="login-card">
        <div class="text-center mb-4">
          <h3 class="fw-bold text-warning mb-1">Grimbold's Vault</h3>
          <p class="text-muted small">Campaign Hub &amp; Provisions</p>
        </div>
        ${error}
        <form method="POST" action="/login">
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
      </main>
    </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
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
    ? { id: 0, discord_tag: 'Root DM', role: 'admin' }
    : db.authenticatePlayer(username, password);
  if (!user) return res.redirect('/login?error=1');

  req.session = null;
  req.session = { user };
  return res.redirect('/admin');
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// DM Panel route
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

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.commands = new Collection();

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
  console.log(`✅ Loaded command: /${command.data.name}`);
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once('ready', () => {
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

  if (!interaction.isChatInputCommand()) return;

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