// db/characterDocs.js — Chronicles: Google Docs about characters (diaries,
// letters, short stories) shared in the Discord docs channel. chronicles.js
// reads the channel and Google; this module finds the links in a message,
// guesses whose doc it is and what kind, and keeps the records. Everyone
// signed in reads them; the DM sorts them (character, kind, hidden).

'use strict';

const { db } = require('./connection');

const KINDS = { diary: 'Diary', letter: 'Letter', story: 'Story', other: 'Other' };
const MAX_SAVED_TEXT = 400000;
const MAX_SAVED_HTML = 3000000;

// "Qual'danis Éversong" → "qualdanis eversong" (as characterThreads.js).
function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Google Docs links in a text: [{ key, url }]. A shared doc's key is its ID;
// a published-to-web doc (/d/e/…/pub) gets 'pub:<id>'.
function extractDocLinks(text) {
  const found = new Map();
  const pattern = /https?:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/(e\/)?([a-zA-Z0-9_-]{20,})/g;
  for (const match of String(text || '').matchAll(pattern)) {
    const key = match[1] ? `pub:${match[2]}` : match[2];
    if (!found.has(key)) found.set(key, { key, url: canonicalUrl(key) });
  }
  return [...found.values()];
}

function canonicalUrl(key) {
  return key.startsWith('pub:')
    ? `https://docs.google.com/document/d/e/${key.slice(4)}/pub`
    : `https://docs.google.com/document/d/${key}/edit`;
}

// The doc inside the panel: Google's preview (shared docs) or the published page.
function embedUrl(key) {
  return key.startsWith('pub:')
    ? `https://docs.google.com/document/d/e/${key.slice(4)}/pub?embedded=true`
    : `https://docs.google.com/document/d/${key}/preview`;
}

function guessKind(text) {
  const words = normalize(text);
  if (/\b(dziennik\w*|pamietnik\w*|diary|diaries|journal\w*)\b/.test(words)) return 'diary';
  if (/\b(list|listy|listu|liscik\w*|letters?|epistol\w*|korespondencj\w*)\b/.test(words)) return 'letter';
  if (/\b(opowiadani\w*|opowiesc\w*|historia|historie|story|stories|tale|tales|legend\w*|ballad\w*)\b/.test(words)) return 'story';
  return 'other';
}

const hasWord = (text, word) => word.length >= 3 && ` ${text} `.includes(` ${word} `);
// The name as Polish declines it too: Elara → Elary, Elarze; Thorin → Thorina.
function hasNameForm(text, word) {
  if (hasWord(text, word)) return true;
  if (word.length < 4) return false;
  const stem = word.slice(0, Math.max(4, word.length - 1));
  return text.split(' ').some(token => token.startsWith(stem) && token.length <= word.length + 3);
}

// Whose doc it is. characters: [{ id, name, discordId }]; text: the message,
// the doc's title and the thread's name. Returns { characterId, by } or null.
// The poster's own characters come first: a letter *to* someone else's
// character is still the poster's.
function matchCharacter({ text, characters, posterDiscordId }) {
  const words = normalize(text);
  const own = characters.filter(character => posterDiscordId && character.discordId === posterDiscordId);
  const fullName = list => list.filter(character => normalize(character.name) && hasWord(words, normalize(character.name)));
  const firstName = list => list.filter(character => hasNameForm(words, normalize(character.name).split(' ')[0]));
  const one = (list, by) => (list.length === 1 ? { characterId: list[0].id, by } : null);
  return one(fullName(own), 'name')
    || one(firstName(own), 'name')
    || one(own, 'poster')
    || one(fullName(characters), 'name')
    || null;
}

function allCharacters() {
  return db.prepare(`
    SELECT c.id, c.name, p.discord_id AS discordId
    FROM characters c JOIN players p ON p.id = c.player_id
  `).all();
}

function getDocByKey(key) {
  return db.prepare('SELECT * FROM character_docs WHERE doc_key = ?').get(String(key));
}

// A doc seen in a message: recorded once (the first post wins). Returns
// { doc, created }.
function recordDoc({ key, title, messageText, threadName, channelId, guildId, messageId, posterDiscordId, posterTag, postedAt }) {
  const existing = getDocByKey(key);
  if (existing) {
    if (!existing.title && title) db.prepare('UPDATE character_docs SET title = ? WHERE id = ?').run(title, existing.id);
    return { doc: getDocByKey(key), created: false };
  }
  const text = [messageText, title, threadName].filter(Boolean).join(' \n ');
  const match = matchCharacter({ text, characters: allCharacters(), posterDiscordId });
  db.prepare(`
    INSERT INTO character_docs (doc_key, url, title, kind, character_id, matched_by, channel_id, guild_id, message_id,
      posted_by_discord_id, posted_by_tag, posted_at, message_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, canonicalUrl(key), title || null, guessKind(text), match ? match.characterId : null, match ? match.by : null,
    channelId || null, guildId || null, messageId || null, posterDiscordId || null, posterTag || null, postedAt || null,
    String(messageText || '').slice(0, 2000));
  return { doc: getDocByKey(key), created: true };
}

// What Grimbold got from Google: access 'public' | 'restricted' | 'unknown'.
function saveDocCopy(id, { title, text, html, access }) {
  const doc = db.prepare('SELECT * FROM character_docs WHERE id = ?').get(Number(id));
  if (!doc) throw new Error('Document not found.');
  if (text !== undefined && text !== null) {
    db.prepare('UPDATE character_docs SET saved_text = ?, saved_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(String(text).slice(0, MAX_SAVED_TEXT), doc.id);
  }
  // The formatted copy (docHtml.js). '' = tried, none (or too long): the text stands in.
  if (html !== undefined && html !== null) {
    const value = String(html);
    db.prepare('UPDATE character_docs SET saved_html = ? WHERE id = ?').run(value.length <= MAX_SAVED_HTML ? value : '', doc.id);
  }
  if (title) db.prepare('UPDATE character_docs SET title = ? WHERE id = ?').run(String(title).slice(0, 300), doc.id);
  if (access) db.prepare('UPDATE character_docs SET access = ? WHERE id = ?').run(access, doc.id);
  return getCharacterDoc(doc.id, { isAdmin: true });
}

const LIST_COLUMNS = `
  d.id, d.doc_key, d.url, d.title, d.kind, d.character_id, d.matched_by, d.hidden, d.guild_id, d.channel_id,
  d.message_id, d.posted_by_tag, d.posted_at, d.access, d.saved_at, c.name AS character_name, c.status AS character_status,
  LENGTH(d.saved_text) AS saved_length`;

function present(row) {
  if (!row) return null;
  return {
    ...row,
    hidden: Boolean(row.hidden),
    kindLabel: KINDS[row.kind] || KINDS.other,
    embedUrl: embedUrl(row.doc_key),
    messageUrl: row.guild_id && row.channel_id && row.message_id
      ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}` : null
  };
}

// filter: { characterId, unsorted, kind, isAdmin, includeHidden }.
function listCharacterDocs({ characterId, unsorted, kind, isAdmin, includeHidden } = {}) {
  const where = [];
  const params = [];
  if (!(isAdmin && includeHidden)) where.push('d.hidden = 0');
  if (characterId) { where.push('d.character_id = ?'); params.push(Number(characterId)); }
  if (unsorted) where.push('d.character_id IS NULL');
  if (kind && KINDS[kind]) { where.push('d.kind = ?'); params.push(kind); }
  return db.prepare(`
    SELECT ${LIST_COLUMNS} FROM character_docs d LEFT JOIN characters c ON c.id = d.character_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(d.posted_at, d.created_at) DESC, d.id DESC
  `).all(...params).map(present);
}

function getCharacterDoc(id, { isAdmin } = {}) {
  const row = db.prepare(`
    SELECT ${LIST_COLUMNS}, d.saved_text, d.saved_html, d.message_text
    FROM character_docs d LEFT JOIN characters c ON c.id = d.character_id WHERE d.id = ?
  `).get(Number(id));
  if (!row || (row.hidden && !isAdmin)) return null;
  return present(row);
}

// The DM sorts a doc: { characterId ('' = unsorted), kind, hidden, title }.
function updateCharacterDoc(id, { characterId, kind, hidden, title }) {
  const doc = db.prepare('SELECT id FROM character_docs WHERE id = ?').get(Number(id));
  if (!doc) throw new Error('Document not found.');
  if (characterId !== undefined) {
    const value = characterId === '' || characterId === null ? null : Number(characterId);
    if (value !== null && !db.prepare('SELECT id FROM characters WHERE id = ?').get(value)) throw new Error('Character not found.');
    db.prepare('UPDATE character_docs SET character_id = ?, matched_by = ? WHERE id = ?').run(value, value === null ? null : 'dm', doc.id);
  }
  if (kind !== undefined) {
    if (!KINDS[kind]) throw new Error('Unknown kind of document.');
    db.prepare('UPDATE character_docs SET kind = ? WHERE id = ?').run(kind, doc.id);
  }
  if (hidden !== undefined) db.prepare('UPDATE character_docs SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, doc.id);
  if (title !== undefined && String(title).trim()) db.prepare('UPDATE character_docs SET title = ? WHERE id = ?').run(String(title).trim().slice(0, 300), doc.id);
  return doc.id;
}

function countUnsortedDocs() {
  return db.prepare('SELECT COUNT(*) AS n FROM character_docs WHERE character_id IS NULL AND hidden = 0').get().n;
}

// The last scan of the channel, for the tab: { at, running, ... } or null.
const SCAN_KEY = 'character_docs_scan';
function getDocsScanStatus() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(SCAN_KEY);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
function setDocsScanStatus(status) {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SCAN_KEY, JSON.stringify(status));
}

// Docs shared with anyone that have a text copy but no formatted one yet
// (saved before formatting was kept): Grimbold fetches a few each scan.
function listDocsWithoutFormatting(limit = 5) {
  return db.prepare(`
    SELECT id FROM character_docs WHERE access = 'public' AND saved_text IS NOT NULL AND saved_html IS NULL
    ORDER BY id LIMIT ?
  `).all(Number(limit) || 5).map(row => row.id);
}

module.exports = {
  DOC_KINDS: KINDS,
  listDocsWithoutFormatting,
  extractDocLinks,
  docEmbedUrl: embedUrl,
  guessDocKind: guessKind,
  matchDocCharacter: matchCharacter,
  recordCharacterDoc: recordDoc,
  getCharacterDocByKey: getDocByKey,
  saveCharacterDocCopy: saveDocCopy,
  listCharacterDocs,
  getCharacterDoc,
  updateCharacterDoc,
  countUnsortedDocs,
  getDocsScanStatus,
  setDocsScanStatus
};
