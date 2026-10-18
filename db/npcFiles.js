// db/npcFiles.js — Uploaded NPC portraits/tokens (everyone logged in sees
// them). Files are stored in the uploads folder next to the database (see
// db/connection.js), named after the NPC, never by the uploader.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, uploadsDir } = require('./connection');

const MAX_BYTES = 5 * 1024 * 1024;
const KINDS = {
  portrait: ['png', 'jpg', 'webp', 'gif']
};
const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const dir = () => path.join(uploadsDir, 'npcs');

// The file type from its first bytes (what the browser claims is not trusted).
function sniff(buffer) {
  const starts = (bytes, offset = 0) => bytes.every((byte, index) => buffer[offset + index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'gif';
  return null;
}

function checkKind(kind) {
  if (!Object.hasOwn(KINDS, kind)) throw new Error('Only portraits can be uploaded.');
}

function removeNpcFiles(names) {
  for (const name of names) {
    if (!name || name !== path.basename(name)) continue;
    fs.rmSync(path.join(dir(), name), { force: true });
  }
}

// buffer: the file's bytes. Replaces any earlier file of that kind.
function saveNpcFile({ npcId, kind, buffer }) {
  checkKind(kind);
  const npc = db.prepare('SELECT * FROM npcs WHERE id = ?').get(Number(npcId));
  if (!npc) throw new Error('NPC not found.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose a file to upload.');
  if (buffer.length > MAX_BYTES) throw new Error('Files can be 5 MB at most.');
  const type = sniff(buffer);
  if (!type || !KINDS[kind].includes(type)) {
    throw new Error('A portrait must be a PNG, JPG, WebP or GIF image.');
  }
  fs.mkdirSync(dir(), { recursive: true });
  const name = `npc-${npc.id}-${kind}-${crypto.randomBytes(6).toString('hex')}.${type}`;
  fs.writeFileSync(path.join(dir(), name), buffer);
  db.prepare(`UPDATE npcs SET ${kind}_file = ? WHERE id = ?`).run(name, npc.id);
  removeNpcFiles([npc[`${kind}_file`]]);
  return { name, url: `/api/npcs/${npc.id}/files/${kind}?v=${encodeURIComponent(name)}` };
}

function removeNpcFile({ npcId, kind }) {
  checkKind(kind);
  const npc = db.prepare('SELECT * FROM npcs WHERE id = ?').get(Number(npcId));
  if (!npc) throw new Error('NPC not found.');
  db.prepare(`UPDATE npcs SET ${kind}_file = '' WHERE id = ?`).run(npc.id);
  removeNpcFiles([npc[`${kind}_file`]]);
  return { removed: Boolean(npc[`${kind}_file`]) };
}

// { file, contentType } to send, or null when there is none.
function getNpcFile({ npcId, kind }) {
  if (!Object.hasOwn(KINDS, kind)) return null;
  const npc = db.prepare('SELECT * FROM npcs WHERE id = ?').get(Number(npcId));
  const name = npc && npc[`${kind}_file`];
  if (!name || name !== path.basename(name)) return null;
  const file = path.join(dir(), name);
  if (!fs.existsSync(file)) return null;
  return { file, contentType: CONTENT_TYPES[path.extname(name).slice(1)] || 'application/octet-stream' };
}

// An NPC portrait by its file name, for Discord to fetch as a webhook avatar
// (public: only names that are some NPC's current portrait).
function getNpcPortraitByName(name) {
  const npc = db.prepare('SELECT id FROM npcs WHERE portrait_file = ? AND portrait_file != ?').get(String(name || ''), '');
  return npc ? getNpcFile({ npcId: npc.id, kind: 'portrait' }) : null;
}

module.exports = { NPC_FILE_MAX_BYTES: MAX_BYTES, getNpcPortraitByName, sniffImage: sniff, saveNpcFile, removeNpcFile, removeNpcFiles, getNpcFile };
