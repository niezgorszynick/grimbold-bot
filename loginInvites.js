// loginInvites.js — Grimbold DMs each player who has no panel password yet:
// the login link, their username (their Discord username, as stored in
// players.discord_tag), a fresh password and what the panel offers.
// The password is saved only after the DM went through, so a player whose
// DMs are closed keeps no password nobody knows; they are listed for the DM.

'use strict';

const crypto = require('crypto');
const db = require('./db');

let client = null;
function setLoginInvitesClient(discordClient) {
  client = discordClient;
}

// Three words and two digits: easy to type, ~10^8 combinations.
const WORDS = [
  'amber', 'anvil', 'arrow', 'badger', 'barrel', 'beacon', 'bramble', 'candle', 'cellar', 'cinder',
  'cobble', 'copper', 'cricket', 'dagger', 'dragon', 'ember', 'falcon', 'fennel', 'ferret', 'flagon',
  'forge', 'fox', 'gable', 'garnet', 'goblin', 'granite', 'griffin', 'hammer', 'harbor', 'hearth',
  'heron', 'hollow', 'iron', 'ivy', 'jasper', 'juniper', 'kettle', 'lantern', 'lark', 'ledger',
  'lute', 'maple', 'marble', 'meadow', 'mead', 'moss', 'nettle', 'oak', 'otter', 'owl',
  'pebble', 'pewter', 'pine', 'quill', 'raven', 'ribbon', 'river', 'rowan', 'saddle', 'sage',
  'silver', 'sparrow', 'stag', 'stone', 'tankard', 'thistle', 'thorn', 'timber', 'torch', 'tower',
  'troll', 'velvet', 'wagon', 'willow', 'wolf', 'wren', 'yarrow', 'zephyr'
];
function newPassword() {
  const word = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${word()}-${word()}-${word()}-${String(crypto.randomInt(100)).padStart(2, '0')}`;
}

const panelBase = () => String(process.env.PANEL_URL || '').replace(/\/+$/, '');

function inviteMessage({ username, password, base = panelBase() }) {
  const link = base ? `${base}/login` : '(ask the DM for the address)';
  return [
    `Well met, adventurer! Grimbold here. The shop's ledgers have moved onto the panel, and there's a key waiting for you.`,
    ``,
    `🔗 **Log in:** ${link}`,
    `👤 **Username:** \`${username}\` (your Discord username)`,
    `🔑 **Password:** ||\`${password}\`||`,
    ``,
    `**What you'll find there:**`,
    `• **Character Sheet**: HP, rests, spell slots and class features that count themselves; click any bonus to roll it`,
    `• **Speak in Discord**: talk as your character, under their name and portrait`,
    `• **Shop & Auctions**: browse my wares and bid on rare finds`,
    `• **Adventures & Sessions**: the adventure table for your party, and the session schedule (with a calendar link)`,
    `• **Map**: the world as far as your party has explored it`,
    `• **Lineup**: your heroes side by side, to scale`,
    `• **What's new**: the link at the top shows everything added lately`,
    ``,
    `Keep that password to yourself. Change it to one of your own with the **Change password** link (on the login page, or at the top once you're in); if you lose it, ask the DM for a new one.`
  ].join('\n');
}

// Players with no password, oldest first by name.
function playersWithoutPassword() {
  return db.getAllPlayers().filter(player => !player.has_password);
}

// Sends the DMs. Returns { sent: [tag], failed: [{ tag, reason }] }.
async function sendLoginInvites() {
  if (!client || !client.isReady || !client.isReady()) throw new Error('Grimbold is not connected to Discord right now.');
  const sent = [];
  const failed = [];
  for (const player of playersWithoutPassword()) {
    const password = newPassword();
    try {
      const user = await client.users.fetch(player.discord_id);
      await user.send({ content: inviteMessage({ username: player.discord_tag, password }), allowedMentions: { parse: [] } });
    } catch (error) {
      failed.push({ tag: player.discord_tag, reason: error.code === 50007 ? 'their DMs are closed' : error.message });
      continue;
    }
    try {
      db.setPlayerCredentials(player.id, password, player.role === 'admin' ? 'admin' : 'player');
      sent.push(player.discord_tag);
    } catch (error) {
      failed.push({ tag: player.discord_tag, reason: `DM sent, but the password was not saved (${error.message}); set one by hand` });
    }
  }
  return { sent, failed };
}

module.exports = { setLoginInvitesClient, sendLoginInvites, inviteMessage, playersWithoutPassword, newPassword };
