// db/legends.js — The Legends tab: Google Docs and art about characters that
// have no sheet in the panel (older characters, ones from other games), read
// from two Discord channels of their own by legends.js. Only the players
// listed in config 'legends_viewers' and the Root DM see any of it, and it
// is kept in its own tables so none of it reaches Chronicles or Art.
//
// A doc or an image is about one or more legend characters: Grimbold tags
// what the post (or the doc's title) names, by name or by an alias; anyone
// who sees the tab fixes it by hand. What names nobody waits in "To sort";
// what is about nobody (a meme, a stray link) is hidden.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, uploadsDir } = require('./connection');
const { nameText, textHasName, textHasWord, extractDocLinks, docEmbedUrl, guessDocKind, DOC_KINDS } = require('./characterDocs');
const { sniffImage } = require('./npcFiles');

const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_SAVED_TEXT = 400000;
const MAX_SAVED_HTML = 3000000;
const dir = () => path.join(uploadsDir, 'legends');
const clean = (text, length) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, length);

// ─── Who sees it ────────────────────────────────────────────────────────────

const VIEWERS_KEY = 'legends_viewers';

function getLegendsViewers() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(VIEWERS_KEY);
  try {
    const list = row ? JSON.parse(row.value) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

// ids: Discord IDs, as a list or text (any separators). Returns the list kept.
function setLegendsViewers(ids) {
  const tokens = [].concat(ids || []).flatMap(value => String(value).split(/[\s,;]+/)).filter(Boolean);
  const bad = tokens.filter(token => !/^\d{15,22}$/.test(token));
  if (bad.length) throw new Error(`Not a Discord ID: ${bad.slice(0, 3).join(', ')}. Copy it with right-click → Copy User ID.`);
  const list = [...new Set(tokens)];
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(VIEWERS_KEY, JSON.stringify(list));
  return list;
}

// [{ discordId, tag }] (tag null: no panel account with that ID yet).
function listLegendsViewers() {
  return getLegendsViewers().map(discordId => {
    const player = db.prepare('SELECT discord_tag FROM players WHERE discord_id = ?').get(discordId);
    return { discordId, tag: player ? player.discord_tag : null };
  });
}

const isRoot = user => Boolean(user && user.id === 0 && user.role === 'admin');

// The Root DM, and players on the list. Other DMs don't see it.
function canSeeLegends(user) {
  if (!user) return false;
  if (isRoot(user)) return true;
  if (!(Number(user.id) > 0)) return false;
  const player = db.prepare('SELECT discord_id FROM players WHERE id = ?').get(Number(user.id));
  return Boolean(player && getLegendsViewers().includes(String(player.discord_id)));
}

// ─── Characters ─────────────────────────────────────────────────────────────

const splitAliases = text => String(text || '').split(/[,;\n]+/).map(alias => clean(alias, 100)).filter(Boolean);

function allCharacters() {
  return db.prepare('SELECT id, name, aliases FROM legend_characters').all();
}

// The characters a text names: [ids]. Full names and aliases as written; a
// single word (a first name, an alias) also as Polish declines it, when only
// one character goes by it.
function matchLegendCharacters(text, characters = allCharacters()) {
  const words = nameText(text);
  if (!words) return [];
  const found = new Set();
  const byWord = new Map();
  const claim = (word, id) => {
    if (!byWord.has(word)) byWord.set(word, new Set());
    byWord.get(word).add(id);
  };
  for (const character of characters) {
    for (const name of [character.name, ...splitAliases(character.aliases)].map(nameText).filter(Boolean)) {
      if (name.includes(' ')) {
        if (textHasWord(words, name)) found.add(character.id);
        claim(name.split(' ')[0], character.id);
      } else {
        claim(name, character.id);
      }
    }
  }
  // A word that is itself someone's name is never a declined form of another
  // ("Silvana" is not Silv's genitive when someone is called Silvana).
  const tokens = words.split(' ');
  for (const [word, owners] of byWord) {
    if (owners.size !== 1) continue;
    const rest = tokens.filter(token => token === word || !byWord.has(token)).join(' ');
    if (textHasName(rest, word)) found.add([...owners][0]);
  }
  return [...found];
}

function listLegendCharacters() {
  return db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM legend_doc_characters t JOIN legend_docs d ON d.id = t.doc_id WHERE t.character_id = c.id AND d.hidden = 0) AS doc_count,
      (SELECT COUNT(*) FROM legend_image_characters t JOIN legend_images i ON i.id = t.image_id WHERE t.character_id = c.id AND i.hidden = 0) AS image_count,
      COALESCE(
        (SELECT i.id FROM legend_images i WHERE i.id = c.portrait_image_id AND i.file IS NOT NULL),
        (SELECT i.id FROM legend_image_characters t JOIN legend_images i ON i.id = t.image_id
          WHERE t.character_id = c.id AND i.hidden = 0 AND i.file IS NOT NULL ORDER BY COALESCE(i.posted_at, i.created_at) LIMIT 1)
      ) AS picture_id
    FROM legend_characters c ORDER BY c.name COLLATE NOCASE
  `).all().map(row => ({
    ...row,
    aliasList: splitAliases(row.aliases),
    pictureUrl: row.picture_id ? imageUrl(row.picture_id, 'thumb') : null
  }));
}

function getLegendCharacter(id) {
  return listLegendCharacters().find(character => character.id === Number(id)) || null;
}

// Adds (no id) or edits a character: { id, name, aliases, description,
// portraitImageId ('' = the first image of them) }. Returns its id. Docs and
// images nobody tagged by hand are matched again, so a character added
// after an import still finds what names them.
function saveLegendCharacter({ id, name, aliases, description, portraitImageId }) {
  const label = clean(name, 100);
  if (!label) throw new Error('A character needs a name.');
  const key = nameText(label);
  if (!key) throw new Error('A character needs a name with letters in it.');
  const same = db.prepare('SELECT id FROM legend_characters WHERE name_key = ?').get(key);
  if (same && same.id !== Number(id)) throw new Error(`There is already a character called ${label}.`);
  const aliasText = splitAliases(aliases).join(', ').slice(0, 500);
  const about = String(description || '').trim().slice(0, 4000);
  let characterId;
  if (id) {
    const current = db.prepare('SELECT id FROM legend_characters WHERE id = ?').get(Number(id));
    if (!current) throw new Error('Character not found.');
    characterId = current.id;
    let portrait = null;
    if (portraitImageId !== undefined && portraitImageId !== '' && portraitImageId !== null) {
      portrait = Number(portraitImageId);
      if (!db.prepare('SELECT 1 FROM legend_image_characters WHERE image_id = ? AND character_id = ?').get(portrait, characterId)) {
        throw new Error('The portrait must be one of their own pictures.');
      }
    }
    db.prepare('UPDATE legend_characters SET name = ?, name_key = ?, aliases = ?, description = ? WHERE id = ?')
      .run(label, key, aliasText, about, characterId);
    if (portraitImageId !== undefined) db.prepare('UPDATE legend_characters SET portrait_image_id = ? WHERE id = ?').run(portrait, characterId);
  } else {
    characterId = Number(db.prepare('INSERT INTO legend_characters (name, name_key, aliases, description) VALUES (?, ?, ?, ?)')
      .run(label, key, aliasText, about).lastInsertRowid);
  }
  retagFromText();
  return characterId;
}

// Their docs and images stay; those about nobody else go back to sorting.
function deleteLegendCharacter(id) {
  const result = db.prepare('DELETE FROM legend_characters WHERE id = ?').run(Number(id));
  if (!result.changes) throw new Error('Character not found.');
  retagFromText();
}

// What a doc or an image is matched against: the post, the doc's title, the thread.
const docText = doc => [doc.message_text, doc.title, doc.thread_name].filter(Boolean).join('\n');

// Everything nobody tagged by hand, matched again against the characters.
function retagFromText() {
  const characters = allCharacters();
  db.transaction(() => {
    for (const doc of db.prepare("SELECT * FROM legend_docs WHERE hidden = 0 AND (tagged_by IS NULL OR tagged_by = 'name')").all()) {
      setDocCharacters(doc.id, matchLegendCharacters(docText(doc), characters), 'name');
    }
    for (const image of db.prepare("SELECT * FROM legend_images WHERE hidden = 0 AND (tagged_by IS NULL OR tagged_by = 'name')").all()) {
      setImageCharacters(image.id, matchLegendCharacters(docText(image), characters), 'name');
    }
  })();
}

function checkCharacterIds(ids) {
  const list = [...new Set([].concat(ids || []).filter(id => id !== '' && id !== null && id !== undefined).map(Number))];
  for (const id of list) {
    if (!Number.isSafeInteger(id) || !db.prepare('SELECT id FROM legend_characters WHERE id = ?').get(id)) throw new Error('Character not found.');
  }
  return list;
}

// ─── Docs ───────────────────────────────────────────────────────────────────

function setDocCharacters(docId, ids, by) {
  db.prepare('DELETE FROM legend_doc_characters WHERE doc_id = ?').run(docId);
  const add = db.prepare('INSERT OR IGNORE INTO legend_doc_characters (doc_id, character_id) VALUES (?, ?)');
  for (const id of ids) add.run(docId, id);
  db.prepare('UPDATE legend_docs SET tagged_by = ? WHERE id = ?').run(by === 'hand' ? 'hand' : ids.length ? 'name' : null, docId);
}

const canonicalDocUrl = key => (key.startsWith('pub:')
  ? `https://docs.google.com/document/d/e/${key.slice(4)}/pub`
  : `https://docs.google.com/document/d/${key}/edit`);

function getDocRowByKey(key) {
  return db.prepare('SELECT * FROM legend_docs WHERE doc_key = ?').get(String(key));
}

// A doc seen in a message: recorded once (the first post wins), tagged from
// the post, its title and the thread. Returns { doc, created }.
function recordLegendDoc({ key, title, messageText, threadName, channelId, guildId, messageId, posterDiscordId, posterTag, postedAt }) {
  const existing = getDocRowByKey(key);
  if (existing) {
    if (!existing.title && title) db.prepare('UPDATE legend_docs SET title = ? WHERE id = ?').run(String(title).slice(0, 300), existing.id);
    return { doc: getDocRowByKey(key), created: false };
  }
  const text = [messageText, title, threadName].filter(Boolean).join('\n');
  const id = Number(db.prepare(`
    INSERT INTO legend_docs (doc_key, url, title, kind, channel_id, guild_id, message_id, posted_by_discord_id, posted_by_tag, posted_at, message_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, canonicalDocUrl(key), title ? String(title).slice(0, 300) : null, guessDocKind(text), channelId || null, guildId || null,
    messageId || null, posterDiscordId || null, posterTag || null, postedAt || null,
    [messageText, threadName].filter(Boolean).join('\n').slice(0, 2000)).lastInsertRowid);
  setDocCharacters(id, matchLegendCharacters(text), 'name');
  return { doc: getDocRowByKey(key), created: true };
}

// What Grimbold got from Google (chronicles.fetchDocCopy). A doc whose title
// came only now is matched again, unless someone tagged it by hand.
function saveLegendDocCopy(id, { title, text, html, access }) {
  const doc = db.prepare('SELECT * FROM legend_docs WHERE id = ?').get(Number(id));
  if (!doc) throw new Error('Document not found.');
  if (text !== undefined && text !== null) {
    db.prepare('UPDATE legend_docs SET saved_text = ?, saved_at = CURRENT_TIMESTAMP WHERE id = ?').run(String(text).slice(0, MAX_SAVED_TEXT), doc.id);
  }
  if (html !== undefined && html !== null) {
    const value = String(html);
    db.prepare('UPDATE legend_docs SET saved_html = ? WHERE id = ?').run(value.length <= MAX_SAVED_HTML ? value : '', doc.id);
  }
  if (title) db.prepare('UPDATE legend_docs SET title = ? WHERE id = ?').run(String(title).slice(0, 300), doc.id);
  if (access) db.prepare('UPDATE legend_docs SET access = ? WHERE id = ?').run(access, doc.id);
  if (title && title !== doc.title && doc.tagged_by !== 'hand' && !doc.hidden) {
    const fresh = db.prepare('SELECT * FROM legend_docs WHERE id = ?').get(doc.id);
    setDocCharacters(doc.id, matchLegendCharacters(docText(fresh)), 'name');
  }
  return getLegendDoc(doc.id);
}

function docCharacters(ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`
    SELECT t.doc_id, c.id, c.name FROM legend_doc_characters t JOIN legend_characters c ON c.id = t.character_id
    WHERE t.doc_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.name COLLATE NOCASE
  `).all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.doc_id)) map.set(row.doc_id, []);
    map.get(row.doc_id).push({ id: row.id, name: row.name });
  }
  return map;
}

function presentDocs(rows) {
  const characters = docCharacters(rows.map(row => row.id));
  return rows.map(row => ({
    ...row,
    hidden: Boolean(row.hidden),
    characters: characters.get(row.id) || [],
    kindLabel: DOC_KINDS[row.kind] || DOC_KINDS.other,
    embedUrl: docEmbedUrl(row.doc_key),
    messageUrl: row.guild_id && row.channel_id && row.message_id
      ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}` : null
  }));
}

const DOC_LIST_COLUMNS = `d.id, d.doc_key, d.url, d.title, d.kind, d.tagged_by, d.hidden, d.guild_id, d.channel_id, d.message_id,
  d.posted_by_tag, d.posted_at, d.access, d.saved_at, LENGTH(d.saved_text) AS saved_length`;
const HAS_CHARACTER_DOC = 'EXISTS (SELECT 1 FROM legend_doc_characters x WHERE x.doc_id = d.id)';

// view: 'gallery' (about someone), 'unsorted', 'hidden'. characterId, kind narrow it.
function listLegendDocs({ view = 'gallery', characterId, kind } = {}) {
  const where = [view === 'hidden' ? 'd.hidden = 1' : 'd.hidden = 0'];
  const params = [];
  if (view === 'unsorted') where.push(`NOT ${HAS_CHARACTER_DOC}`);
  if (view === 'gallery') where.push(HAS_CHARACTER_DOC);
  if (characterId) { where.push('EXISTS (SELECT 1 FROM legend_doc_characters y WHERE y.doc_id = d.id AND y.character_id = ?)'); params.push(Number(characterId)); }
  if (kind && DOC_KINDS[kind]) { where.push('d.kind = ?'); params.push(kind); }
  return presentDocs(db.prepare(`
    SELECT ${DOC_LIST_COLUMNS} FROM legend_docs d WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(d.posted_at, d.created_at) DESC, d.id DESC
  `).all(...params));
}

function getLegendDoc(id) {
  const row = db.prepare(`SELECT ${DOC_LIST_COLUMNS}, d.saved_text, d.saved_html, d.message_text FROM legend_docs d WHERE d.id = ?`).get(Number(id));
  return row ? presentDocs([row])[0] : null;
}

// By hand: { characterIds, kind, hidden, title }.
function updateLegendDoc(id, { characterIds, kind, hidden, title }) {
  const doc = db.prepare('SELECT id FROM legend_docs WHERE id = ?').get(Number(id));
  if (!doc) throw new Error('Document not found.');
  db.transaction(() => {
    if (characterIds !== undefined) setDocCharacters(doc.id, checkCharacterIds(characterIds), 'hand');
    if (kind !== undefined) {
      if (!DOC_KINDS[kind]) throw new Error('Unknown kind of document.');
      db.prepare('UPDATE legend_docs SET kind = ? WHERE id = ?').run(kind, doc.id);
    }
    if (hidden !== undefined) db.prepare('UPDATE legend_docs SET hidden = ?, tagged_by = ? WHERE id = ?').run(hidden ? 1 : 0, 'hand', doc.id);
    if (title !== undefined && String(title).trim()) db.prepare('UPDATE legend_docs SET title = ? WHERE id = ?').run(clean(title, 300), doc.id);
  })();
  return getLegendDoc(doc.id);
}

// Shared docs with a text copy but no formatted one: fetched again a few at a time.
function listLegendDocsWithoutCopy(limit = 5) {
  return db.prepare(`
    SELECT id FROM legend_docs WHERE access != 'restricted' AND (saved_text IS NULL OR saved_html IS NULL) ORDER BY id LIMIT ?
  `).all(Number(limit) || 5).map(row => row.id);
}

// ─── Images ─────────────────────────────────────────────────────────────────

function isLegendImage(attachment) {
  if (!attachment) return false;
  if (attachment.contentType) return /^image\/(png|jpe?g|webp|gif)/i.test(attachment.contentType);
  return IMAGE_EXTENSIONS.test(attachment.name || '');
}

const messageImages = messageId => db.prepare('SELECT * FROM legend_images WHERE message_id = ? ORDER BY id').all(String(messageId));
const imageUrl = (id, size, file) => `/api/legends/images/${id}${size === 'thumb' ? '?size=thumb' : ''}${file ? `${size === 'thumb' ? '&' : '?'}v=${encodeURIComponent(file)}` : ''}`;

function setImageCharacters(imageId, ids, by) {
  db.prepare('DELETE FROM legend_image_characters WHERE image_id = ?').run(imageId);
  const add = db.prepare('INSERT OR IGNORE INTO legend_image_characters (image_id, character_id) VALUES (?, ?)');
  for (const id of ids) add.run(imageId, id);
  db.prepare('UPDATE legend_images SET tagged_by = ? WHERE id = ?').run(by === 'hand' ? 'hand' : ids.length ? 'name' : null, imageId);
}

// One Discord message with images. attachments: [{ id, name, contentType,
// width, height }] (only images are kept). New images of a message share
// its tags; an edited post is matched again unless tagged by hand.
// Returns { images, created: [ids] }.
function recordLegendImages({ messageId, channelId, guildId, threadName, posterDiscordId, posterTag, postedAt, text, attachments }) {
  const images = (attachments || []).filter(isLegendImage);
  if (!images.length) return { images: messageImages(messageId), created: [] };
  const created = [];
  const body = String(text || '').slice(0, 2000);
  db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO legend_images (attachment_id, message_id, channel_id, guild_id, thread_name, posted_by_discord_id,
        posted_by_tag, posted_at, message_text, filename, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const attachment of images) {
      const result = insert.run(String(attachment.id), String(messageId), channelId || null, guildId || null, threadName || null,
        posterDiscordId || null, posterTag || null, postedAt || null, body, attachment.name || null,
        Number(attachment.width) || null, Number(attachment.height) || null);
      if (result.changes) created.push(Number(result.lastInsertRowid));
    }
    const all = messageImages(messageId);
    const textChanged = all.some(image => (image.message_text || '') !== body);
    if (textChanged) db.prepare('UPDATE legend_images SET message_text = ? WHERE message_id = ?').run(body, String(messageId));
    const byHand = all.find(image => image.tagged_by === 'hand' || image.hidden);
    if (byHand) {
      const ids = db.prepare('SELECT character_id FROM legend_image_characters WHERE image_id = ?').all(byHand.id).map(row => row.character_id);
      for (const id of created) {
        setImageCharacters(id, ids, 'hand');
        db.prepare('UPDATE legend_images SET hidden = ?, artist_name = ?, artist_url = ? WHERE id = ?').run(byHand.hidden, byHand.artist_name, byHand.artist_url, id);
      }
    } else if (created.length || textChanged) {
      const ids = matchLegendCharacters([body, threadName].filter(Boolean).join('\n'));
      for (const image of messageImages(messageId)) setImageCharacters(image.id, ids, 'name');
    }
  })();
  return { images: messageImages(messageId), created };
}

function imageCharacters(ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`
    SELECT t.image_id, c.id, c.name FROM legend_image_characters t JOIN legend_characters c ON c.id = t.character_id
    WHERE t.image_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.name COLLATE NOCASE
  `).all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.image_id)) map.set(row.image_id, []);
    map.get(row.image_id).push({ id: row.id, name: row.name });
  }
  return map;
}

function presentImages(rows) {
  const characters = imageCharacters(rows.map(row => row.id));
  return rows.map(row => ({
    ...row,
    hidden: Boolean(row.hidden),
    uploaded: isUpload(row),
    characters: characters.get(row.id) || [],
    imageUrl: row.file ? imageUrl(row.id, 'full', row.file) : null,
    thumbUrl: row.file ? imageUrl(row.id, 'thumb', row.file) : null,
    messageUrl: row.guild_id && row.channel_id && row.message_id
      ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}` : null
  }));
}

const HAS_CHARACTER_IMAGE = 'EXISTS (SELECT 1 FROM legend_image_characters x WHERE x.image_id = i.id)';

// view: 'gallery' (about someone), 'unsorted', 'hidden'. characterId,
// artist and poster (a Discord ID) narrow it.
function listLegendImages({ view = 'gallery', characterId, artist, poster, limit } = {}) {
  const where = [view === 'hidden' ? 'i.hidden = 1' : 'i.hidden = 0'];
  const params = [];
  if (poster) { where.push('i.posted_by_discord_id = ?'); params.push(String(poster)); }
  if (view === 'unsorted') where.push(`NOT ${HAS_CHARACTER_IMAGE}`);
  if (view === 'gallery') where.push(HAS_CHARACTER_IMAGE);
  if (characterId) { where.push('EXISTS (SELECT 1 FROM legend_image_characters y WHERE y.image_id = i.id AND y.character_id = ?)'); params.push(Number(characterId)); }
  if (artist) { where.push('i.artist_name = ?'); params.push(String(artist)); }
  return presentImages(db.prepare(`
    SELECT i.* FROM legend_images i WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(i.posted_at, i.created_at) DESC, i.id DESC ${limit ? 'LIMIT ?' : ''}
  `).all(...params, ...(limit ? [Number(limit)] : [])));
}

function getLegendImage(id) {
  const row = db.prepare('SELECT * FROM legend_images WHERE id = ?').get(Number(id));
  return row ? presentImages([row])[0] : null;
}

function getLegendMessageImages(messageId) {
  return presentImages(messageImages(messageId));
}

function checkUrl(url) {
  const value = String(url || '').trim();
  if (!value) return null;
  if (!/^https?:\/\/\S+$/i.test(value) || value.length > 300) throw new Error('The artist\'s link must be a web address starting with http:// or https://.');
  return value;
}

// By hand, one image: { characterIds, hidden, artist, artistUrl }.
function updateLegendImage(id, { characterIds, hidden, artist, artistUrl }) {
  const image = db.prepare('SELECT id FROM legend_images WHERE id = ?').get(Number(id));
  if (!image) throw new Error('Image not found.');
  const link = artistUrl === undefined ? undefined : checkUrl(artistUrl);
  db.transaction(() => {
    if (characterIds !== undefined) setImageCharacters(image.id, checkCharacterIds(characterIds), 'hand');
    if (hidden !== undefined) db.prepare('UPDATE legend_images SET hidden = ?, tagged_by = ? WHERE id = ?').run(hidden ? 1 : 0, 'hand', image.id);
    if (artist !== undefined) db.prepare('UPDATE legend_images SET artist_name = ? WHERE id = ?').run(clean(artist, 100) || null, image.id);
    if (link !== undefined) db.prepare('UPDATE legend_images SET artist_url = ? WHERE id = ?').run(link, image.id);
  })();
  return getLegendImage(image.id);
}

// Many images at once (To sort): { characterIds } adds those characters to
// each (keeping who is already tagged), or { hidden: true } hides them all.
// Returns how many were changed.
function tagLegendImages(ids, { characterIds, hidden }) {
  const list = [...new Set([].concat(ids || []).map(Number).filter(Number.isSafeInteger))];
  if (!list.length) throw new Error('Select some images first.');
  const add = hidden ? [] : checkCharacterIds(characterIds);
  if (!hidden && !add.length) throw new Error('Tick who is in them first.');
  let changed = 0;
  db.transaction(() => {
    for (const id of list) {
      if (!db.prepare('SELECT id FROM legend_images WHERE id = ?').get(id)) continue;
      if (hidden) {
        db.prepare("UPDATE legend_images SET hidden = 1, tagged_by = 'hand' WHERE id = ?").run(id);
      } else {
        const current = db.prepare('SELECT character_id FROM legend_image_characters WHERE image_id = ?').all(id).map(row => row.character_id);
        setImageCharacters(id, [...new Set([...current, ...add])], 'hand');
      }
      changed += 1;
    }
  })();
  return changed;
}

// Who posted what is still to sort: [{ discordId, tag, count }], the most first.
function listLegendUnsortedPosters() {
  return db.prepare(`
    SELECT i.posted_by_discord_id AS discordId,
      COALESCE((SELECT p.discord_tag FROM players p WHERE p.discord_id = i.posted_by_discord_id), MAX(i.posted_by_tag)) AS tag,
      COUNT(*) AS count
    FROM legend_images i WHERE i.hidden = 0 AND NOT ${HAS_CHARACTER_IMAGE} AND i.posted_by_discord_id IS NOT NULL
    GROUP BY i.posted_by_discord_id ORDER BY count DESC, tag COLLATE NOCASE
  `).all();
}

function listLegendArtists() {
  return db.prepare(`SELECT artist_name AS name, COUNT(*) AS count FROM legend_images
    WHERE artist_name IS NOT NULL AND hidden = 0 GROUP BY artist_name ORDER BY count DESC, name COLLATE NOCASE`).all();
}

// ─── Files ──────────────────────────────────────────────────────────────────

function removeFile(name) {
  if (name && name === path.basename(name)) fs.rmSync(path.join(dir(), name), { force: true });
}

// Grimbold's copy of an image (and a smaller one, if Discord made one).
// error: why the download failed, kept to show in the panel.
function saveLegendImageFiles(id, { buffer, thumb, error }) {
  const image = db.prepare('SELECT * FROM legend_images WHERE id = ?').get(Number(id));
  if (!image) throw new Error('Image not found.');
  if (error) {
    db.prepare('UPDATE legend_images SET download_error = ? WHERE id = ?').run(String(error).slice(0, 300), image.id);
    return;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_IMAGE_BYTES) throw new Error('That image is too large to keep.');
  const type = sniffImage(buffer);
  if (!type) throw new Error('That file is not a PNG, JPG, WebP or GIF image.');
  fs.mkdirSync(dir(), { recursive: true });
  const base = `legend-${image.id}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(path.join(dir(), `${base}.${type}`), buffer);
  const thumbType = Buffer.isBuffer(thumb) && thumb.length < buffer.length ? sniffImage(thumb) : null;
  if (thumbType) fs.writeFileSync(path.join(dir(), `${base}-thumb.${thumbType}`), thumb);
  db.prepare('UPDATE legend_images SET file = ?, thumb_file = ?, download_error = NULL WHERE id = ?')
    .run(`${base}.${type}`, thumbType ? `${base}-thumb.${thumbType}` : null, image.id);
  removeFile(image.file);
  removeFile(image.thumb_file);
}

// { file, contentType } to send, or null. size 'thumb' falls back to the image.
function getLegendImageFile(id, { size } = {}) {
  const image = db.prepare('SELECT file, thumb_file FROM legend_images WHERE id = ?').get(Number(id));
  if (!image) return null;
  for (const name of size === 'thumb' ? [image.thumb_file, image.file] : [image.file]) {
    if (!name || name !== path.basename(name)) continue;
    const file = path.join(dir(), name);
    if (fs.existsSync(file)) return { file, contentType: CONTENT_TYPES[path.extname(name).slice(1)] || 'application/octet-stream' };
  }
  return null;
}

// ─── Uploads ────────────────────────────────────────────────────────────────

const isUpload = image => String(image.message_id || '').startsWith('upload:');

// Anyone who sees the tab uploads a picture from outside the channel, tagged
// with who is in it (none: it waits in To sort) and who drew it. Returns its id.
function uploadLegendImage({ user, buffer, caption, characterIds, artist, artistUrl }) {
  if (!canSeeLegends(user)) throw new Error('Forbidden.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose an image to upload.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Images can be 25 MB at most.');
  if (!sniffImage(buffer)) throw new Error('Only PNG, JPG, WebP or GIF images can be uploaded.');
  const ids = checkCharacterIds(characterIds);
  const link = checkUrl(artistUrl);
  const player = Number(user.id) > 0 ? db.prepare('SELECT id, discord_id, discord_tag FROM players WHERE id = ?').get(Number(user.id)) : null;
  const key = `upload:${crypto.randomBytes(9).toString('hex')}`;
  const id = db.transaction(() => {
    const newId = Number(db.prepare(`
      INSERT INTO legend_images (attachment_id, message_id, posted_by_discord_id, posted_by_tag, posted_at, message_text,
        artist_name, artist_url, uploaded_by_player_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(key, key, player ? player.discord_id : null, player ? player.discord_tag : (user.discord_tag || 'Root DM'),
      new Date().toISOString(), clean(caption, 2000) || null, clean(artist, 100) || null, link, player ? player.id : null).lastInsertRowid);
    if (ids.length) setImageCharacters(newId, ids, 'hand');
    return newId;
  })();
  try {
    saveLegendImageFiles(id, { buffer });
  } catch (error) {
    db.prepare('DELETE FROM legend_images WHERE id = ?').run(id);
    throw error;
  }
  return id;
}

// The same in pieces: the web server in front (nginx) refuses big requests,
// so the browser sends the picture in parts, joined here. Each upload belongs
// to whoever started it.
const UPLOAD_PIECE_BYTES = 512 * 1024;
function partFile(user, uploadId) {
  if (!/^[a-f0-9]{24}$/.test(String(uploadId || ''))) throw new Error('That upload is not known; start again.');
  return path.join(dir(), `upload-${Number(user.id) || 0}-${uploadId}.part`);
}

function startLegendUpload({ user, size }) {
  if (!canSeeLegends(user)) throw new Error('Forbidden.');
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < 1) throw new Error('Choose an image to upload.');
  if (bytes > MAX_IMAGE_BYTES) throw new Error('Images can be 25 MB at most.');
  fs.mkdirSync(dir(), { recursive: true });
  // Parts left behind by uploads that never finished (over a day old).
  fs.readdirSync(dir()).filter(name => name.endsWith('.part')).forEach(name => {
    const file = path.join(dir(), name);
    if (Date.now() - fs.statSync(file).mtimeMs > 86400000) fs.rmSync(file, { force: true });
  });
  const uploadId = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(partFile(user, uploadId), Buffer.alloc(0));
  return { uploadId, pieceBytes: UPLOAD_PIECE_BYTES };
}

// offset: where this piece goes (the bytes received so far), so a repeated piece is caught.
function addLegendUploadPiece({ user, uploadId, offset, buffer }) {
  if (!canSeeLegends(user)) throw new Error('Forbidden.');
  const file = partFile(user, uploadId);
  if (!fs.existsSync(file)) throw new Error('That upload is not known; start again.');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > UPLOAD_PIECE_BYTES) throw new Error('A piece of the upload is the wrong size.');
  const received = fs.statSync(file).size;
  if (Number(offset) !== received) throw new Error('The upload got out of step; start again.');
  if (received + buffer.length > MAX_IMAGE_BYTES) throw new Error('Images can be 25 MB at most.');
  fs.appendFileSync(file, buffer);
  return { received: received + buffer.length };
}

// The joined picture saved as uploadLegendImage does: { uploadId, ...its fields }. Returns its id.
function finishLegendUpload({ user, uploadId, ...fields }) {
  if (!canSeeLegends(user)) throw new Error('Forbidden.');
  const file = partFile(user, uploadId);
  if (!fs.existsSync(file)) throw new Error('That upload is not known; start again.');
  try {
    return uploadLegendImage({ user, buffer: fs.readFileSync(file), ...fields });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// An upload is deleted by whoever uploaded it, or the Root DM.
function canDeleteLegendImage(user, id) {
  const image = db.prepare('SELECT message_id, uploaded_by_player_id FROM legend_images WHERE id = ?').get(Number(id));
  if (!image || !isUpload(image) || !canSeeLegends(user)) return false;
  return isRoot(user) || (Number(user.id) > 0 && image.uploaded_by_player_id === Number(user.id));
}

// Discord posts can't be deleted (the next look at the channel brings them back): hide them.
function deleteLegendUpload(id, user) {
  const image = db.prepare('SELECT * FROM legend_images WHERE id = ?').get(Number(id));
  if (!image) throw new Error('Image not found.');
  if (!isUpload(image)) throw new Error('Only uploaded pictures can be deleted; hide a Discord post instead.');
  if (!canDeleteLegendImage(user, image.id)) throw new Error('Only whoever uploaded it (or the Root DM) can delete it.');
  db.prepare('DELETE FROM legend_images WHERE id = ?').run(image.id);
  removeFile(image.file);
  removeFile(image.thumb_file);
}

// ─── Top 4 picks ────────────────────────────────────────────────────────────

const MAX_PICKS = 4;

// The player's picks, best first: [imageId].
const pickIds = playerId => db.prepare('SELECT image_id FROM legend_picks WHERE player_id = ? ORDER BY rank, created_at')
  .all(Number(playerId)).map(row => row.image_id);

function pickingPlayer(user) {
  if (!canSeeLegends(user) || !(Number(user.id) > 0)) throw new Error('Only players on the list pick their top 4.');
  return Number(user.id);
}

function savePicks(playerId, ids) {
  db.transaction(() => {
    db.prepare('DELETE FROM legend_picks WHERE player_id = ?').run(playerId);
    const add = db.prepare('INSERT INTO legend_picks (player_id, image_id, rank) VALUES (?, ?, ?)');
    ids.slice(0, MAX_PICKS).forEach((imageId, index) => add.run(playerId, imageId, index + 1));
  })();
}

// Puts a picture at #rank (1–4) in the player's top 4; the ones from there
// down move one place, and a fifth falls out. Returns { rank, dropped: imageId | null }.
function setLegendPick(user, imageId, rank) {
  const playerId = pickingPlayer(user);
  const place = Number(rank);
  if (!Number.isInteger(place) || place < 1 || place > MAX_PICKS) throw new Error(`Pick a place from 1 to ${MAX_PICKS}.`);
  const image = db.prepare('SELECT id, hidden FROM legend_images WHERE id = ?').get(Number(imageId));
  if (!image) throw new Error('Image not found.');
  if (image.hidden) throw new Error('That picture is hidden; show it again to pick it.');
  const ids = pickIds(playerId).filter(id => id !== image.id);
  ids.splice(Math.min(place - 1, ids.length), 0, image.id);
  savePicks(playerId, ids);
  return { rank: ids.indexOf(image.id) + 1, dropped: ids.length > MAX_PICKS ? ids[MAX_PICKS] : null };
}

function removeLegendPick(user, imageId) {
  const playerId = pickingPlayer(user);
  savePicks(playerId, pickIds(playerId).filter(id => id !== Number(imageId)));
}

// One place up (-1) or down (+1).
function moveLegendPick(user, imageId, delta) {
  const playerId = pickingPlayer(user);
  const ids = pickIds(playerId);
  const from = ids.indexOf(Number(imageId));
  const to = from + (Number(delta) < 0 ? -1 : 1);
  if (from < 0) throw new Error('That picture is not in your top 4.');
  if (to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  savePicks(playerId, ids);
}

// The player's rank of each picture they picked: Map(imageId → 1–4).
function legendPickRanks(playerId) {
  return new Map(Number(playerId) > 0 ? pickIds(playerId).map((id, index) => [id, index + 1]) : []);
}

// Everyone on the list who has a panel account, with their picks in order:
// [{ playerId, tag, picks: [image] }].
function listLegendPicks() {
  return listLegendsViewers().map(viewer => {
    const player = db.prepare('SELECT id, discord_tag FROM players WHERE discord_id = ?').get(viewer.discordId);
    if (!player) return null;
    const ids = pickIds(player.id);
    const images = new Map(ids.length ? presentImages(db.prepare(`SELECT * FROM legend_images WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)).map(image => [image.id, image]) : []);
    return { playerId: player.id, tag: player.discord_tag, picks: ids.map(id => images.get(id)).filter(Boolean) };
  }).filter(Boolean);
}

function listLegendMessagesWithoutFile(limit = 20) {
  return db.prepare(`
    SELECT message_id, channel_id FROM legend_images WHERE file IS NULL GROUP BY message_id ORDER BY MIN(id) LIMIT ?
  `).all(Number(limit));
}

// ─── The tab ────────────────────────────────────────────────────────────────

function legendCounts() {
  const count = sql => db.prepare(sql).get().n;
  return {
    images: count(`SELECT COUNT(*) AS n FROM legend_images i WHERE i.hidden = 0 AND ${HAS_CHARACTER_IMAGE}`),
    docs: count(`SELECT COUNT(*) AS n FROM legend_docs d WHERE d.hidden = 0 AND ${HAS_CHARACTER_DOC}`),
    unsorted: count(`SELECT COUNT(*) AS n FROM legend_images i WHERE i.hidden = 0 AND NOT ${HAS_CHARACTER_IMAGE}`)
      + count(`SELECT COUNT(*) AS n FROM legend_docs d WHERE d.hidden = 0 AND NOT ${HAS_CHARACTER_DOC}`),
    hidden: count('SELECT COUNT(*) AS n FROM legend_images WHERE hidden = 1') + count('SELECT COUNT(*) AS n FROM legend_docs WHERE hidden = 1')
  };
}

const SCAN_KEY = 'legends_scan';
function getLegendsScanStatus() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(SCAN_KEY);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
function setLegendsScanStatus(status) {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(SCAN_KEY, JSON.stringify(status));
}

module.exports = {
  LEGEND_MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
  getLegendsViewers,
  setLegendsViewers,
  listLegendsViewers,
  canSeeLegends,
  matchLegendCharacters,
  listLegendCharacters,
  getLegendCharacter,
  saveLegendCharacter,
  deleteLegendCharacter,
  extractLegendDocLinks: extractDocLinks,
  recordLegendDoc,
  saveLegendDocCopy,
  listLegendDocs,
  getLegendDoc,
  updateLegendDoc,
  listLegendDocsWithoutCopy,
  isLegendImage,
  recordLegendImages,
  listLegendImages,
  getLegendImage,
  getLegendMessageImages,
  updateLegendImage,
  tagLegendImages,
  listLegendUnsortedPosters,
  listLegendArtists,
  saveLegendImageFiles,
  getLegendImageFile,
  listLegendMessagesWithoutFile,
  uploadLegendImage,
  startLegendUpload,
  addLegendUploadPiece,
  finishLegendUpload,
  canDeleteLegendImage,
  deleteLegendUpload,
  LEGEND_MAX_PICKS: MAX_PICKS,
  setLegendPick,
  removeLegendPick,
  moveLegendPick,
  legendPickRanks,
  listLegendPicks,
  legendCounts,
  getLegendsScanStatus,
  setLegendsScanStatus
};
