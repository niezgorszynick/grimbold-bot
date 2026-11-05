// db/worldMap.js — The world map: one image with a hex grid ("column.row", as
// drawn on it), DMs' markers, and fog of war for players. A player sees the
// hexes any of their characters visited: those of the adventures they were in
// the party of (each adventure's route, marked by its DM), the adventures they
// DMed, hexes a DM revealed to one of their characters by hand, and hexes
// revealed to everyone (the main hub). Worked out
// from party membership each time, so it follows party changes.
// DMs (admins) see the whole map, every marker, and edit it all.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, uploadsDir } = require('./connection');
const { sniffImage } = require('./npcFiles');

const MAP_MAX_BYTES = 25 * 1024 * 1024;
const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MARKER_ICONS = ['site', 'town', 'city', 'camp', 'danger', 'star'];
const dir = () => path.join(uploadsDir, 'map');

const isAdmin = user => Boolean(user && user.role === 'admin');
function requireDm(user) {
  if (!isAdmin(user)) throw new Error('Only a DM can change the map.');
}

function settingsRow() {
  return db.prepare('SELECT * FROM world_map WHERE id = 1').get();
}

function gridOf(row) {
  return { cols: row.cols, rows: row.rows, originX: row.origin_x, originY: row.origin_y, size: row.hex_size };
}

// "9.6" (column.row) inside the grid, normalised; throws otherwise.
function parseHex(hex, grid = gridOf(settingsRow())) {
  const match = /^\s*(\d{1,3})\s*[.,]\s*(\d{1,3})\s*$/.exec(String(hex || ''));
  const col = match ? Number(match[1]) : 0;
  const row = match ? Number(match[2]) : 0;
  if (!match || col < 1 || row < 1 || col > grid.cols || row > grid.rows) throw new Error(`There is no hex "${hex}" on the map.`);
  return `${col}.${row}`;
}

// ─── The image and the grid ───────────────────────────────────────────────

function saveMapImage({ user, buffer }) {
  requireDm(user);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose an image to upload.');
  if (buffer.length > MAP_MAX_BYTES) throw new Error('The map can be 25 MB at most.');
  const type = sniffImage(buffer);
  if (!type) throw new Error('The map must be a PNG, JPG, WebP or GIF image.');
  fs.mkdirSync(dir(), { recursive: true });
  const name = `world-${crypto.randomBytes(6).toString('hex')}.${type}`;
  fs.writeFileSync(path.join(dir(), name), buffer);
  const previous = settingsRow().image_file;
  db.prepare('UPDATE world_map SET image_file = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(name);
  if (previous && previous === path.basename(previous)) fs.rmSync(path.join(dir(), previous), { force: true });
  return { imageUrl: imageUrl(name) };
}

// Uploads in pieces: the web server in front (nginx) refuses big requests,
// so the browser sends the image in parts that are joined here.
const MAP_UPLOAD_PIECE_BYTES = 512 * 1024;
const partFile = uploadId => path.join(dir(), `upload-${uploadId}.part`);
function checkUploadId(uploadId) {
  if (!/^[a-f0-9]{24}$/.test(String(uploadId || ''))) throw new Error('That upload is not known; start again.');
  return String(uploadId);
}

function startMapUpload({ user, size }) {
  requireDm(user);
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < 1) throw new Error('Choose an image to upload.');
  if (bytes > MAP_MAX_BYTES) throw new Error('The map can be 25 MB at most.');
  fs.mkdirSync(dir(), { recursive: true });
  // Parts left behind by uploads that never finished (over a day old).
  fs.readdirSync(dir()).filter(name => name.endsWith('.part')).forEach(name => {
    const file = path.join(dir(), name);
    if (Date.now() - fs.statSync(file).mtimeMs > 86400000) fs.rmSync(file, { force: true });
  });
  const uploadId = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(partFile(uploadId), Buffer.alloc(0));
  return { uploadId, pieceBytes: MAP_UPLOAD_PIECE_BYTES };
}

// offset: where this piece goes (the bytes received so far), so a repeated piece is caught.
function addMapUploadPiece({ user, uploadId, offset, buffer }) {
  requireDm(user);
  const file = partFile(checkUploadId(uploadId));
  if (!fs.existsSync(file)) throw new Error('That upload is not known; start again.');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAP_UPLOAD_PIECE_BYTES) throw new Error('A piece of the upload is the wrong size.');
  const received = fs.statSync(file).size;
  if (Number(offset) !== received) throw new Error('The upload got out of step; start again.');
  if (received + buffer.length > MAP_MAX_BYTES) throw new Error('The map can be 25 MB at most.');
  fs.appendFileSync(file, buffer);
  return { received: received + buffer.length };
}

function finishMapUpload({ user, uploadId }) {
  requireDm(user);
  const file = partFile(checkUploadId(uploadId));
  if (!fs.existsSync(file)) throw new Error('That upload is not known; start again.');
  try {
    return saveMapImage({ user, buffer: fs.readFileSync(file) });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function imageUrl(name) {
  return name ? `/api/map/image?v=${encodeURIComponent(name)}` : null;
}

function getMapImageFile() {
  const name = settingsRow().image_file;
  if (!name || name !== path.basename(name)) return null;
  const file = path.join(dir(), name);
  if (!fs.existsSync(file)) return null;
  return { file, contentType: CONTENT_TYPES[path.extname(name).slice(1)] || 'application/octet-stream' };
}

// { cols, rows, originX, originY, size }: hex 1.1's centre and a hex's radius, in image pixels.
function saveMapGrid({ user, cols, rows, originX, originY, size }) {
  requireDm(user);
  const number = (value, min, max, label) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    return n;
  };
  db.prepare('UPDATE world_map SET cols = ?, rows = ?, origin_x = ?, origin_y = ?, hex_size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(
    Math.round(number(cols, 1, 200, 'Columns')), Math.round(number(rows, 1, 200, 'Rows')),
    number(originX, -10000, 100000, 'Hex 1.1 x'), number(originY, -10000, 100000, 'Hex 1.1 y'), number(size, 5, 2000, 'Hex size')
  );
  return gridOf(settingsRow());
}

// ─── Markers ──────────────────────────────────────────────────────────────

function markerView(row, dm) {
  return {
    id: row.id,
    hex: row.hex,
    name: row.name,
    icon: row.icon,
    note: row.note,
    ...(dm ? { secret: Boolean(row.secret), adventureId: row.adventure_id, adventure: row.adventure_title || null } : {})
  };
}

// { id? , hex, name, icon, note, adventureId, secret } — a new marker, or changes to one.
function saveMapMarker({ user, id = null, hex, name, icon = 'site', note = '', adventureId = null, secret = true }) {
  requireDm(user);
  const cell = parseHex(hex);
  const title = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!title) throw new Error('Give the marker a name.');
  if (!MARKER_ICONS.includes(icon)) throw new Error('Pick one of the marker icons.');
  const adventure = adventureId ? db.prepare('SELECT id FROM adventures WHERE id = ?').get(Number(adventureId)) : null;
  if (adventureId && !adventure) throw new Error('That adventure is not known.');
  const values = [cell, title, icon, String(note || '').trim().slice(0, 1000), adventure ? adventure.id : null, secret ? 1 : 0];
  if (id) {
    const changed = db.prepare('UPDATE map_markers SET hex = ?, name = ?, icon = ?, note = ?, adventure_id = ?, secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(...values, Number(id));
    if (!changed.changes) throw new Error('That marker is gone.');
    return Number(id);
  }
  return Number(db.prepare('INSERT INTO map_markers (hex, name, icon, note, adventure_id, secret, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(...values, Number(user.id)).lastInsertRowid);
}

function deleteMapMarker({ user, id }) {
  requireDm(user);
  db.prepare('DELETE FROM map_markers WHERE id = ?').run(Number(id));
}

// ─── Routes and reveals ───────────────────────────────────────────────────

// The adventure's DM or any DM marks the hexes it went through.
function setAdventureHex({ user, adventureId, hex, on = true }) {
  const adventure = db.prepare('SELECT id, dm_player_id FROM adventures WHERE id = ?').get(Number(adventureId));
  if (!adventure) throw new Error('Adventure not found.');
  if (!isAdmin(user) && !(adventure.dm_player_id !== null && adventure.dm_player_id === Number(user && user.id))) {
    throw new Error("Only this adventure's DM (or another DM) can mark its route.");
  }
  const cell = parseHex(hex);
  if (on) db.prepare('INSERT OR IGNORE INTO adventure_hexes (adventure_id, hex) VALUES (?, ?)').run(adventure.id, cell);
  else db.prepare('DELETE FROM adventure_hexes WHERE adventure_id = ? AND hex = ?').run(adventure.id, cell);
}

function setCharacterHex({ user, characterId, hex, on = true }) {
  requireDm(user);
  const character = db.prepare('SELECT id FROM characters WHERE id = ?').get(Number(characterId));
  if (!character) throw new Error('Character not found.');
  const cell = parseHex(hex);
  if (on) db.prepare('INSERT OR IGNORE INTO character_hexes (character_id, hex, revealed_by) VALUES (?, ?, ?)').run(character.id, cell, Number(user.id));
  else db.prepare('DELETE FROM character_hexes WHERE character_id = ? AND hex = ?').run(character.id, cell);
}

// A hex every player sees (the main hub, well-known places).
function setPublicHex({ user, hex, on = true }) {
  requireDm(user);
  const cell = parseHex(hex);
  if (on) db.prepare('INSERT OR IGNORE INTO map_public_hexes (hex, revealed_by) VALUES (?, ?)').run(cell, Number(user.id));
  else db.prepare('DELETE FROM map_public_hexes WHERE hex = ?').run(cell);
}

const publicHexes = () => db.prepare('SELECT hex FROM map_public_hexes ORDER BY hex').all().map(row => row.hex);

// Why a player knows each hex: [{ hex, character, via }] (via: an adventure's title, or null when a DM revealed it);
// hexes known to everyone come as { hex, everyone: true }.
function playerVisits(playerId) {
  return db.prepare(`
    SELECT ah.hex, c.name AS character, a.title AS via FROM adventure_hexes ah
      JOIN adventure_party ap ON ap.adventure_id = ah.adventure_id
      JOIN characters c ON c.id = ap.character_id JOIN adventures a ON a.id = ah.adventure_id
      WHERE c.player_id = ?
    UNION
    SELECT ah.hex, NULL AS character, a.title AS via FROM adventure_hexes ah JOIN adventures a ON a.id = ah.adventure_id
      WHERE a.dm_player_id = ?
    UNION
    SELECT ch.hex, c.name AS character, NULL AS via FROM character_hexes ch JOIN characters c ON c.id = ch.character_id
      WHERE c.player_id = ?
  `).all(Number(playerId), Number(playerId), Number(playerId))
    .concat(publicHexes().map(hex => ({ hex, character: null, via: null, everyone: true })));
}

// ─── What one viewer sees ─────────────────────────────────────────────────

// The map for a viewer. DMs get everything (revealed: null = no fog) and the
// tools' lists; asPlayerId lets a DM look through a player's fog.
function getWorldMap({ user, asPlayerId = null }) {
  const row = settingsRow();
  const grid = gridOf(row);
  const dm = isAdmin(user) && !asPlayerId;
  const viewerId = isAdmin(user) && asPlayerId ? Number(asPlayerId) : Number(user && user.id);
  const markers = db.prepare(`
    SELECT m.*, a.title AS adventure_title FROM map_markers m LEFT JOIN adventures a ON a.id = m.adventure_id ORDER BY m.hex, m.name COLLATE NOCASE
  `).all();
  const base = { grid, imageUrl: imageUrl(row.image_file), icons: MARKER_ICONS, dm };

  // Adventures whose route this viewer may mark (theirs; every one for a DM).
  const routable = db.prepare(`SELECT id, title, status FROM adventures WHERE ${isAdmin(user) ? '1' : 'dm_player_id = ?'} ORDER BY status = 'active' DESC, id DESC`)
    .all(...(isAdmin(user) ? [] : [viewerId]));
  const routes = routable.map(adventure => ({
    id: adventure.id,
    title: adventure.title,
    status: adventure.status,
    hexes: db.prepare('SELECT hex FROM adventure_hexes WHERE adventure_id = ? ORDER BY added_at').all(adventure.id).map(entry => entry.hex)
  }));

  if (dm) {
    return {
      ...base,
      revealed: null,
      publicHexes: publicHexes(),
      markers: markers.map(marker => markerView(marker, true)),
      routes,
      characters: db.prepare(`SELECT c.id, c.name, p.discord_tag AS player FROM characters c JOIN players p ON p.id = c.player_id ORDER BY c.name COLLATE NOCASE`).all()
        .map(character => ({
          ...character,
          hexes: db.prepare('SELECT hex FROM character_hexes WHERE character_id = ?').all(character.id).map(entry => entry.hex)
        })),
      players: db.prepare('SELECT id, discord_tag AS name FROM players WHERE id IN (SELECT DISTINCT player_id FROM characters) ORDER BY discord_tag COLLATE NOCASE').all()
    };
  }

  const visits = playerVisits(viewerId);
  const revealed = [...new Set(visits.map(visit => visit.hex))];
  const known = new Set(revealed);
  return {
    ...base,
    asPlayerId: isAdmin(user) ? viewerId : null,
    revealed,
    visits,
    markers: markers.filter(marker => !marker.secret && known.has(marker.hex)).map(marker => markerView(marker, false)),
    // A player who DMs an adventure marks its route too.
    routes: isAdmin(user) ? [] : routes,
    // A DM looking as a player can switch to another.
    ...(isAdmin(user) ? { players: db.prepare('SELECT id, discord_tag AS name FROM players WHERE id IN (SELECT DISTINCT player_id FROM characters) ORDER BY discord_tag COLLATE NOCASE').all() } : {})
  };
}

module.exports = {
  MAP_MAX_BYTES,
  MAP_MARKER_ICONS: MARKER_ICONS,
  parseMapHex: parseHex,
  saveMapImage,
  startMapUpload,
  addMapUploadPiece,
  finishMapUpload,
  getMapImageFile,
  saveMapGrid,
  saveMapMarker,
  deleteMapMarker,
  setAdventureHex,
  setCharacterHex,
  setPublicHex,
  getWorldMap
};
