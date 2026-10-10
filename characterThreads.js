// characterThreads.js — Grimbold's notes in each character's thread in the
// character channel (🧝┆soh-postaci): purchases and purse changes.
//
// A character's thread is the one stored on the character (an admin can set
// it on the Players tab). Otherwise Grimbold looks for a thread whose name has
// the character's name, then for the player's only thread there, and stores
// what he finds. Without a thread (or without the bot) nothing is posted.

'use strict';

const db = require('./db');
const { formatCp } = require('./currency');

// Discord's Embed Links permission (1 << 14).
const EMBED_LINKS = 16384n;

// 🧝┆soh-postaci — override with CHARACTER_THREADS_CHANNEL_ID.
const DEFAULT_CHANNEL_ID = '1505600851039752414';

let client = null;

function channelId() {
  return process.env.CHARACTER_THREADS_CHANNEL_ID || DEFAULT_CHANNEL_ID;
}

// "Qual'danis Éversong" → "qualdanis eversong"
function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

// threads: [{ id, name, ownerId }]. Returns the best thread for the character, or null.
function chooseThread(threads, { name, playerDiscordId }) {
  const full = normalize(name);
  if (!full) return null;
  const first = full.split(' ')[0];
  const byName = threads.filter(thread => normalize(thread.name).includes(full));
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return byName.find(thread => thread.ownerId === playerDiscordId) || null;
  const owned = threads.filter(thread => playerDiscordId && thread.ownerId === playerDiscordId);
  if (owned.length === 1) return owned[0];
  // Several threads of the same player: the one with the character's first name.
  const byFirstName = owned.filter(thread => first.length >= 3 && normalize(thread.name).split(' ').includes(first));
  return byFirstName.length === 1 ? byFirstName[0] : null;
}

async function channelThreads() {
  const channel = await client.channels.fetch(channelId()).catch(() => null);
  if (!channel || !channel.threads) return [];
  const active = await channel.threads.fetchActive().catch(() => null);
  const archived = await channel.threads.fetchArchived({ limit: 100 }).catch(() => null);
  const all = new Map();
  for (const list of [active, archived]) {
    if (list && list.threads) list.threads.forEach(thread => all.set(thread.id, thread));
  }
  return [...all.values()];
}

// The Discord thread of a character, found and remembered if needed.
async function threadForCharacter(characterId) {
  const character = db.prepare(`
    SELECT c.id, c.name, c.discord_thread_id, p.discord_id
    FROM characters c JOIN players p ON p.id = c.player_id WHERE c.id = ?
  `).get(Number(characterId));
  if (!character) return null;
  if (character.discord_thread_id) {
    const stored = await client.channels.fetch(character.discord_thread_id).catch(() => null);
    if (stored && typeof stored.send === 'function') return stored;
  }
  const threads = await channelThreads();
  const thread = chooseThread(threads.map(entry => ({ id: entry.id, name: entry.name, ownerId: entry.ownerId, entry })), {
    name: character.name, playerDiscordId: character.discord_id
  });
  if (!thread) {
    console.warn(`No thread found for ${character.name} in channel ${channelId()}; set it on the Players tab.`);
    return null;
  }
  db.prepare('UPDATE characters SET discord_thread_id = ? WHERE id = ?').run(thread.id, character.id);
  return thread.entry;
}

// Embeds need the Embed Links permission; without it Discord drops them and
// refuses the (then empty) message, so Grimbold writes plain text instead.
function canEmbed(thread) {
  if (!client || !client.user || typeof thread.permissionsFor !== 'function') return true;
  const permissions = thread.permissionsFor(client.user);
  return !permissions || permissions.has(EMBED_LINKS);
}

// Returns { ok, reason, thread } — reason says why nothing was posted.
async function postToCharacterThread(characterId, message) {
  if (!client || (typeof client.isReady === 'function' && !client.isReady())) {
    console.warn(`Discord bot is not connected; no note posted for character ${characterId}.`);
    return { ok: false, reason: 'The Discord bot is not connected.' };
  }
  try {
    const thread = await threadForCharacter(characterId);
    if (!thread) return { ok: false, reason: 'No Discord thread found for this character: set it on the Players tab.' };
    const { text, ...payload } = message;
    const body = canEmbed(thread) || !text ? payload : { content: text };
    await thread.send({ ...body, allowedMentions: { parse: [] } });
    return { ok: true, thread: thread.name };
  } catch (error) {
    console.warn(`Could not post to the thread of character ${characterId}: ${error.message}`);
    return { ok: false, reason: `Discord refused the message: ${error.message}` };
  }
}

// ─── Grimbold's notes ───────────────────────────────────────────────────────

function purchaseMessage(result, buyerTag) {
  const quantity = result.quantity > 1 ? ` ×${result.quantity}` : '';
  const each = result.quantity > 1 ? ` (${formatCp(result.finalUnitPriceCp)} each)` : '';
  const roll = result.discountPercent < 0
    ? ` — ${Math.abs(result.discountPercent)}% off for the weekly roll`
    : result.discountPercent > 0 ? ` — ${result.discountPercent}% surcharge for the weekly roll` : '';
  return {
    text: `🪙 *Grimbold notes a purchase for ${result.character.name}:* **${result.item.name}**${quantity} for **${formatCp(result.totalCostCp)}**${each}${roll}. Purse left: **${formatCp(result.character.gold_cp)}**.`,
    embeds: [{
      title: '🪙 Grimbold notes a purchase',
      color: 0xd4af37,
      description: `*Grimbold licks his thumb and turns the ledger to ${result.character.name}'s page.*`,
      fields: [
        { name: 'Item', value: `**${result.item.name}**${quantity}`, inline: true },
        { name: 'Cost', value: `**${formatCp(result.totalCostCp)}**${each}${roll}`, inline: true },
        { name: 'Purse left', value: `**${formatCp(result.character.gold_cp)}**`, inline: true }
      ],
      footer: { text: buyerTag ? `Bought by ${buyerTag}` : "Grimbold's Emporium" },
      timestamp: new Date().toISOString()
    }]
  };
}

function goldChangeMessage(change) {
  const difference = change.new_cp - change.old_cp;
  const who = change.changed_by_admin
    ? `the DM${change.changed_by_tag ? ` (${change.changed_by_tag})` : ''}`
    : change.changed_by_tag || 'the player';
  const sign = difference > 0 ? '+' : '−';
  return {
    text: `${difference > 0 ? '💰' : '💸'} *Grimbold amends ${change.character_name}'s page:* ${formatCp(change.old_cp)} → **${formatCp(change.new_cp)}** (${sign}${formatCp(Math.abs(difference))}). Reason: ${change.reason || 'none given'}. Changed by ${who}.`,
    embeds: [{
      title: difference > 0 ? '💰 Purse grows' : '💸 Purse shrinks',
      color: difference > 0 ? 0x23a55a : 0xf0b232,
      description: `*Grimbold peers over his spectacles and amends ${change.character_name}'s page.*`,
      fields: [
        { name: 'Before', value: formatCp(change.old_cp), inline: true },
        { name: 'Now', value: `**${formatCp(change.new_cp)}**`, inline: true },
        { name: 'Change', value: `${difference > 0 ? '+' : '−'}${formatCp(Math.abs(difference))}`, inline: true },
        { name: 'Reason', value: change.reason || '*none given*', inline: false }
      ],
      footer: { text: `Changed by ${who}` },
      timestamp: new Date().toISOString()
    }]
  };
}

// Never throws, and a slow Discord never holds up a purchase: callers may
// wait for the result (to show it) or ignore it.
function announcePurchase(result, { buyerTag } = {}) {
  return postToCharacterThread(result.character.id, purchaseMessage(result, buyerTag))
    .catch(error => ({ ok: false, reason: error.message }));
}

function announceGoldChange(change) {
  if (!change) return Promise.resolve({ ok: false, reason: 'Nothing changed.' });
  return postToCharacterThread(change.character_id, goldChangeMessage(change))
    .catch(error => ({ ok: false, reason: error.message }));
}

// Waits at most `ms` for an announcement; after that the panel moves on and
// the note still goes out in the background.
function withinTime(promise, ms = 4000) {
  return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ ok: null, reason: 'Discord is slow; the note will follow.' }), ms))]);
}

function setCharacterThreadsClient(discordClient) {
  client = discordClient;
}

module.exports = {
  setCharacterThreadsClient,
  chooseThread,
  postToCharacterThread,
  announcePurchase,
  announceGoldChange,
  withinTime,
  purchaseMessage,
  goldChangeMessage
};
