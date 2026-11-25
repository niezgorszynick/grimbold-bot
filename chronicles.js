// chronicles.js — Reads the Discord channel where players share Google Docs
// about their characters (diaries, letters, short stories), and keeps a copy
// of each doc for the panel's Chronicles tab (db/characterDocs.js).
//
// Grimbold reads the channel over Discord's REST API: a look at the latest
// messages every few minutes, and the whole history (with its threads) when
// the DM presses Import. That needs no gateway intents, but Discord only
// sends what messages say when the app's Message Content Intent is switched
// on in the Developer Portal (Bot → Privileged Gateway Intents); without it a
// scan reports that instead.

'use strict';

const db = require('./db');
const { cleanDocHtml } = require('./docHtml');

// The docs channel — override with CHARACTER_DOCS_CHANNEL_ID.
const DEFAULT_CHANNEL_ID = '1552412116873388114';
const POLL_MINUTES = 10;
const FETCH_TIMEOUT_MS = 15000;

let client = null;
let running = false;

function channelId() {
  return process.env.CHARACTER_DOCS_CHANNEL_ID || DEFAULT_CHANNEL_ID;
}

// ─── Google ─────────────────────────────────────────────────────────────────

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// A published page's HTML → its text, paragraph by paragraph.
function htmlToText(html) {
  const body = (String(html).match(/<div id="contents"[^>]*>([\s\S]*)<\/div>/i) || String(html).match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];
  return decodeEntities(body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function titleFromHtml(html) {
  const og = String(html).match(/<meta property="og:title" content="([^"]*)"/i);
  const title = og ? og[1] : (String(html).match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  return title ? decodeEntities(title).replace(/\s+-\s+Google (Docs|Dokumenty)\s*$/i, '').trim() || null : null;
}

async function get(url) {
  return fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrimboldBot)' } });
}

// { access, text, title } for a doc key. A doc that isn't shared with
// "anyone with the link" sends Google's sign-in page instead: restricted.
// html: the doc with its formatting (docHtml.js), '' if Google sent none.
async function fetchDocCopy(key) {
  if (key.startsWith('pub:')) {
    const response = await get(`https://docs.google.com/document/d/e/${key.slice(4)}/pub`);
    if (!response.ok) return { access: 'restricted', text: null, html: null, title: null };
    const html = await response.text();
    return { access: 'public', text: htmlToText(html), html: cleanDocHtml(html, { docKey: key }), title: titleFromHtml(html) };
  }
  const exported = await get(`https://docs.google.com/document/d/${key}/export?format=txt`);
  const type = exported.headers.get('content-type') || '';
  if (!exported.ok || !type.includes('text/plain')) return { access: 'restricted', text: null, html: null, title: null };
  const text = (await exported.text()).replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  // The same doc as HTML keeps its formatting; the text stands in without it.
  let html = '';
  const formatted = await get(`https://docs.google.com/document/d/${key}/export?format=html`).catch(() => null);
  if (formatted && formatted.ok && (formatted.headers.get('content-type') || '').includes('text/html')) {
    html = cleanDocHtml(await formatted.text(), { docKey: key });
  }
  let title = null;
  const page = await get(`https://docs.google.com/document/d/${key}/edit`).catch(() => null);
  if (page && page.ok) title = titleFromHtml(await page.text());
  return { access: 'public', text, html, title };
}

// Fetches the doc again and keeps the copy. Returns the doc.
async function refreshDoc(id) {
  const doc = db.getCharacterDoc(id, { isAdmin: true });
  if (!doc) throw new Error('Document not found.');
  let copy;
  try {
    copy = await fetchDocCopy(doc.doc_key);
  } catch (error) {
    throw new Error(`Google did not answer: ${error.message}`);
  }
  // A doc made private keeps the copy Grimbold already has.
  return db.saveCharacterDocCopy(doc.id, copy.access === 'public' ? copy : { access: copy.access });
}

// ─── Discord ────────────────────────────────────────────────────────────────

function messageText(message) {
  const embeds = (message.embeds || []).map(embed => [embed.url, embed.title, embed.description].filter(Boolean).join(' '));
  return [message.content || '', ...embeds].join('\n');
}

// The doc's title as Discord's link preview shows it.
function embedTitle(message, key) {
  const id = key.replace(/^pub:/, '');
  const embed = (message.embeds || []).find(entry => entry.url && entry.url.includes(id) && entry.title);
  return embed ? embed.title.replace(/\s+-\s+Google (Docs|Dokumenty)\s*$/i, '').trim() : null;
}

// One message: its doc links recorded. Returns the docs it created.
function recordMessage(message, threadName) {
  const author = message.author || {};
  if (author.bot) return [];
  const links = db.extractDocLinks(messageText(message));
  const created = [];
  for (const link of links) {
    const result = db.recordCharacterDoc({
      key: link.key,
      title: embedTitle(message, link.key),
      messageText: message.content || '',
      threadName,
      channelId: message.channelId,
      guildId: message.guildId,
      messageId: message.id,
      posterDiscordId: author.id,
      posterTag: (message.member && message.member.displayName) || author.globalName || author.username || null,
      postedAt: message.createdAt ? new Date(message.createdAt).toISOString() : null
    });
    if (result.created) created.push(result.doc);
  }
  return created;
}

// The channel and its threads (a forum channel has only threads).
async function sources(channel, { archived }) {
  const list = channel.messages ? [{ source: channel, threadName: null }] : [];
  if (!channel.threads) return list;
  const threads = new Map();
  const active = await channel.threads.fetchActive().catch(() => null);
  if (active) active.threads.forEach(thread => { if (thread.parentId === channel.id) threads.set(thread.id, thread); });
  if (archived) {
    let before;
    for (let page = 0; page < 50; page += 1) {
      const result = await channel.threads.fetchArchived({ limit: 100, before }).catch(() => null);
      if (!result || !result.threads.size) break;
      result.threads.forEach(thread => threads.set(thread.id, thread));
      if (!result.hasMore) break;
      before = [...result.threads.values()].pop().id;
    }
  }
  for (const thread of threads.values()) list.push({ source: thread, threadName: thread.name });
  return list;
}

// Reads the channel. all: every message (Import), else the latest 50 of each
// place. Returns { messages, docs: [new docs], contentMissing }.
async function scanChannel({ all = false } = {}) {
  if (!client || (typeof client.isReady === 'function' && !client.isReady())) throw new Error('The Discord bot is not connected right now.');
  const channel = await client.channels.fetch(channelId()).catch(() => null);
  if (!channel) throw new Error(`Grimbold cannot see the docs channel (${channelId()}): give him View Channel and Read Message History there.`);
  const stats = { messages: 0, empty: 0, docs: [] };
  for (const { source, threadName } of await sources(channel, { archived: all })) {
    let before;
    for (;;) {
      const batch = await source.messages.fetch({ limit: all ? 100 : 50, before }).catch(() => null);
      if (!batch || !batch.size) break;
      for (const message of batch.values()) {
        if (message.author && message.author.bot) continue;
        stats.messages += 1;
        const hasAnything = message.content || (message.embeds && message.embeds.length) || (message.attachments && message.attachments.size);
        if (!hasAnything) stats.empty += 1;
        stats.docs.push(...recordMessage(message, threadName));
      }
      if (!all || batch.size < 100) break;
      before = [...batch.values()].pop().id;
    }
  }
  return { messages: stats.messages, docs: stats.docs, contentMissing: stats.messages > 0 && stats.empty === stats.messages };
}

// A scan and the copies of what it found. The tab shows the last import and
// the last look at new posts: { import: {...}, poll: {...} }.
function remember(field, value) {
  db.setDocsScanStatus({ ...(db.getDocsScanStatus() || {}), [field]: value });
}

async function runScan({ all = false, by = null } = {}) {
  if (running) return { busy: true };
  running = true;
  const field = all ? 'import' : 'poll';
  if (all) remember('import', { running: true, startedAt: new Date().toISOString(), by });
  try {
    const result = await scanChannel({ all });
    for (const doc of result.docs) {
      await refreshDoc(doc.id).catch(error => console.warn(`Chronicles: no copy of ${doc.url}: ${error.message}`));
    }
    // Copies saved before formatting was kept: a few each time, until all have it.
    const fresh = new Set(result.docs.map(doc => doc.id));
    for (const id of db.listDocsWithoutFormatting(all ? 50 : 5).filter(id => !fresh.has(id))) {
      await refreshDoc(id).catch(error => console.warn(`Chronicles: no formatted copy of doc ${id}: ${error.message}`));
    }
    const status = { at: new Date().toISOString(), by, messages: result.messages, found: result.docs.length, contentMissing: result.contentMissing, error: null };
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

// Started from Import in the panel: runs in the background.
function startImport(by) {
  if (running) return false;
  void runScan({ all: true, by }).catch(error => console.warn(`Chronicles import failed: ${error.message}`));
  return true;
}

let timer = null;
function setChroniclesClient(discordClient) {
  client = discordClient;
  if (timer || !discordClient || typeof discordClient.once !== 'function') return;
  discordClient.once('clientReady', () => {
    const poll = () => runScan().catch(error => console.warn(`Chronicles: ${error.message}`));
    setTimeout(poll, 30 * 1000);
    timer = setInterval(poll, POLL_MINUTES * 60 * 1000);
    if (timer.unref) timer.unref();
  });
}

function setClientForTests(fake) {
  client = fake;
}

module.exports = {
  setChroniclesClient,
  setClientForTests,
  channelId,
  scanChannel,
  channelSources: sources,
  runScan,
  startImport,
  refreshDoc,
  fetchDocCopy,
  // Shared with Legends (legends.js).
  messageText,
  embedTitle,
  htmlToText,
  titleFromHtml,
  isRunning: () => running
};
