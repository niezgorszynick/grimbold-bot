// adventureThreads.js — Discord threads in the adventures channel become
// active adventures in the panel (see db/activeAdventures.js). Grimbrandt,
// Grimbold's nosey brother and keeper of the family chronicle, speaks for
// this part through a webhook: he greets new adventures, records how they
// ended, and tags finished threads [ZAMKNIĘTE] (cancelled ones [ANULOWANE]).

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');

// ❗┆zlecenia — override with ADVENTURE_CHANNEL_ID.
const DEFAULT_CHANNEL_ID = '1413015368590426272';
const SINCE_KEY = 'adventure_threads_since';
const PERSONA = 'Grimbrandt';
const CLOSED_TAG = '[ZAMKNIĘTE]';
const CANCELLED_TAG = '[ANULOWANE]';
const STATUS_TAG = /^\s*\[(zamkni[eę]te|anulowane)\]\s*/i;
const THREAD_NAME_LIMIT = 100;

let client = null;
const webhooks = new Map();

function channelId() {
  return process.env.ADVENTURE_CHANNEL_ID || DEFAULT_CHANNEL_ID;
}

function panelLink(adventureId) {
  const base = String(process.env.PANEL_URL || '').replace(/\/+$/, '');
  return base ? `${base}/admin?tab=adventures&table=${adventureId}` : null;
}

// "[ZAMKNIĘTE] Wilki z Doliny" → "Wilki z Doliny" (the panel keeps clean titles).
function stripStatusTag(name) {
  return String(name || '').replace(STATUS_TAG, '').trim();
}

const pick = lines => lines[Math.floor(Math.random() * lines.length)];

// ─── Grimbrandt's lines ─────────────────────────────────────────────────────

function openingMessage(adventure, thread) {
  const title = `**${adventure.title}**`;
  const dm = thread.ownerId ? `<@${thread.ownerId}>` : 'whoever is leading this';
  const link = panelLink(adventure.id);
  const greeting = pick([
    `*A wiry dwarf with ink-stained fingers squeezes past the others, quill already scratching.* Grimbrandt — Grimbold's brother, keeper of the family chronicle. ${title}, is it? Where to? Who's paying, and how much? I want every detail!`,
    `*Grimbrandt slams a ledger twice the size of his brother's on the table.* A new job! ${title}! Tell me everything — the client, the danger, the rumours. Especially the rumours.`,
    `*Grimbrandt appears at your elbow as if he'd been there all along.* Did someone say ${title}? Grimbold sells you the rope; I write down what you hanged yourselves with. Who's going, then?`
  ]);
  const ask = link
    ? `${dm}, write your company into my book, so no hero goes unrecorded: ${link}`
    : `${dm}, mind you tell me who's going — no hero goes unrecorded in my book.`;
  return `${greeting}\n${ask}`;
}

function finishedMessage(adventure, party) {
  const names = party.map(member => member.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'nobody';
  return pick([
    `*Grimbrandt licks his quill and turns a fresh page.* So **${adventure.title}** is done! ${list} — ${adventure.xp_awarded} XP each, written in ink, can't be undone. Now: which of you will tell me what *really* happened in there? I've heard things.`,
    `*Grimbrandt blows on the wet ink.* **${adventure.title}**, closed. Into the chronicle go ${list}, ${adventure.xp_awarded} XP apiece. Don't think you're leaving before I hear about the scars.`,
    `*Grimbrandt peers over his spectacles at ${list}.* Back in one piece — mostly? **${adventure.title}** is recorded, ${adventure.xp_awarded} XP each. Sit. Talk. Who screamed first?`
  ]);
}

function cancelledMessage(adventure) {
  return pick([
    `*Grimbrandt sighs and draws a neat line through a page.* No **${adventure.title}** after all? A pity. I'll keep the ink dry for next time.`,
    `*Grimbrandt crosses out a page, muttering.* Cancelled! And I'd sharpened a new quill for **${adventure.title}**. Someone had better owe me a story.`
  ]);
}

function closedTooEarlyMessage(adventure) {
  const link = panelLink(adventure.id);
  return `*Grimbrandt taps the ledger.* Closed, you say? Not in my book it isn't. Finish **${adventure.title}** there, so the heroes get their due${link ? `: ${link}` : '.'}`;
}

// ─── Posting as Grimbrandt ──────────────────────────────────────────────────

// Grimbrandt's picture: assets/grimbrandt.png (or .jpg / .webp) in the project,
// uploaded to Discord once with the webhook; GRIMBRANDT_AVATAR_URL (a public
// image address) overrides it.
function avatarFile() {
  const dir = path.join(__dirname, 'assets');
  return ['grimbrandt.png', 'grimbrandt.jpg', 'grimbrandt.jpeg', 'grimbrandt.webp']
    .map(file => path.join(dir, file)).find(file => fs.existsSync(file)) || null;
}

// Grimbrandt speaks through a webhook on the adventures channel, so he has
// his own name and picture. Without the Manage Webhooks permission the bot
// posts the same words itself.
async function webhookFor(parent) {
  if (!parent || typeof parent.fetchWebhooks !== 'function') return null;
  if (webhooks.has(parent.id)) return webhooks.get(parent.id);
  const avatar = process.env.GRIMBRANDT_AVATAR_URL || avatarFile() || undefined;
  const existing = (await parent.fetchWebhooks()).find(hook => hook.name === PERSONA && (!client || !hook.owner || hook.owner.id === client.user.id));
  let hook = existing;
  if (!hook) {
    hook = await parent.createWebhook({ name: PERSONA, avatar, reason: 'Grimbrandt keeps the adventure chronicle' });
  } else if (!hook.avatar && avatar && typeof hook.edit === 'function') {
    // A picture added after the webhook was made.
    hook = await hook.edit({ avatar, reason: "Grimbrandt's portrait" }).catch(() => hook);
  }
  webhooks.set(parent.id, hook);
  return hook;
}

async function postAsGrimbrandt(thread, content) {
  try {
    const hook = await webhookFor(thread.parent);
    if (hook) {
      await hook.send({ content, threadId: thread.id, username: PERSONA, avatarURL: process.env.GRIMBRANDT_AVATAR_URL || undefined });
      return true;
    }
  } catch (error) {
    console.warn(`Grimbrandt could not use a webhook (${error.message}); posting as the bot.`);
  }
  if (typeof thread.send === 'function') {
    await thread.send({ content }).catch(error => console.warn(`Could not post in thread ${thread.id}: ${error.message}`));
    return true;
  }
  return false;
}

// ─── Threads → adventures ───────────────────────────────────────────────────

// Threads from before this feature was switched on are left alone, so old
// adventures (already recorded by hand) are not opened again.
function trackingSince() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(SINCE_KEY);
  if (row) return Number(row.value);
  const now = Date.now();
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run(SINCE_KEY, String(now));
  return now;
}

// thread: a discord.js ThreadChannel (or anything with the same fields).
async function logAdventureThread(thread, { announce = true } = {}) {
  if (!thread || thread.parentId !== channelId()) return null;
  if (thread.createdTimestamp && thread.createdTimestamp < trackingSince()) return null;
  if (STATUS_TAG.test(thread.name || '')) return null;
  const { adventure, created } = db.createAdventureFromThread({
    threadId: thread.id,
    guildId: thread.guildId,
    title: stripStatusTag(thread.name),
    ownerDiscordId: thread.ownerId
  });
  if (!created) return adventure;
  console.log(`📜 Adventure #${adventure.id} "${adventure.title}" opened from a Discord thread.`);
  // Join the thread, so the bot follows it (renames, archiving) like a member.
  if (thread.joinable && !thread.joined && typeof thread.join === 'function') {
    await thread.join().catch(error => console.warn(`Could not join thread ${thread.id}: ${error.message}`));
  }
  if (announce) await postAsGrimbrandt(thread, openingMessage(adventure, thread));
  return adventure;
}

// Renaming the thread renames a running adventure; adding [ZAMKNIĘTE] by hand
// gets a reminder to finish it in the panel instead.
async function renameAdventureThread(oldThread, newThread) {
  if (!newThread || newThread.parentId !== channelId()) return false;
  if (oldThread && oldThread.name === newThread.name) return false;
  const renamed = db.renameAdventureForThread(newThread.id, stripStatusTag(newThread.name));
  const wasTagged = oldThread && STATUS_TAG.test(oldThread.name || '');
  if (renamed && STATUS_TAG.test(newThread.name || '') && !wasTagged) {
    const adventure = db.prepare('SELECT * FROM adventures WHERE discord_thread_id = ?').get(newThread.id);
    if (adventure) await postAsGrimbrandt(newThread, closedTooEarlyMessage(adventure));
  }
  return renamed;
}

// Called by the panel when an adventure is finished or cancelled: tags the
// thread and lets Grimbrandt have his say. Errors only get logged.
async function announceAdventureEnd(adventureId) {
  if (!client) return false;
  const adventure = db.getAdventureById(adventureId);
  if (!adventure || !adventure.discord_thread_id || adventure.status === 'active') return false;
  const thread = await client.channels.fetch(adventure.discord_thread_id).catch(() => null);
  if (!thread || typeof thread.setName !== 'function') return false;
  const finished = adventure.status === 'completed';
  if (thread.archived && typeof thread.setArchived === 'function') await thread.setArchived(false).catch(() => {});

  const tag = finished ? CLOSED_TAG : CANCELLED_TAG;
  const name = `${tag} ${stripStatusTag(thread.name)}`.slice(0, THREAD_NAME_LIMIT);
  await thread.setName(name, finished ? 'Adventure finished in the panel' : 'Adventure cancelled in the panel')
    .catch(error => console.warn(`Could not rename thread ${thread.id}: ${error.message}`));
  // Forum channels: also apply a matching "Zamknięte" / "Anulowane" tag if there is one.
  const forumTags = thread.parent && Array.isArray(thread.parent.availableTags) ? thread.parent.availableTags : [];
  const forumTag = forumTags.find(entry => (finished ? /zamkni/i : /anulow/i).test(entry.name));
  if (forumTag && typeof thread.setAppliedTags === 'function' && !(thread.appliedTags || []).includes(forumTag.id)) {
    await thread.setAppliedTags([...(thread.appliedTags || []), forumTag.id].slice(0, 5)).catch(() => {});
  }

  const party = finished
    ? db.prepare(`SELECT c.name FROM adventure_rewards r JOIN characters c ON c.id = r.character_id WHERE r.adventure_id = ? ORDER BY r.id`).all(adventure.id)
    : [];
  await postAsGrimbrandt(thread, finished ? finishedMessage(adventure, party) : cancelledMessage(adventure));
  return true;
}

// Threads opened while the bot was offline.
async function catchUpAdventureThreads() {
  trackingSince();
  const channel = await client.channels.fetch(channelId()).catch(() => null);
  if (!channel || !channel.threads) {
    console.warn(`Adventure channel ${channelId()} not found or has no threads; adventures will not be opened from Discord.`);
    return 0;
  }
  const { threads } = await channel.threads.fetchActive();
  let opened = 0;
  for (const thread of threads.values()) {
    const before = db.prepare('SELECT id FROM adventures WHERE discord_thread_id = ?').get(thread.id);
    const adventure = await logAdventureThread(thread);
    if (adventure && !before) opened += 1;
  }
  return opened;
}

function registerAdventureThreads(discordClient) {
  client = discordClient;
  client.on('threadCreate', (thread, newlyCreated) => {
    if (!newlyCreated) return;
    logAdventureThread(thread).catch(error => console.error('[ERROR] Opening an adventure from a thread:', error));
  });
  client.on('threadUpdate', (oldThread, newThread) => {
    renameAdventureThread(oldThread, newThread).catch(error => console.error('[ERROR] Renaming an adventure from a thread:', error));
  });
  client.once('ready', () => {
    catchUpAdventureThreads()
      .then(opened => { if (opened) console.log(`📜 Opened ${opened} adventure(s) from threads started while offline.`); })
      .catch(error => console.error('[ERROR] Catching up adventure threads:', error));
  });
}

// For tests: a stand-in for the Discord client.
function setClientForTests(fake) {
  client = fake;
  webhooks.clear();
}

module.exports = {
  registerAdventureThreads,
  logAdventureThread,
  renameAdventureThread,
  announceAdventureEnd,
  catchUpAdventureThreads,
  stripStatusTag,
  channelId,
  setClientForTests
};
