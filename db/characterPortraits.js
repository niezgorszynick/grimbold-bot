// db/characterPortraits.js — Small character portraits: uploaded by the
// character's owner or a DM, seen by everyone logged in (sheet, adventure
// table, Players tab). Stored in uploads/characters next to the database, named
// after the character; the file type comes from its bytes (db/npcFiles.js).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, uploadsDir } = require('./connection');
const { sniffImage, NPC_FILE_MAX_BYTES } = require('./npcFiles');

const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const dir = () => path.join(uploadsDir, 'characters');

function removeFile(name) {
  if (name && name === path.basename(name)) fs.rmSync(path.join(dir(), name), { force: true });
}

// The browser URL of a character's portrait, or null. The file name busts the cache.
function characterPortraitUrl(character) {
  return character && character.portrait_file
    ? `/api/characters/${character.id}/portrait?v=${encodeURIComponent(character.portrait_file)}`
    : null;
}

function loadEditable(characterId, user) {
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(characterId));
  if (!character) throw new Error('Character not found.');
  const isAdmin = user && user.role === 'admin';
  if (!isAdmin && character.player_id !== Number(user && user.id)) throw new Error('Forbidden.');
  return character;
}

// buffer: the image's bytes. Replaces the character's earlier portrait.
function saveCharacterPortrait({ characterId, user, buffer }) {
  const character = loadEditable(characterId, user);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose an image to upload.');
  if (buffer.length > NPC_FILE_MAX_BYTES) throw new Error('Portraits can be 5 MB at most.');
  const type = sniffImage(buffer);
  if (!type) throw new Error('A portrait must be a PNG, JPG, WebP or GIF image.');
  fs.mkdirSync(dir(), { recursive: true });
  const name = `character-${character.id}-${crypto.randomBytes(6).toString('hex')}.${type}`;
  fs.writeFileSync(path.join(dir(), name), buffer);
  db.prepare('UPDATE characters SET portrait_file = ? WHERE id = ?').run(name, character.id);
  removeFile(character.portrait_file);
  return { portraitUrl: characterPortraitUrl({ id: character.id, portrait_file: name }) };
}

function removeCharacterPortrait({ characterId, user }) {
  const character = loadEditable(characterId, user);
  db.prepare("UPDATE characters SET portrait_file = '' WHERE id = ?").run(character.id);
  removeFile(character.portrait_file);
  return { portraitUrl: null };
}

// { file, contentType } to send, or null.
function getCharacterPortraitFile(characterId) {
  const character = db.prepare('SELECT portrait_file FROM characters WHERE id = ?').get(Number(characterId));
  const name = character && character.portrait_file;
  if (!name || name !== path.basename(name)) return null;
  const file = path.join(dir(), name);
  if (!fs.existsSync(file)) return null;
  return { file, contentType: CONTENT_TYPES[path.extname(name).slice(1)] || 'application/octet-stream' };
}

module.exports = { characterPortraitUrl, saveCharacterPortrait, removeCharacterPortrait, getCharacterPortraitFile };
