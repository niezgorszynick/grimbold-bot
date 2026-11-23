// db/art.js — The Art tab: images posted in the Discord art channel (art.js
// reads the channel and keeps a copy of each). An image is tagged with the
// characters in it, several if need be, and with an adventure. Grimbold tags
// what the post names; anyone with a panel account fixes it with Discord's
// "Tag art" menu, and DMs in the panel. Only images with a character show in
// the gallery: the rest wait in "To sort", and memes and screenshots are
// marked Not art. Everyone signed in sees the gallery.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, uploadsDir } = require('./connection');
const { nameText, textHasName, textHasWord } = require('./characterDocs');
const { sniffImage } = require('./npcFiles');

const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const HUMAN = ['discord', 'dm'];
const dir = () => path.join(uploadsDir, 'art');

// ─── Matching ───────────────────────────────────────────────────────────────

// The characters a post names: full names, and first names (as Polish
// declines them too) that belong to one character only. characters:
// [{ id, name }]. Returns their ids.
function matchArtCharacters({ text, characters }) {
  const words = nameText(text);
  if (!words) return [];
  const found = new Set();
  for (const character of characters) {
    const full = nameText(character.name);
    if (full && textHasWord(words, full)) found.add(character.id);
  }
  const byFirst = new Map();
  for (const character of characters) {
    const first = nameText(character.name).split(' ')[0];
    if (!first) continue;
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first).push(character);
  }
  for (const [first, group] of byFirst) {
    if (group.length !== 1 || !textHasName(words, first)) continue;
    found.add(group[0].id);
  }
  return [...found];
}

// The adventure a post names by its title (the longest that fits), or null.
function matchArtAdventure({ text, adventures }) {
  const words = nameText(text);
  let best = null;
  for (const adventure of adventures) {
    const title = nameText(adventure.title);
    if (title.length < 4 || !textHasWord(words, title)) continue;
    if (!best || title.length > nameText(best.title).length) best = adventure;
  }
  return best ? best.id : null;
}

const tookPart = `(EXISTS (SELECT 1 FROM adventure_party WHERE adventure_id = a.id AND character_id = ?)
  OR EXISTS (SELECT 1 FROM adventure_rewards WHERE adventure_id = a.id AND character_id = ?))`;
// The adventure's last session before a moment, or when it was opened.
const lastActivity = `MAX(datetime(a.created_at), COALESCE((SELECT MAX(datetime(s.starts_at)) FROM sessions s
  WHERE s.adventure_id = a.id AND s.status != 'cancelled' AND datetime(s.starts_at) <= datetime(?)), datetime(a.created_at)))`;

// The latest adventure before the post that every character in it was in.
function guessArtAdventure({ characterIds, postedAt }) {
  const ids = [...new Set((characterIds || []).map(Number))];
  if (!ids.length) return null;
  const at = postedAt || new Date().toISOString();
  const row = db.prepare(`
    SELECT a.id FROM adventures a
    WHERE a.status != 'cancelled' AND datetime(a.created_at) <= datetime(?)
      ${ids.map(() => `AND ${tookPart}`).join(' ')}
    ORDER BY ${lastActivity} DESC, a.id DESC LIMIT 1
  `).get(at, ...ids.flatMap(id => [id, id]), at);
  return row ? row.id : null;
}

function allCharacters() {
  return db.prepare('SELECT id, name, status FROM characters').all();
}

function allAdventures() {
  return db.prepare("SELECT id, title FROM adventures WHERE status != 'cancelled'").all();
}

// ─── Records ────────────────────────────────────────────────────────────────

// Is this Discord attachment an image? { contentType, name }.
function isArtAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.contentType) return /^image\/(png|jpe?g|webp|gif)/i.test(attachment.contentType);
  return IMAGE_EXTENSIONS.test(attachment.name || '');
}

const messageImages = messageId => db.prepare('SELECT * FROM art_images WHERE message_id = ? ORDER BY id').all(String(messageId));
const imageTags = imageId => db.prepare('SELECT character_id FROM art_image_characters WHERE image_id = ?').all(imageId).map(row => row.character_id);

function setTags(imageId, characterIds, by) {
  db.prepare('DELETE FROM art_image_characters WHERE image_id = ?').run(imageId);
  const add = db.prepare('INSERT OR IGNORE INTO art_image_characters (image_id, character_id) VALUES (?, ?)');
  for (const id of characterIds) add.run(imageId, id);
  db.prepare('UPDATE art_images SET tagged_by = ? WHERE id = ?').run(characterIds.length ? by : (HUMAN.includes(by) ? by : null), imageId);
}

// A guessed adventure follows the tags; one set by name or by hand stays.
function refreshGuess(imageId) {
  const image = db.prepare('SELECT * FROM art_images WHERE id = ?').get(imageId);
  if (!image || (image.adventure_by && image.adventure_by !== 'guess')) return;
  const guess = guessArtAdventure({ characterIds: imageTags(imageId), postedAt: image.posted_at });
  db.prepare('UPDATE art_images SET adventure_id = ?, adventure_by = ? WHERE id = ?').run(guess, guess ? 'guess' : null, imageId);
}

// Tags from the post's text, for a message nobody has tagged by hand: on
// the first look, and again when the post was edited.
function tagFromText(images, text) {
  if (images.some(image => HUMAN.includes(image.tagged_by) || image.not_art)) return;
  const characterIds = matchArtCharacters({ text, characters: allCharacters() });
  const adventureId = matchArtAdventure({ text, adventures: allAdventures() });
  for (const image of images) {
    setTags(image.id, characterIds, 'name');
    if (!image.adventure_by || image.adventure_by === 'guess' || image.adventure_by === 'name') {
      db.prepare('UPDATE art_images SET adventure_id = ?, adventure_by = ? WHERE id = ?').run(adventureId, adventureId ? 'name' : null, image.id);
    }
    refreshGuess(image.id);
  }
}

// One Discord message with images. attachments: [{ id, name, contentType,
// width, height }] (only images are kept). Returns { images, created }.
function recordArtMessage({ messageId, channelId, guildId, threadName, posterDiscordId, posterTag, postedAt, text, attachments }) {
  const images = (attachments || []).filter(isArtAttachment);
  if (!images.length) return { images: messageImages(messageId), created: [] };
  const created = [];
  db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO art_images (attachment_id, message_id, channel_id, guild_id, thread_name, posted_by_discord_id,
        posted_by_tag, posted_at, message_text, filename, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const attachment of images) {
      const result = insert.run(String(attachment.id), String(messageId), channelId || null, guildId || null, threadName || null,
        posterDiscordId || null, posterTag || null, postedAt || null, String(text || '').slice(0, 2000),
        attachment.name || null, Number(attachment.width) || null, Number(attachment.height) || null);
      if (result.changes) created.push(Number(result.lastInsertRowid));
    }
    const all = messageImages(messageId);
    const textChanged = all.some(image => (image.message_text || '') !== String(text || '').slice(0, 2000));
    if (textChanged) db.prepare('UPDATE art_images SET message_text = ? WHERE message_id = ?').run(String(text || '').slice(0, 2000), String(messageId));
    // New images of a tagged message share its tags.
    const tagged = all.find(image => !created.includes(image.id));
    if (tagged && created.length) {
      const tags = imageTags(tagged.id);
      for (const id of created) {
        setTags(id, tags, tagged.tagged_by || 'name');
        db.prepare('UPDATE art_images SET adventure_id = ?, adventure_by = ?, not_art = ? WHERE id = ?')
          .run(tagged.adventure_id, tagged.adventure_by, tagged.not_art, id);
      }
    }
    if (created.length || textChanged) {
      const threadText = threadName ? `\n${threadName}` : '';
      tagFromText(messageImages(messageId), `${text || ''}${threadText}`);
    }
  })();
  return { images: messageImages(messageId), created };
}

// ─── Tagging ────────────────────────────────────────────────────────────────

function checkCharacters(ids) {
  const list = [...new Set([].concat(ids || []).filter(id => id !== '' && id !== null && id !== undefined).map(Number))];
  for (const id of list) {
    if (!Number.isSafeInteger(id) || !db.prepare('SELECT id FROM characters WHERE id = ?').get(id)) throw new Error('Character not found.');
  }
  return list;
}

// adventure: 'guess' | 'none' | an adventure id.
function setAdventure(imageId, adventure, by) {
  if (adventure === undefined) return;
  if (adventure === 'guess' || adventure === '' || adventure === null) {
    db.prepare("UPDATE art_images SET adventure_by = 'guess' WHERE id = ?").run(imageId);
    refreshGuess(imageId);
    return;
  }
  if (adventure === 'none') {
    db.prepare("UPDATE art_images SET adventure_id = NULL, adventure_by = 'none' WHERE id = ?").run(imageId);
    return;
  }
  const id = Number(adventure);
  if (!db.prepare('SELECT id FROM adventures WHERE id = ?').get(id)) throw new Error('Adventure not found.');
  db.prepare('UPDATE art_images SET adventure_id = ?, adventure_by = ? WHERE id = ?').run(id, by, imageId);
}

// Tag art in Discord, for every image of the message. characterIds replace
// the tags among `among` (the characters that menu offered; all if not given).
function tagArtMessage(messageId, { characterIds, among, adventure, notArt }, by = 'discord') {
  const images = messageImages(messageId);
  if (!images.length) throw new Error('Grimbold has no images from that message.');
  db.transaction(() => {
    for (const image of images) {
      if (characterIds !== undefined) {
        const chosen = checkCharacters(characterIds);
        const scope = among ? new Set(checkCharacters(among)) : null;
        const kept = scope ? imageTags(image.id).filter(id => !scope.has(id)) : [];
        setTags(image.id, [...new Set([...kept, ...chosen])], by);
        refreshGuess(image.id);
      }
      setAdventure(image.id, adventure, by);
      if (notArt !== undefined) db.prepare('UPDATE art_images SET not_art = ?, tagged_by = ? WHERE id = ?').run(notArt ? 1 : 0, by, image.id);
    }
  })();
  return messageImages(messageId);
}

// The DM in the panel, one image: { characterIds, adventure, notArt }.
function updateArtImage(id, { characterIds, adventure, notArt }) {
  const image = db.prepare('SELECT id FROM art_images WHERE id = ?').get(Number(id));
  if (!image) throw new Error('Image not found.');
  db.transaction(() => {
    if (characterIds !== undefined) {
      setTags(image.id, checkCharacters(characterIds), 'dm');
      refreshGuess(image.id);
    }
    setAdventure(image.id, adventure, 'dm');
    if (notArt !== undefined) db.prepare('UPDATE art_images SET not_art = ?, tagged_by = ? WHERE id = ?').run(notArt ? 1 : 0, 'dm', image.id);
  })();
  return getArtImage(image.id, { isAdmin: true });
}

// ─── Reading ────────────────────────────────────────────────────────────────

const VISIBLE = 'i.not_art = 0 AND EXISTS (SELECT 1 FROM art_image_characters x WHERE x.image_id = i.id)';

function withCharacters(rows) {
  if (!rows.length) return rows;
  const ids = rows.map(row => row.id);
  const tags = db.prepare(`
    SELECT t.image_id, c.id, c.name, c.status FROM art_image_characters t JOIN characters c ON c.id = t.character_id
    WHERE t.image_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.name COLLATE NOCASE
  `).all(...ids);
  const byImage = new Map();
  for (const tag of tags) {
    if (!byImage.has(tag.image_id)) byImage.set(tag.image_id, []);
    byImage.get(tag.image_id).push({ id: tag.id, name: tag.name, status: tag.status });
  }
  return rows.map(row => present(row, byImage.get(row.id) || []));
}

function present(row, characters) {
  const version = encodeURIComponent(row.file || '');
  return {
    ...row,
    not_art: Boolean(row.not_art),
    characters,
    visible: !row.not_art && characters.length > 0,
    imageUrl: row.file ? `/api/art/${row.id}/image?v=${version}` : null,
    thumbUrl: row.file ? `/api/art/${row.id}/image?size=thumb&v=${version}` : null,
    messageUrl: row.guild_id && row.channel_id && row.message_id
      ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}` : null
  };
}

const COLUMNS = 'i.*, a.title AS adventure_title';

// view: 'gallery' (tagged art), 'unsorted' (no character yet), 'not_art'.
// characterId / adventureId narrow the gallery. limit: the newest so many.
function listArtImages({ view = 'gallery', characterId, adventureId, limit } = {}) {
  const where = [];
  const params = [];
  if (view === 'unsorted') where.push('i.not_art = 0 AND NOT EXISTS (SELECT 1 FROM art_image_characters x WHERE x.image_id = i.id)');
  else if (view === 'not_art') where.push('i.not_art = 1');
  else where.push(VISIBLE);
  if (characterId) { where.push('EXISTS (SELECT 1 FROM art_image_characters y WHERE y.image_id = i.id AND y.character_id = ?)'); params.push(Number(characterId)); }
  if (adventureId) { where.push('i.adventure_id = ?'); params.push(Number(adventureId)); }
  const rows = db.prepare(`
    SELECT ${COLUMNS} FROM art_images i LEFT JOIN adventures a ON a.id = i.adventure_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(i.posted_at, i.created_at) DESC, i.id DESC
    ${limit ? 'LIMIT ?' : ''}
  `).all(...params, ...(limit ? [Number(limit)] : []));
  return withCharacters(rows);
}

function getArtImage(id, { isAdmin } = {}) {
  const row = db.prepare(`SELECT ${COLUMNS} FROM art_images i LEFT JOIN adventures a ON a.id = i.adventure_id WHERE i.id = ?`).get(Number(id));
  if (!row) return null;
  const [image] = withCharacters([row]);
  return image.visible || isAdmin ? image : null;
}

function getArtMessage(messageId) {
  return withCharacters(db.prepare(`SELECT ${COLUMNS} FROM art_images i LEFT JOIN adventures a ON a.id = i.adventure_id WHERE i.message_id = ? ORDER BY i.id`).all(String(messageId)));
}

// Counts for the tab: { gallery, unsorted, notArt, byCharacter: Map, byAdventure: Map }.
function artCounts() {
  const count = sql => db.prepare(`SELECT COUNT(*) AS n FROM art_images i WHERE ${sql}`).get().n;
  const byCharacter = new Map(db.prepare(`
    SELECT t.character_id AS id, COUNT(*) AS n FROM art_image_characters t JOIN art_images i ON i.id = t.image_id
    WHERE i.not_art = 0 GROUP BY t.character_id
  `).all().map(row => [row.id, row.n]));
  const byAdventure = new Map(db.prepare(`
    SELECT i.adventure_id AS id, COUNT(*) AS n FROM art_images i WHERE i.adventure_id IS NOT NULL AND ${VISIBLE} GROUP BY i.adventure_id
  `).all().map(row => [row.id, row.n]));
  return {
    gallery: count(VISIBLE),
    unsorted: count('i.not_art = 0 AND NOT EXISTS (SELECT 1 FROM art_image_characters x WHERE x.image_id = i.id)'),
    notArt: count('i.not_art = 1'),
    byCharacter,
    byAdventure
  };
}

// Adventures to offer for an image: those all its characters were in first,
// then the rest, the latest first. [{ id, title, status, fits }].
function listArtAdventureChoices({ characterIds = [], postedAt, limit = 200 } = {}) {
  const ids = [...new Set(characterIds.map(Number))];
  const at = postedAt || new Date().toISOString();
  const fits = ids.length ? ids.map(() => tookPart).join(' AND ') : '0';
  return db.prepare(`
    SELECT a.id, a.title, a.status, (${fits}) AS fits FROM adventures a
    WHERE a.status != 'cancelled'
    ORDER BY fits DESC, ${lastActivity} DESC, a.id DESC LIMIT ?
  `).all(...ids.flatMap(id => [id, id]), at, Number(limit)).map(row => ({ ...row, fits: Boolean(row.fits) }));
}

// ─── Files ──────────────────────────────────────────────────────────────────

function removeFile(name) {
  if (name && name === path.basename(name)) fs.rmSync(path.join(dir(), name), { force: true });
}

// Grimbold's copy of an image (and a smaller one for the gallery, if Discord
// made one). error: why the download failed, kept to show in the panel.
function saveArtFiles(id, { buffer, thumb, error }) {
  const image = db.prepare('SELECT * FROM art_images WHERE id = ?').get(Number(id));
  if (!image) throw new Error('Image not found.');
  if (error) {
    db.prepare('UPDATE art_images SET download_error = ? WHERE id = ?').run(String(error).slice(0, 300), image.id);
    return;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_IMAGE_BYTES) throw new Error('That image is too large to keep.');
  const type = sniffImage(buffer);
  if (!type) throw new Error('That file is not a PNG, JPG, WebP or GIF image.');
  fs.mkdirSync(dir(), { recursive: true });
  const base = `art-${image.id}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(path.join(dir(), `${base}.${type}`), buffer);
  const thumbType = Buffer.isBuffer(thumb) && thumb.length < buffer.length ? sniffImage(thumb) : null;
  if (thumbType) fs.writeFileSync(path.join(dir(), `${base}-thumb.${thumbType}`), thumb);
  db.prepare('UPDATE art_images SET file = ?, thumb_file = ?, download_error = NULL WHERE id = ?')
    .run(`${base}.${type}`, thumbType ? `${base}-thumb.${thumbType}` : null, image.id);
  removeFile(image.file);
  removeFile(image.thumb_file);
}

// { file, contentType } to send, or null. size 'thumb' falls back to the image.
function getArtFile(id, { size } = {}) {
  const image = db.prepare('SELECT file, thumb_file FROM art_images WHERE id = ?').get(Number(id));
  if (!image) return null;
  for (const name of size === 'thumb' ? [image.thumb_file, image.file] : [image.file]) {
    if (!name || name !== path.basename(name)) continue;
    const file = path.join(dir(), name);
    if (fs.existsSync(file)) return { file, contentType: CONTENT_TYPES[path.extname(name).slice(1)] || 'application/octet-stream' };
  }
  return null;
}

// Images Grimbold has no copy of yet, by message (to fetch their links again).
function listArtMessagesWithoutFile(limit = 20) {
  return db.prepare(`
    SELECT message_id, channel_id FROM art_images WHERE file IS NULL
    GROUP BY message_id ORDER BY MIN(id) LIMIT ?
  `).all(Number(limit));
}

const SCAN_KEY = 'art_scan';
function getArtScanStatus() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(SCAN_KEY);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
function setArtScanStatus(status) {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SCAN_KEY, JSON.stringify(status));
}

module.exports = {
  ART_MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
  isArtAttachment,
  matchArtCharacters,
  matchArtAdventure,
  guessArtAdventure,
  recordArtMessage,
  tagArtMessage,
  updateArtImage,
  listArtImages,
  getArtImage,
  getArtMessage,
  artCounts,
  listArtAdventureChoices,
  saveArtFiles,
  getArtFile,
  listArtMessagesWithoutFile,
  getArtScanStatus,
  setArtScanStatus
};
