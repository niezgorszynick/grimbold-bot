// legends.js — Reads the two Discord channels behind the Legends tab
// (db/legends.js): one where Google Docs about the legend characters are
// shared, one where their art is posted. Grimbold keeps a copy of every doc
// and image, as he does for Chronicles (chronicles.js) and Art (art.js), whose
// Google and Discord helpers this reuses, but stores them apart.
//
// Both channels are read over the REST API: the latest posts every few
// minutes, the whole history (with threads) when Import is pressed on the
// tab. Nothing is ever posted to either channel.

'use strict';

const db = require('./db');
const chronicles = require('./chronicles');
const art = require('./art');

// Override with LEGENDS_DOCS_CHANNEL_ID / LEGENDS_ART_CHANNEL_ID.
const DEFAULT_DOCS_CHANNEL_ID = '1209112645978816542';
const DEFAULT_ART_CHANNEL_ID = '1201484064578871347';
const POLL_MINUTES = 10;

let client = null;
let running = false;

const docsChannelId = () => process.env.LEGENDS_DOCS_CHANNEL_ID || DEFAULT_DOCS_CHANNEL_ID;
const artChannelId = () => process.env.LEGENDS_ART_CHANNEL_ID || DEFAULT_ART_CHANNEL_ID;

// ─── Docs ───────────────────────────────────────────────────────────────────

// Fetches the doc from Google again and keeps the copy. A doc made private
// keeps the copy Grimbold already has. Returns the doc.
async function refreshLegendDoc(id) {
  const doc = db.getLegendDoc(id);
  if (!doc) throw new Error('Document not found.');
  let copy;
  try {
    copy = await chronicles.fetchDocCopy(doc.doc_key);
  } catch (error) {
    throw new Error(`Google did not answer: ${error.message}`);
  }
  return db.saveLegendDocCopy(doc.id, copy.access === 'public' ? copy : { access: copy.access });
}

const posterOf = message => {
  const author = message.author || {};
  return {
    posterDiscordId: author.id || null,
    posterTag: (message.member && message.member.displayName) || author.globalName || author.username || null,
    postedAt: message.createdAt ? new Date(message.createdAt).toISOString() : null
  };
};

// One message in the docs channel: its doc links recorded. Returns the new docs.
function recordDocMessage(message, threadName) {
  if (message.author && message.author.bot) return [];
  const created = [];
  for (const link of db.extractLegendDocLinks(chronicles.messageText(message))) {
    const result = db.recordLegendDoc({
      key: link.key,
      title: chronicles.embedTitle(message, link.key),
      messageText: message.content || '',
      threadName,
      channelId: message.channelId,
      guildId: message.guildId,
      messageId: message.id,
      ...posterOf(message)
    });
    if (result.created) created.push(result.doc);
  }
  return created;
}

// ─── Images ─────────────────────────────────────────────────────────────────

// Copies of the message's images Grimbold doesn't have yet.
async function keepCopies(message) {
  const attachments = new Map(art.attachmentsOf(message).map(attachment => [String(attachment.id), attachment]));
  for (const image of db.getLegendMessageImages(message.id)) {
    if (image.file) continue;
    const attachment = attachments.get(String(image.attachment_id));
    if (!attachment) { db.saveLegendImageFiles(image.id, { error: 'The image is gone from Discord.' }); continue; }
    if (attachment.size && attachment.size > db.LEGEND_MAX_IMAGE_BYTES) { db.saveLegendImageFiles(image.id, { error: 'Too large to keep (over 25 MB).' }); continue; }
    try {
      const buffer = await art.downloadImage(attachment.url);
      const small = art.thumbUrl(attachment);
      const thumb = small ? await art.downloadImage(small).catch(() => null) : null;
      db.saveLegendImageFiles(image.id, { buffer, thumb });
    } catch (error) {
      db.saveLegendImageFiles(image.id, { error: error.message });
    }
  }
}

// One message in the art channel: its images recorded and copied. Returns the new image ids.
async function recordArtMessage(message, threadName) {
  if (message.author && message.author.bot) return [];
  const attachments = art.attachmentsOf(message);
  if (!attachments.some(db.isLegendImage)) return [];
  const { created } = db.recordLegendImages({
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    threadName: threadName || (message.channel && message.channel.isThread && message.channel.isThread() ? message.channel.name : null),
    text: art.plainText(message),
    attachments,
    ...posterOf(message)
  });
  await keepCopies(message);
  return created;
}

// ─── The channels ───────────────────────────────────────────────────────────

function connected() {
  return client && !(typeof client.isReady === 'function' && !client.isReady());
}

// Every message of a channel and its threads (all), or the latest 50 of each
// place, handed to onMessage. Returns { messages, empty }.
async function readChannel(id, label, { all }, onMessage) {
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel) throw new Error(`Grimbold cannot see the ${label} channel (${id}): give him View Channel and Read Message History there.`);
  const stats = { messages: 0, empty: 0 };
  for (const { source, threadName } of await chronicles.channelSources(channel, { archived: all })) {
    let before;
    for (;;) {
      const batch = await source.messages.fetch({ limit: all ? 100 : 50, before }).catch(() => null);
      if (!batch || !batch.size) break;
      for (const message of batch.values()) {
        if (message.author && message.author.bot) continue;
        stats.messages += 1;
        if (!(message.content || (message.embeds && message.embeds.length) || (message.attachments && message.attachments.size))) stats.empty += 1;
        await onMessage(message, threadName);
      }
      if (!all || batch.size < 100) break;
      before = [...batch.values()].pop().id;
    }
  }
  return stats;
}

// Both channels. Returns { messages, docs, images, contentMissing, errors }:
// one channel failing doesn't stop the other.
async function scanChannels({ all = false } = {}) {
  if (!connected()) throw new Error('The Discord bot is not connected right now.');
  const result = { messages: 0, docs: 0, images: 0, empty: 0, errors: [] };
  const newDocs = [];
  try {
    const stats = await readChannel(docsChannelId(), 'Legends docs', { all }, (message, threadName) => { newDocs.push(...recordDocMessage(message, threadName)); });
    result.messages += stats.messages;
    result.empty += stats.empty;
  } catch (error) {
    result.errors.push(error.message);
  }
  for (const doc of newDocs) {
    await refreshLegendDoc(doc.id).catch(error => console.warn(`Legends: no copy of ${doc.url}: ${error.message}`));
  }
  result.docs = newDocs.length;
  // Docs that have no copy yet (Google was down, the doc was private): a few each time.
  const fresh = new Set(newDocs.map(doc => doc.id));
  for (const id of db.listLegendDocsWithoutCopy(all ? 50 : 5).filter(id => !fresh.has(id))) {
    await refreshLegendDoc(id).catch(error => console.warn(`Legends: no copy of doc ${id}: ${error.message}`));
  }
  try {
    const stats = await readChannel(artChannelId(), 'Legends art', { all }, async (message, threadName) => { result.images += (await recordArtMessage(message, threadName)).length; });
    result.messages += stats.messages;
    result.empty += stats.empty;
  } catch (error) {
    result.errors.push(error.message);
  }
  // Copies that failed before: the message again, for fresh links.
  for (const { message_id: messageId, channel_id: where } of db.listLegendMessagesWithoutFile(all ? 100 : 10)) {
    const place = await client.channels.fetch(where || artChannelId()).catch(() => null);
    const message = place && place.messages ? await place.messages.fetch(messageId).catch(() => null) : null;
    if (message) await keepCopies(message);
  }
  const { empty, ...rest } = result;
  return { ...rest, contentMissing: result.messages > 0 && empty === result.messages };
}

function remember(field, value) {
  db.setLegendsScanStatus({ ...(db.getLegendsScanStatus() || {}), [field]: value });
}

async function runScan({ all = false, by = null } = {}) {
  if (running) return { busy: true };
  running = true;
  const field = all ? 'import' : 'poll';
  if (all) remember('import', { running: true, startedAt: new Date().toISOString(), by });
  try {
    const result = await scanChannels({ all });
    const status = { at: new Date().toISOString(), by, ...result, error: result.errors.length ? result.errors.join(' ') : null };
    remember(field, status);
    return status;
  } catch (error) {
    const status = { at: new Date().toISOString(), by, error: error.message };
    remember(field, status);
    return status;
  } finally {
    running = false;
  }
}

// Started from Import on the tab: runs in the background.
function startImport(by) {
  if (running) return false;
  void runScan({ all: true, by }).catch(error => console.warn(`Legends import failed: ${error.message}`));
  return true;
}

let timer = null;
function setLegendsClient(discordClient) {
  client = discordClient;
  if (timer || !discordClient || typeof discordClient.once !== 'function') return;
  discordClient.once('clientReady', () => {
    const poll = () => runScan().catch(error => console.warn(`Legends: ${error.message}`));
    setTimeout(poll, 90 * 1000);
    timer = setInterval(poll, POLL_MINUTES * 60 * 1000);
    if (timer.unref) timer.unref();
  });
}

function setClientForTests(fake) {
  client = fake;
}

module.exports = {
  setLegendsClient,
  setClientForTests,
  docsChannelId,
  artChannelId,
  scanChannels,
  runScan,
  startImport,
  refreshLegendDoc,
  isRunning: () => running
};
