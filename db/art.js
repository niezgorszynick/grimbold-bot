// db/art.js — The Art tab: images posted in the Discord art channel (art.js
// reads the channel and keeps a copy of each). An image is tagged with the
// characters in it, several if need be, and with an adventure. Grimbold tags
// what the post names; anyone with a panel account fixes it with Discord's
// "Tag art" menu, and DMs in the panel. Only images with a character show in
// the gallery: the rest wait in "To sort". Memes are a category of their own
// (shown whether or not anyone is tagged), and screenshots and the like are
// marked Not art. Everyone signed in sees the gallery and the memes.

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

// ─── Others in a picture, and the artist ────────────────────────────────────

const cleanName = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
const companionWord = kind => (kind === 'pet' ? 'pet' : 'familiar');

// What can be named besides the characters: public Notable NPCs, and named
// familiars and pets. [{ kind, refId, name, label }].
function figureCandidates() {
  const npcs = db.prepare('SELECT id, name FROM npcs WHERE COALESCE(private, 0) = 0').all()
    .map(npc => ({ kind: 'npc', refId: npc.id, name: npc.name, label: `${npc.name} (NPC)` }));
  const companions = db.prepare(`
    SELECT co.id, co.name, co.kind, c.name AS owner FROM companions co JOIN characters c ON c.id = co.character_id
    WHERE co.name IS NOT NULL AND TRIM(co.name) != ''
  `).all().map(row => ({ kind: 'companion', refId: row.id, name: row.name, label: `${row.name} (${row.owner}'s ${companionWord(row.kind)})` }));
  return [...npcs, ...companions];
}

// The figure for an NPC or companion (made on first use), or for a name.
function ensureFigure(kind, refId, name) {
  const clean = cleanName(name);
  if (kind === 'custom') {
    const key = nameText(clean);
    const found = db.prepare("SELECT id FROM art_figures WHERE kind = 'custom' AND name_key = ?").get(key);
    if (found) return found.id;
    return Number(db.prepare("INSERT INTO art_figures (kind, name, name_key) VALUES ('custom', ?, ?)").run(clean, key).lastInsertRowid);
  }
  const found = db.prepare('SELECT id FROM art_figures WHERE kind = ? AND ref_id = ?').get(kind, refId);
  if (found) {
    db.prepare('UPDATE art_figures SET name = ?, name_key = ? WHERE id = ?').run(clean, nameText(clean), found.id);
    return found.id;
  }
  return Number(db.prepare('INSERT INTO art_figures (kind, ref_id, name, name_key) VALUES (?, ?, ?, ?)').run(kind, refId, clean, nameText(clean)).lastInsertRowid);
}

// A typed name → { characterId } or { figureId }, or null for nothing. The
// same name in another case, with other spaces, accents or punctuation is the
// same one: an NPC or a familiar as the suggestions label them, a name used
// before, a player character, an NPC or a familiar by name; else a new name.
function resolveArtFigure(text) {
  const name = cleanName(text);
  const key = nameText(name);
  if (!key) return null;
  const candidates = figureCandidates();
  const byLabel = candidates.find(candidate => nameText(candidate.label) === key);
  if (byLabel) return { figureId: ensureFigure(byLabel.kind, byLabel.refId, byLabel.name) };
  const used = db.prepare('SELECT id FROM art_figures WHERE name_key = ? ORDER BY (kind = \'custom\') DESC, id').all(key);
  if (used.length) return { figureId: used[0].id };
  const characters = allCharacters().filter(character => nameText(character.name) === key);
  if (characters.length === 1) return { characterId: characters[0].id };
  const named = candidates.filter(candidate => nameText(candidate.name) === key);
  if (named.length === 1) return { figureId: ensureFigure(named[0].kind, named[0].refId, named[0].name) };
  return { figureId: ensureFigure('custom', null, name) };
}

// Names typed in a list, split on commas and new lines → { characterIds, figureIds }.
function resolveArtNames(names) {
  const characterIds = new Set();
  const figureIds = new Set();
  for (const entry of [].concat(names || []).flatMap(value => String(value).split(/[,\n;]+/))) {
    const found = resolveArtFigure(entry);
    if (found && found.characterId) characterIds.add(found.characterId);
    if (found && found.figureId) figureIds.add(found.figureId);
  }
  return { characterIds: [...characterIds], figureIds: [...figureIds] };
}

// The NPCs, familiars and names used before that a post names in full.
function matchArtFigures(text) {
  const words = nameText(text);
  if (!words) return [];
  const found = new Set();
  for (const figure of db.prepare("SELECT id, name_key FROM art_figures WHERE kind = 'custom'").all()) {
    if (figure.name_key.length >= 4 && textHasWord(words, figure.name_key)) found.add(figure.id);
  }
  for (const candidate of figureCandidates()) {
    const key = nameText(candidate.name);
    if (key.length >= 4 && textHasWord(words, key)) found.add(ensureFigure(candidate.kind, candidate.refId, candidate.name));
  }
  return [...found];
}

// "Art by Selkie", "autor: Selkie", "rys. Selkie", "credit: @Selkie" → 'Selkie'.
function parseArtist(text) {
  const patterns = [
    /\b(?:art|arts|drawn|drawing|painted|painting|illustrated|illustration|sketched|sketch|made)\s+by\s*:?\s*([^\n,.;|()!?]+)/i,
    /(?:^|[\s(])(?:autor(?:ka)?|artyst(?:a|ka)|narysowa[lł]a?|rysowa[lł]a?|rysunek|rys\.|kredyty?|credits?|artist)\s*:?\s*([^\n,.;|()!?]+)/i,
    /(?:^|\s)by\s*:?\s*(@[^\n,.;|()!?]+)/i
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (!match) continue;
    const name = cleanName(match[1].replace(/^@/, '')).split(' ').slice(0, 4).join(' ');
    if (name.length >= 2) return name;
  }
  return null;
}

// An artist credited before under the same name keeps that spelling.
function canonicalArtist(name) {
  const clean = cleanName(name);
  if (!clean) return null;
  const key = nameText(clean);
  const known = db.prepare('SELECT DISTINCT artist_name FROM art_images WHERE artist_name IS NOT NULL').all()
    .find(row => nameText(row.artist_name) === key);
  return known ? known.artist_name : clean;
}

function checkArtistUrl(url) {
  const value = String(url || '').trim();
  if (!value) return null;
  if (!/^https?:\/\/\S+$/i.test(value) || value.length > 300) throw new Error('The artist\'s link must be a web address starting with http:// or https://.');
  return value;
}

// artist: a name ('' = none); url: undefined keeps the link.
function setArtist(imageId, { artist, url }, by) {
  if (artist === undefined && url === undefined) return;
  const current = db.prepare('SELECT artist_name, artist_url FROM art_images WHERE id = ?').get(imageId);
  const name = artist === undefined ? current.artist_name : canonicalArtist(artist);
  const link = url === undefined ? current.artist_url : checkArtistUrl(url);
  // Cleared by hand stays cleared; otherwise nobody set it.
  db.prepare('UPDATE art_images SET artist_name = ?, artist_url = ?, artist_by = ? WHERE id = ?')
    .run(name, name ? link : null, name || HUMAN.includes(by) ? by : null, imageId);
}

// Who posted it, by their player name in the panel (or Discord's name for
// someone without an account): the artist unless the post credits another.
function posterArtist({ posterDiscordId, posterTag }) {
  const player = posterDiscordId ? db.prepare('SELECT discord_tag FROM players WHERE discord_id = ?').get(String(posterDiscordId)) : null;
  return (player && player.discord_tag) || posterTag || null;
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
const imageFigures = imageId => db.prepare('SELECT figure_id FROM art_image_figures WHERE image_id = ?').all(imageId).map(row => row.figure_id);

function setFigures(imageId, figureIds) {
  db.prepare('DELETE FROM art_image_figures WHERE image_id = ?').run(imageId);
  const add = db.prepare('INSERT OR IGNORE INTO art_image_figures (image_id, figure_id) VALUES (?, ?)');
  for (const id of figureIds) add.run(imageId, id);
}

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
  if (images.some(image => HUMAN.includes(image.tagged_by) || image.not_art || image.is_meme)) return;
  const characterIds = matchArtCharacters({ text, characters: allCharacters() });
  const figureIds = matchArtFigures(text);
  const adventureId = matchArtAdventure({ text, adventures: allAdventures() });
  for (const image of images) {
    setTags(image.id, characterIds, 'name');
    setFigures(image.id, figureIds);
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
    // New images of a tagged message share its tags and credit.
    const tagged = all.find(image => !created.includes(image.id));
    if (tagged && created.length) {
      const tags = imageTags(tagged.id);
      const figures = imageFigures(tagged.id);
      for (const id of created) {
        setTags(id, tags, tagged.tagged_by || 'name');
        setFigures(id, figures);
        db.prepare('UPDATE art_images SET adventure_id = ?, adventure_by = ?, not_art = ?, is_meme = ?, is_reference = ?, also_art = ?, artist_name = ?, artist_url = ?, artist_by = ? WHERE id = ?')
          .run(tagged.adventure_id, tagged.adventure_by, tagged.not_art, tagged.is_meme, tagged.is_reference, tagged.also_art, tagged.artist_name, tagged.artist_url, tagged.artist_by, id);
      }
    }
    if (created.length || textChanged) {
      const threadText = threadName ? `\n${threadName}` : '';
      tagFromText(messageImages(messageId), `${text || ''}${threadText}`);
      // The artist the post credits, else the poster, unless someone set one by hand.
      const artist = parseArtist(text);
      const poster = posterArtist({ posterDiscordId, posterTag });
      for (const image of messageImages(messageId)) {
        if (image.artist_by && !['name', 'poster'].includes(image.artist_by)) continue;
        setArtist(image.id, { artist: artist || poster || '', url: '' }, artist ? 'name' : 'poster');
      }
    }
  })();
  return { images: messageImages(messageId), created };
}

// ─── Tagging ────────────────────────────────────────────────────────────────

// both: art and reference at once (art from a session that is also a
// reference for the character): in the gallery and under Reference.
const CATEGORIES = ['art', 'both', 'meme', 'reference', 'not_art'];
const categoryOf = image => (image.not_art ? 'not_art' : image.is_meme ? 'meme' : image.is_reference ? (image.also_art ? 'both' : 'reference') : 'art');

// category: 'art' | 'both' | 'meme' | 'reference' | 'not_art'. notArt
// (true/false) is the older way to say not_art or art.
function setCategory(imageId, { category, notArt }, by) {
  const value = category !== undefined ? category : notArt === undefined ? undefined : notArt ? 'not_art' : 'art';
  if (value === undefined) return;
  if (!CATEGORIES.includes(value)) throw new Error('Unknown category.');
  db.prepare('UPDATE art_images SET not_art = ?, is_meme = ?, is_reference = ?, also_art = ?, tagged_by = ? WHERE id = ?')
    .run(value === 'not_art' ? 1 : 0, value === 'meme' ? 1 : 0, value === 'reference' || value === 'both' ? 1 : 0, value === 'both' ? 1 : 0, by, imageId);
  // Reference material belongs to no adventure, unless one is chosen for it
  // (art that is also reference keeps its adventure).
  if (value === 'reference') {
    db.prepare("UPDATE art_images SET adventure_id = NULL, adventure_by = 'none' WHERE id = ? AND (adventure_by IS NULL OR adventure_by IN ('guess', 'name'))").run(imageId);
  }
}

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
// others: the names of everyone else in it (they replace the earlier ones; a
// player character's name adds that character). artist, artistUrl: the credit.
function tagArtMessage(messageId, { characterIds, among, adventure, notArt, category, others, artist, artistUrl }, by = 'discord') {
  const images = messageImages(messageId);
  if (!images.length) throw new Error('Grimbold has no images from that message.');
  if (artistUrl !== undefined) checkArtistUrl(artistUrl);
  db.transaction(() => {
    const named = others === undefined ? null : resolveArtNames(others);
    for (const image of images) {
      if (characterIds !== undefined) {
        const chosen = checkCharacters(characterIds);
        const scope = among ? new Set(checkCharacters(among)) : null;
        const kept = scope ? imageTags(image.id).filter(id => !scope.has(id)) : [];
        setTags(image.id, [...new Set([...kept, ...chosen])], by);
        refreshGuess(image.id);
      }
      if (named) {
        setFigures(image.id, named.figureIds);
        setTags(image.id, [...new Set([...imageTags(image.id), ...named.characterIds])], by);
        refreshGuess(image.id);
      }
      setArtist(image.id, { artist, url: artistUrl }, by);
      setAdventure(image.id, adventure, by);
      setCategory(image.id, { category, notArt }, by);
    }
  })();
  return messageImages(messageId);
}

// The DM in the panel, one image: { characterIds, figureIds (kept), others
// (names to add), adventure, category ('art' | 'meme' | 'not_art') or notArt,
// artist, artistUrl }.
function updateArtImage(id, { characterIds, figureIds, others, adventure, notArt, category, artist, artistUrl, caption }) {
  const image = db.prepare('SELECT id, uploaded_by_player_id, message_id FROM art_images WHERE id = ?').get(Number(id));
  if (!image) throw new Error('Image not found.');
  // An upload's caption is written in the panel (a post's is its text).
  if (caption !== undefined && String(image.message_id).startsWith('upload:')) {
    db.prepare('UPDATE art_images SET message_text = ? WHERE id = ?').run(String(caption).trim().slice(0, 2000) || null, image.id);
  }
  if (artistUrl !== undefined) checkArtistUrl(artistUrl);
  db.transaction(() => {
    const named = others === undefined ? { characterIds: [], figureIds: [] } : resolveArtNames(others);
    if (characterIds !== undefined || named.characterIds.length) {
      const base = characterIds === undefined ? imageTags(image.id) : checkCharacters(characterIds);
      setTags(image.id, [...new Set([...base, ...named.characterIds])], 'dm');
      refreshGuess(image.id);
    }
    if (figureIds !== undefined || named.figureIds.length) {
      const kept = figureIds === undefined ? imageFigures(image.id) : [].concat(figureIds).map(Number).filter(Number.isSafeInteger);
      setFigures(image.id, [...new Set([...kept, ...named.figureIds])]);
      db.prepare('UPDATE art_images SET tagged_by = ? WHERE id = ?').run('dm', image.id);
    }
    setArtist(image.id, { artist, url: artistUrl }, 'dm');
    setAdventure(image.id, adventure, 'dm');
    setCategory(image.id, { category, notArt }, 'dm');
  })();
  return getArtImage(image.id, { isAdmin: true });
}

// ─── Reading ────────────────────────────────────────────────────────────────

const HAS_SOMEONE = `(EXISTS (SELECT 1 FROM art_image_characters x WHERE x.image_id = i.id)
  OR EXISTS (SELECT 1 FROM art_image_figures z WHERE z.image_id = i.id))`;
// In the gallery: art (or art that is also reference) with somebody in it.
const IN_GALLERY = 'i.not_art = 0 AND i.is_meme = 0 AND (i.is_reference = 0 OR i.also_art = 1)';
const VISIBLE = `${IN_GALLERY} AND ${HAS_SOMEONE}`;
const UNSORTED = `i.not_art = 0 AND i.is_meme = 0 AND i.is_reference = 0 AND NOT ${HAS_SOMEONE}`;
const MEMES = 'i.not_art = 0 AND i.is_meme = 1';
const REFERENCES = 'i.not_art = 0 AND i.is_reference = 1';
// Art + Reference: everything about someone but memes.
const EVERYTHING = `((${VISIBLE}) OR (${REFERENCES}))`;

// Figures with the names they go by now: [{ id, kind, name, label, characterId }].
const FIGURE_COLUMNS = `f.id, f.kind,
  COALESCE(n.name, co.name, f.name) AS name, co.kind AS companion_kind, oc.name AS owner, oc.id AS owner_id`;
const FIGURE_JOINS = `LEFT JOIN npcs n ON f.kind = 'npc' AND n.id = f.ref_id AND COALESCE(n.private, 0) = 0
  LEFT JOIN companions co ON f.kind = 'companion' AND co.id = f.ref_id
  LEFT JOIN characters oc ON oc.id = co.character_id`;
function figureView(row) {
  const label = row.kind === 'npc' ? `${row.name} (NPC)`
    : row.kind === 'companion' && row.owner ? `${row.name} (${row.owner}'s ${companionWord(row.companion_kind)})` : row.name;
  return { id: row.id, kind: row.kind, name: row.name, label, ownerId: row.owner_id || null };
}

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
  const figures = db.prepare(`
    SELECT t.image_id, ${FIGURE_COLUMNS} FROM art_image_figures t JOIN art_figures f ON f.id = t.figure_id ${FIGURE_JOINS}
    WHERE t.image_id IN (${ids.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE
  `).all(...ids);
  const figuresByImage = new Map();
  for (const figure of figures) {
    if (!figuresByImage.has(figure.image_id)) figuresByImage.set(figure.image_id, []);
    figuresByImage.get(figure.image_id).push(figureView(figure));
  }
  return rows.map(row => present(row, byImage.get(row.id) || [], figuresByImage.get(row.id) || []));
}

function present(row, characters, figures = []) {
  const version = encodeURIComponent(row.file || '');
  return {
    ...row,
    not_art: Boolean(row.not_art),
    is_meme: Boolean(row.is_meme),
    is_reference: Boolean(row.is_reference),
    also_art: Boolean(row.also_art),
    uploaded: String(row.message_id || '').startsWith('upload:'),
    category: categoryOf(row),
    characters,
    figures,
    visible: !row.not_art && (Boolean(row.is_meme) || Boolean(row.is_reference) || characters.length > 0 || figures.length > 0),
    imageUrl: row.file ? `/api/art/${row.id}/image?v=${version}` : null,
    thumbUrl: row.file ? `/api/art/${row.id}/image?size=thumb&v=${version}` : null,
    messageUrl: row.guild_id && row.channel_id && row.message_id
      ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}` : null
  };
}

const COLUMNS = `i.*, a.title AS adventure_title,
  COALESCE((SELECT p.discord_tag FROM players p WHERE p.discord_id = i.posted_by_discord_id), i.posted_by_tag) AS poster_name`;

// view: 'gallery' (tagged art), 'memes', 'references', 'all' (art and
// reference), 'unsorted' (art with nobody in it yet), 'not_art'.
// characterId / figureId / adventureId / artist narrow the gallery. limit:
// the newest so many.
function listArtImages({ view = 'gallery', characterId, figureId, adventureId, artist, limit } = {}) {
  const where = [];
  const params = [];
  if (figureId) { where.push('EXISTS (SELECT 1 FROM art_image_figures w WHERE w.image_id = i.id AND w.figure_id = ?)'); params.push(Number(figureId)); }
  if (artist) { where.push('i.artist_name = ?'); params.push(String(artist)); }
  if (view === 'unsorted') where.push(UNSORTED);
  else if (view === 'not_art') where.push('i.not_art = 1');
  else if (view === 'memes') where.push(MEMES);
  else if (view === 'references') where.push(REFERENCES);
  else if (view === 'all') where.push(EVERYTHING);
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
    WHERE ${IN_GALLERY} GROUP BY t.character_id
  `).all().map(row => [row.id, row.n]));
  const byAdventure = new Map(db.prepare(`
    SELECT i.adventure_id AS id, COUNT(*) AS n FROM art_images i WHERE i.adventure_id IS NOT NULL AND ${VISIBLE} GROUP BY i.adventure_id
  `).all().map(row => [row.id, row.n]));
  return {
    gallery: count(VISIBLE),
    unsorted: count(UNSORTED),
    notArt: count('i.not_art = 1'),
    memes: count(MEMES),
    references: count(REFERENCES),
    all: count(EVERYTHING),
    byCharacter,
    byAdventure
  };
}

// Everyone besides the characters who is in some art: [{ id, label, count }].
function listArtFigures() {
  return db.prepare(`
    SELECT ${FIGURE_COLUMNS}, COUNT(*) AS count FROM art_image_figures t JOIN art_images i ON i.id = t.image_id
    JOIN art_figures f ON f.id = t.figure_id ${FIGURE_JOINS}
    WHERE ${IN_GALLERY} GROUP BY f.id ORDER BY name COLLATE NOCASE
  `).all().map(row => ({ ...figureView(row), count: row.count }));
}

// What the "others" box suggests: names used before, public NPCs, named
// familiars and pets, by their labels.
function artFigureSuggestions() {
  const labels = new Map();
  for (const figure of db.prepare(`SELECT ${FIGURE_COLUMNS} FROM art_figures f ${FIGURE_JOINS}`).all().map(figureView)) {
    if (figure.kind === 'custom' || figure.label !== figure.name) labels.set(nameText(figure.label), figure.label);
  }
  for (const candidate of figureCandidates()) labels.set(nameText(candidate.label), candidate.label);
  return [...labels.values()].sort((a, b) => a.localeCompare(b));
}

// Credited artists: [{ name, count }], the most credited first.
function listArtArtists() {
  return db.prepare(`
    SELECT i.artist_name AS name, COUNT(*) AS count FROM art_images i
    WHERE i.artist_name IS NOT NULL AND ${VISIBLE} GROUP BY i.artist_name ORDER BY count DESC, name COLLATE NOCASE
  `).all();
}

function listKnownArtists() {
  return db.prepare('SELECT DISTINCT artist_name AS name FROM art_images WHERE artist_name IS NOT NULL ORDER BY artist_name COLLATE NOCASE').all().map(row => row.name);
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
    SELECT message_id, channel_id FROM art_images WHERE file IS NULL AND message_id NOT LIKE 'upload:%'
    GROUP BY message_id ORDER BY MIN(id) LIMIT ?
  `).all(Number(limit));
}

// ─── Art editors ────────────────────────────────────────────────────────────

// Players (by Discord ID) who tag and sort the Art tab as DMs do.
function getArtEditors() {
  const row = db.prepare("SELECT value FROM config WHERE key = 'art_editors'").get();
  try {
    const list = row ? JSON.parse(row.value) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

// ids: Discord IDs, as a list or text (any separators). Returns the list kept.
function setArtEditors(ids) {
  const list = [...new Set([].concat(ids || []).flatMap(value => String(value).split(/[^0-9]+/)).filter(id => /^\d{15,22}$/.test(id)))];
  const bad = [].concat(ids || []).flatMap(value => String(value).split(/[\s,;]+/)).filter(token => token && !/^\d{15,22}$/.test(token));
  if (bad.length) throw new Error(`Not a Discord ID: ${bad.slice(0, 3).join(', ')}. Copy it with right-click → Copy User ID.`);
  db.prepare("INSERT INTO config (key, value) VALUES ('art_editors', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(list));
  return list;
}

// DMs, and players on the editors list.
function canEditArt(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!(Number(user.id) > 0)) return false;
  const player = db.prepare('SELECT discord_id FROM players WHERE id = ?').get(Number(user.id));
  return Boolean(player && getArtEditors().includes(String(player.discord_id)));
}

// DMs and art editors edit any image; a player the images they uploaded.
function canEditArtImage(user, imageId) {
  if (canEditArt(user)) return true;
  if (!user || !(Number(user.id) > 0)) return false;
  const image = db.prepare('SELECT uploaded_by_player_id FROM art_images WHERE id = ?').get(Number(imageId));
  return Boolean(image && image.uploaded_by_player_id === Number(user.id));
}

// A player uploads reference material in the panel: the image and an
// optional caption. Returns the new image's id.
function uploadArtImage({ user, buffer, caption }) {
  if (!user) throw new Error('Log in to upload.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose an image to upload.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Images can be 25 MB at most.');
  if (!sniffImage(buffer)) throw new Error('Only PNG, JPG, WebP or GIF images can be uploaded.');
  const player = Number(user.id) > 0 ? db.prepare('SELECT id, discord_id, discord_tag FROM players WHERE id = ?').get(Number(user.id)) : null;
  const key = `upload:${crypto.randomBytes(9).toString('hex')}`;
  const id = Number(db.prepare(`
    INSERT INTO art_images (attachment_id, message_id, posted_by_discord_id, posted_by_tag, posted_at, message_text,
      is_reference, uploaded_by_player_id, tagged_by, adventure_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, 'none')
  `).run(key, key, player ? player.discord_id : null, player ? player.discord_tag : (user.discord_tag || 'admin'),
    new Date().toISOString(), String(caption || '').trim().slice(0, 2000) || null, player ? player.id : null).lastInsertRowid);
  try {
    saveArtFiles(id, { buffer });
  } catch (error) {
    db.prepare('DELETE FROM art_images WHERE id = ?').run(id);
    throw error;
  }
  return id;
}

// Uploads can be deleted (by whoever may edit them); Discord posts can't, as
// the next look at the channel would bring them back: mark them Not art.
function deleteArtUpload(id, user) {
  const image = db.prepare('SELECT * FROM art_images WHERE id = ?').get(Number(id));
  if (!image) throw new Error('Image not found.');
  if (!String(image.message_id).startsWith('upload:')) throw new Error('Only uploaded images can be deleted; mark a Discord post Not art instead.');
  if (!canEditArtImage(user, image.id)) throw new Error('Forbidden.');
  db.prepare('DELETE FROM art_images WHERE id = ?').run(image.id);
  removeFile(image.file);
  removeFile(image.thumb_file);
}

// The list for the DMs' card: [{ discordId, tag }] (tag null: no panel account).
function listArtEditors() {
  return getArtEditors().map(discordId => {
    const player = db.prepare('SELECT discord_tag FROM players WHERE discord_id = ?').get(discordId);
    return { discordId, tag: player ? player.discord_tag : null };
  });
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
  getArtEditors,
  setArtEditors,
  canEditArt,
  canEditArtImage,
  uploadArtImage,
  deleteArtUpload,
  listArtEditors,
  resolveArtFigure,
  parseArtist,
  listArtFigures,
  artFigureSuggestions,
  listArtArtists,
  listKnownArtists,
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
