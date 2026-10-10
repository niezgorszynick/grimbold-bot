// scripts/check-character-thread.js — Why does (or doesn't) Grimbold post in a
// character's thread? Shows the bot's permissions in the character channel,
// the threads there, and which one Grimbold picks for the character.
//
//   node scripts/check-character-thread.js "Character Name"          (look only)
//   node scripts/check-character-thread.js "Character Name" --send   (post a test note)
//
// Uses DISCORD_TOKEN from .env. Safe to run while the bot is running.

'use strict';

require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const threads = require('../characterThreads');

const name = process.argv[2];
const send = process.argv.includes('--send');
const channelId = process.env.CHARACTER_THREADS_CHANNEL_ID || '1505600851039752414';

if (!name) {
  console.log('Usage: node scripts/check-character-thread.js "Character Name" [--send]');
  process.exit(1);
}
if (!process.env.DISCORD_TOKEN) {
  console.log('✖ DISCORD_TOKEN is not set in .env: the bot cannot post anything.');
  process.exit(1);
}

const character = db.prepare(`
  SELECT c.id, c.name, c.discord_thread_id, p.discord_tag, p.discord_id
  FROM characters c JOIN players p ON p.id = c.player_id
  WHERE c.name = ? COLLATE NOCASE
`).get(name);
if (!character) {
  console.log(`✖ No character called "${name}" in the database.`);
  process.exit(1);
}
console.log(`Character: ${character.name} (id ${character.id}), player ${character.discord_tag}, Discord ID ${character.discord_id || '— none (the player has no Discord ID in the panel)'}`);
console.log(`Stored thread: ${character.discord_thread_id || '— none yet'}`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    console.log(`\nLogged in as ${client.user.tag}.`);
    const channel = await client.channels.fetch(channelId).catch(error => {
      console.log(`✖ Cannot open channel ${channelId}: ${error.message}`);
      return null;
    });
    if (!channel) return;
    console.log(`Channel: #${channel.name} (${channel.type === 15 ? 'forum' : 'text channel'})`);

    const permissions = channel.permissionsFor(client.user);
    for (const [label, flag] of [
      ['View Channel', PermissionFlagsBits.ViewChannel],
      ['Read Message History', PermissionFlagsBits.ReadMessageHistory],
      ['Send Messages in Threads', PermissionFlagsBits.SendMessagesInThreads],
      ['Manage Threads (needed for private threads)', PermissionFlagsBits.ManageThreads]
    ]) {
      console.log(`  ${permissions && permissions.has(flag) ? '✔' : '✖'} ${label}`);
    }

    const active = await channel.threads.fetchActive().catch(() => null);
    const archived = await channel.threads.fetchArchived({ limit: 100 }).catch(() => null);
    const list = new Map();
    for (const result of [active, archived]) if (result) result.threads.forEach(thread => list.set(thread.id, thread));
    console.log(`\nThreads the bot can see (${list.size}):`);
    for (const thread of list.values()) {
      console.log(`  ${thread.id}  "${thread.name}"  owner ${thread.ownerId}${thread.archived ? '  (archived)' : ''}${thread.ownerId === character.discord_id ? '  ← this player' : ''}`);
    }

    const chosen = threads.chooseThread([...list.values()].map(thread => ({ id: thread.id, name: thread.name, ownerId: thread.ownerId })), {
      name: character.name, playerDiscordId: character.discord_id
    });
    console.log(`\nGrimbold would pick: ${chosen ? `"${chosen.name}" (${chosen.id})` : '✖ nothing — set the thread link on the Players tab (Edit Character → Discord thread)'}`);
    if (character.discord_thread_id) {
      const stored = await client.channels.fetch(character.discord_thread_id).catch(error => {
        console.log(`✖ The stored thread ${character.discord_thread_id} cannot be opened: ${error.message}`);
        return null;
      });
      if (stored) console.log(`The stored thread is used first: "${stored.name}".`);
    }

    if (send) {
      threads.setCharacterThreadsClient(client);
      const ok = await threads.postToCharacterThread(character.id, { content: '🪙 *Grimbold taps the ledger.* Just checking this page is yours. (test message)' });
      console.log(ok ? '\n✔ Test message posted.' : '\n✖ Test message NOT posted (see the warning above).');
    }
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.log(`✖ Could not log in to Discord: ${error.message}`);
  process.exit(1);
});
