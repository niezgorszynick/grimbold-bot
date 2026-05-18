// deploy-commands.js — registers slash commands with Discord (run once, or on changes)
// Usage: node deploy-commands.js

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const commands = [];
const commandsDir = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`Queued: /${command.data.name}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\nRegistering ${commands.length} slash commands to guild ${process.env.GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅  All slash commands registered successfully!\n');
  } catch (err) {
    console.error('❌  Failed to register commands:', err);
  }
})();
