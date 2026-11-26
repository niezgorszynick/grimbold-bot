// db/battleMaps.js — DM Tools → Owlbear Maps: the battle maps used in
// adventures. Each is an image (up to 50 MB, sent in pieces as the web server
// in front refuses big requests) with a name and a note, tied to an adventure
// and, if it likes, to one of the world-map markers of that adventure.
//
// Every DM sees a map, unless it is hidden: then only the adventure's DM,
// the Root DM and whoever uploaded it. Players never do. The browser makes a
// small preview before uploading (there is no image library here), kept
// beside the map for the lists.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, uploadsDir } = require('./connection');
const { sniffImage } = require('./npcFiles');

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;
const PIECE_BYTES = 512 * 1024;
const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const dir = () => path.join(uploadsDir, 'battle-maps');
const clean = (text, length) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, length);
const isDm = user => Boolean(user && user.role === 'admin');
const isRoot = user => isDm(user) && Number(user.id) === 0;

function requireDm(user) {
  if (!isDm(user)) throw new Error('Only DMs see the Owlbear maps.');
}

// Who sees a map: every DM; a hidden one, its adventure's DM, the Root DM
// and whoever uploaded it.
function canSeeMap(row, user) {
  if (!isDm(user)) return false;
  if (!row.hidden || isRoot(user)) return true;
  const id = Number(user.id);
  return id === row.uploaded_by_player_id || (row.adventure_dm !== null && row.adventure_dm !== undefined && id === row.adventure_dm);
}

function checkAdventure(adventureId) {
  const adventure = db.prepare('SELECT id, title, dm_player_id FROM adventures WHERE id = ?').get(Number(adventureId));
  if (!adventure) throw new Error('Choose the adventure the map was used in.');
  return adventure;
}

// '' or nothing: no marker. Otherwise one of the adventure's markers.
function checkMarker(markerId, adventureId) {
  if (markerId === undefined || markerId === null || markerId === '') return null;
  const linked = db.prepare('SELECT 1 FROM map_marker_adventures WHERE marker_id = ? AND adventure_id = ?').get(Number(markerId), Number(adventureId));
  if (!linked) throw new Error('That marker is not one of this adventure\'s on the world map.');
  return Number(markerId);
}

// ─── Uploading, in pieces ───────────────────────────────────────────────────

function partFile(user, uploadId, suffix = 'part') {
  if (!/^[a-f0-9]{24}$/.test(String(uploadId || ''))) throw new Error('That upload is not known; start again.');
  return path.join(dir(), `upload-${Number(user.id) || 0}-${uploadId}.${suffix}`);
}

function startBattleMapUpload({ user, size }) {
  requireDm(user);
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < 1) throw new Error('Choose a map image.');
  if (bytes > MAX_BYTES) throw new Error('A map can be 50 MB at most.');
  fs.mkdirSync(dir(), { recursive: true });
  // Parts left behind by uploads that never finished (over a day old).
  fs.readdirSync(dir()).filter(name => /\.(part|thumbpart)$/.test(name)).forEach(name => {
    const file = path.join(dir(), name);
    if (Date.now() - fs.statSync(file).mtimeMs > 86400000) fs.rmSync(file, { force: true });
  });
  const uploadId = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(partFile(user, uploadId), Buffer.alloc(0));
  return { uploadId, pieceBytes: PIECE_BYTES };
}

// offset: where this piece goes (the bytes received so far), so a repeated piece is caught.
function addBattleMapPiece({ user, uploadId, offset, buffer }) {
  requireDm(user);
  const file = partFile(user, uploadId);
  if (!fs.existsSync(file)) throw new Error('That upload is not known; start again.');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > PIECE_BYTES) throw new Error('A piece of the upload is the wrong size.');
  const received = fs.statSync(file).size;
  if (Number(offset) !== received) throw new Error('The upload got out of step; start again.');
  if (received + buffer.length > MAX_BYTES) throw new Error('A map can be 50 MB at most.');
  fs.appendFileSync(file, buffer);
  return { received: received + buffer.length };
}

// The browser's small preview of the map (optional).
function addBattleMapThumb({ user, uploadId, buffer }) {
  requireDm(user);
  if (!fs.existsSync(partFile(user, uploadId))) throw new Error('That upload is not known; start again.');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_THUMB_BYTES || !sniffImage(buffer)) throw new Error('The preview is not an image.');
  fs.writeFileSync(partFile(user, uploadId, 'thumbpart'), buffer);
  return { ok: true };
}

// The joined map saved: { uploadId, adventureId, markerId, name, note, hidden, width, height }. Returns its id.
function finishBattleMapUpload({ user, uploadId, adventureId, markerId, name, note, hidden, width, height }) {
  requireDm(user);
  const file = partFile(user, uploadId);
  const thumbPart = partFile(user, uploadId, 'thumbpart');
  if (!fs.existsSync(file)) throw new Error('That upload is not known; start again.');
  try {
    const adventure = checkAdventure(adventureId);
    const marker = checkMarker(markerId, adventure.id);
    const buffer = fs.readFileSync(file);
    const type = sniffImage(buffer);
    if (!type) throw new Error('A map must be a PNG, JPG, WebP or GIF image.');
    const base = `map-${crypto.randomBytes(12).toString('hex')}`;
    fs.writeFileSync(path.join(dir(), `${base}.${type}`), buffer);
    let thumb = null;
    if (fs.existsSync(thumbPart)) {
      const small = fs.readFileSync(thumbPart);
      const thumbType = sniffImage(small);
      if (thumbType) {
        thumb = `${base}-thumb.${thumbType}`;
        fs.writeFileSync(path.join(dir(), thumb), small);
      }
    }
    const size = value => (Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) < 100000 ? Number(value) : null);
    return Number(db.prepare(`
      INSERT INTO battle_maps (adventure_id, marker_id, name, note, hidden, file, thumb_file, width, height, uploaded_by_player_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(adventure.id, marker, clean(name, 100) || 'Map', String(note || '').trim().slice(0, 1000), hidden ? 1 : 0,
      `${base}.${type}`, thumb, size(width), size(height), Number(user.id) > 0 ? Number(user.id) : null).lastInsertRowid);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(thumbPart, { force: true });
  }
}

// ─── Reading ────────────────────────────────────────────────────────────────

const SELECT = `
  SELECT b.*, a.title AS adventure_title, a.dm_player_id AS adventure_dm, a.status AS adventure_status,
    m.name AS marker_name, m.hex AS marker_hex, p.discord_tag AS uploaded_by_tag
  FROM battle_maps b
  LEFT JOIN adventures a ON a.id = b.adventure_id
  LEFT JOIN map_markers m ON m.id = b.marker_id
  LEFT JOIN players p ON p.id = b.uploaded_by_player_id`;

const fileUrl = (row, size) => `/api/battle-maps/${row.id}/image${size === 'thumb' ? '?size=thumb' : ''}`;

function present(row, user) {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    hidden: Boolean(row.hidden),
    adventureId: row.adventure_id,
    adventureTitle: row.adventure_title || null,
    markerId: row.marker_id,
    markerName: row.marker_name || null,
    markerHex: row.marker_hex || null,
    width: row.width,
    height: row.height,
    url: fileUrl(row),
    thumbUrl: row.thumb_file ? fileUrl(row, 'thumb') : fileUrl(row),
    hasThumb: Boolean(row.thumb_file),
    uploadedBy: row.uploaded_by_tag || (row.uploaded_by_player_id === null ? 'Root DM' : null),
    createdAt: row.created_at,
    // May hide it, move it, delete it: whoever may see it, as any DM may sort maps.
    canEdit: canSeeMap(row, user)
  };
}

// The maps this DM sees: { adventureId, markerId } narrow it. Newest first.
function listBattleMaps(user, { adventureId, markerId } = {}) {
  if (!isDm(user)) return [];
  const where = [];
  const params = [];
  if (adventureId) { where.push('b.adventure_id = ?'); params.push(Number(adventureId)); }
  if (markerId) { where.push('b.marker_id = ?'); params.push(Number(markerId)); }
  return db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.created_at DESC, b.id DESC`).all(...params)
    .filter(row => canSeeMap(row, user)).map(row => present(row, user));
}

function getBattleMap(user, id) {
  const row = db.prepare(`${SELECT} WHERE b.id = ?`).get(Number(id));
  return row && canSeeMap(row, user) ? present(row, user) : null;
}

function requireMap(user, id) {
  requireDm(user);
  const row = db.prepare(`${SELECT} WHERE b.id = ?`).get(Number(id));
  if (!row || !canSeeMap(row, user)) throw new Error('Map not found.');
  return row;
}

// { name, note, adventureId, markerId, hidden } (each optional). Hiding it
// keeps it for the adventure's DM, the Root DM and the uploader.
function updateBattleMap({ user, id, name, note, adventureId, markerId, hidden }) {
  const row = requireMap(user, id);
  const adventure = adventureId !== undefined ? checkAdventure(adventureId) : { id: row.adventure_id };
  const marker = markerId !== undefined || adventureId !== undefined
    ? checkMarker(markerId !== undefined ? markerId : row.marker_id, adventure.id) : row.marker_id;
  db.prepare('UPDATE battle_maps SET name = ?, note = ?, adventure_id = ?, marker_id = ?, hidden = ? WHERE id = ?').run(
    name !== undefined ? clean(name, 100) || row.name : row.name,
    note !== undefined ? String(note || '').trim().slice(0, 1000) : row.note,
    adventure.id, marker,
    hidden !== undefined ? (hidden ? 1 : 0) : row.hidden,
    row.id);
  return getBattleMap(user, row.id);
}

function removeFile(name) {
  if (name && name === path.basename(name)) fs.rmSync(path.join(dir(), name), { force: true });
}

function deleteBattleMap({ user, id }) {
  const row = requireMap(user, id);
  db.prepare('DELETE FROM battle_maps WHERE id = ?').run(row.id);
  removeFile(row.file);
  removeFile(row.thumb_file);
}

// { file, contentType, downloadName } for one who may see it, or null.
function getBattleMapFile(user, id, { size } = {}) {
  const row = db.prepare(`${SELECT} WHERE b.id = ?`).get(Number(id));
  if (!row || !canSeeMap(row, user)) return null;
  for (const name of size === 'thumb' ? [row.thumb_file, row.file] : [row.file]) {
    if (!name || name !== path.basename(name)) continue;
    const file = path.join(dir(), name);
    const ext = path.extname(name).slice(1);
    if (fs.existsSync(file)) return { file, contentType: CONTENT_TYPES[ext] || 'application/octet-stream', downloadName: `${row.name.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'map'}.${ext}` };
  }
  return null;
}

// The adventures a map can be tied to, newest first, each with its markers.
function listBattleMapAdventures(user) {
  if (!isDm(user)) return [];
  const markers = db.prepare(`SELECT ma.adventure_id, m.id, m.name, m.hex FROM map_marker_adventures ma JOIN map_markers m ON m.id = ma.marker_id
    ORDER BY m.name COLLATE NOCASE`).all();
  return db.prepare("SELECT id, title, status FROM adventures WHERE status != 'cancelled' ORDER BY id DESC").all()
    .map(adventure => ({ ...adventure, markers: markers.filter(marker => marker.adventure_id === adventure.id).map(({ id, name, hex }) => ({ id, name, hex })) }));
}

module.exports = {
  BATTLE_MAP_MAX_BYTES: MAX_BYTES,
  startBattleMapUpload,
  addBattleMapPiece,
  addBattleMapThumb,
  finishBattleMapUpload,
  listBattleMaps,
  getBattleMap,
  updateBattleMap,
  deleteBattleMap,
  getBattleMapFile,
  listBattleMapAdventures
};
