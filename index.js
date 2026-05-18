// index.js — main entry point for Grimbold the Shopkeeper Bot

require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { initSheets } = require('./sheets');

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

client.once('ready', async () => {
  console.log(`\n🏪  ${client.user.tag} is open for business!`);
  try {
    await initSheets();
    console.log('📊  Google Sheets connected.\n');
  } catch (err) {
    console.error('❌  Failed to connect to Google Sheets:', err.message);
    console.error('    Check GOOGLE_KEY_FILE and SPREADSHEET_ID in your .env\n');
  }
});

// ─── Slash command handler ────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
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

client.login(process.env.DISCORD_TOKEN);
