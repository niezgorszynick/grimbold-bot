// db/tokens.js — The token base (DM Tools → Tokens): token images DMs upload,
// each about a character, a Notable NPC, a catalog monster type (every
// Goblin) or nobody in particular (a custom name). A subject can have several
// tokens (disguised, wild shape, mounted…), each with a short label; one is
// its main token.
//
// Every DM sees every token, except those of a private NPC, which follow the
// NPC (its DM and the Root DM). Files are named at random and served publicly
// by name (/tokens/<file>), so a link can go into Owlbear, which loads images
// without a panel login; the panel itself lists them only to DMs.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, uploadsDir } = require('./connection');
const { sniffImage } = require('./npcFiles');
// The Root DM (auth.js ROOT_ADMIN, id 0); auth.js loads db, so not required here.
const ROOT_ADMIN = { id: 0 };

// later: uploaded now, who it is of chosen later (named after its file meanwhile).
const KINDS = ['later', 'character', 'npc', 'monster', 'custom'];
const KIND_LABELS = { later: 'To choose later', character: 'Characters', npc: 'Notable NPCs', monster: 'Monsters', custom: 'Custom' };
const MAX_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const FILE_NAME = /^token-[a-f0-9]{24}\.(png|jpg|webp|gif)$/;
const dir = () => path.join(uploadsDir, 'tokens');
const clean = (text, length) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, length);
const plain = text => clean(text, 200).toLowerCase();

const isDm = user => Boolean(user && user.role === 'admin');
function requireDm(user) {
  if (!isDm(user)) throw new Error('Only DMs use the token base.');
}

// A private NPC's tokens: its DM and the Root DM, as for the NPC itself.
function canSeeNpcRow(npc, user) {
  if (!npc) return false;
  if (!npc.private) return true;
  return Number(user.id) === ROOT_ADMIN.id || Number(user.id) === npc.owner_player_id;
}

// What a token is about, checked: { kind, characterId, npcId, monster, name }.
// monster: a catalog name (getMonster from rules, passed in to keep db/ free of rules).
function checkSubject({ kind, characterId, npcId, monster, name }, user, { monsterExists }) {
  if (!KINDS.includes(kind)) throw new Error('Choose what the token is of: a character, an NPC, a monster or a custom name.');
  if (kind === 'character') {
    const character = db.prepare('SELECT id, name FROM characters WHERE id = ?').get(Number(characterId));
    if (!character) throw new Error('Choose a character.');
    return { kind, characterId: character.id, npcId: null, monster: null, name: character.name };
  }
  if (kind === 'npc') {
    const npc = db.prepare('SELECT id, name, private, owner_player_id FROM npcs WHERE id = ?').get(Number(npcId));
    if (!npc || !canSeeNpcRow(npc, user)) throw new Error('Choose a Notable NPC.');
    return { kind, characterId: null, npcId: npc.id, monster: null, name: npc.name };
  }
  if (kind === 'monster') {
    const label = clean(monster, 200);
    if (!label) throw new Error('Choose a monster.');
    if (!monsterExists(label)) throw new Error(`There is no monster called “${label}” in the catalog; use a custom name instead.`);
    return { kind, characterId: null, npcId: null, monster: label, name: label };
  }
  if (kind === 'later') return { kind, characterId: null, npcId: null, monster: null, name: clean(name, 100) || 'Untitled token' };
  const label = clean(name, 100);
  if (!label) throw new Error('Give the token a name.');
  return { kind, characterId: null, npcId: null, monster: null, name: label };
}

// The subject's tokens (to keep one main).
function subjectWhere(row) {
  if (row.kind === 'character' && row.character_id) return { sql: "kind = 'character' AND character_id = ?", params: [row.character_id] };
  if (row.kind === 'npc' && row.npc_id) return { sql: "kind = 'npc' AND npc_id = ?", params: [row.npc_id] };
  if (row.kind === 'monster') return { sql: "kind = 'monster' AND monster_name = ?", params: [row.monster_name] };
  return { sql: 'kind = ? AND name_key = ? AND character_id IS NULL AND npc_id IS NULL', params: [row.kind, row.name_key] };
}

// Exactly one main token per subject: the one asked for, else the one already
// main, else the oldest.
function settleMain(row, mainId = null) {
  // Tokens waiting to be linked are nobody's, so none of them is main.
  if (row.kind === 'later') { db.prepare('UPDATE tokens SET is_main = 0 WHERE id = ?').run(row.id); return; }
  const { sql, params } = subjectWhere(row);
  const ids = db.prepare(`SELECT id, is_main FROM tokens WHERE ${sql} ORDER BY created_at, id`).all(...params);
  if (!ids.length) return;
  const keep = mainId && ids.some(entry => entry.id === mainId) ? mainId : (ids.find(entry => entry.is_main) || ids[0]).id;
  db.prepare(`UPDATE tokens SET is_main = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE ${sql}`).run(keep, ...params);
}

// A DM uploads a token: the image (5 MB at most) and what it is of.
// Returns its id.
// A group set by hand ('' = automatic, worked out by the tab from the
// statblock or species) belongs to the whole subject: every token of it.
function setSubjectGroup(row, group) {
  const { sql, params } = row.kind === 'later' ? { sql: 'id = ?', params: [row.id] } : subjectWhere(row);
  db.prepare(`UPDATE tokens SET group_name = ? WHERE ${sql}`).run(clean(group, 40), ...params);
}

// The subject's group so far (a new token of it joins it).
function subjectGroup(row) {
  if (row.kind === 'later') return '';
  const { sql, params } = subjectWhere(row);
  const found = db.prepare(`SELECT group_name FROM tokens WHERE ${sql} AND group_name != '' AND id != ? LIMIT 1`).get(...params, row.id);
  return found ? found.group_name : '';
}

// group: undefined or '' keeps the subject's group (automatic for a new one).
function uploadToken({ user, buffer, subject, label, main, group, monsterExists }) {
  requireDm(user);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Choose an image to upload.');
  if (buffer.length > MAX_BYTES) throw new Error('Tokens can be 5 MB at most.');
  const type = sniffImage(buffer);
  if (!type) throw new Error('A token must be a PNG, JPG, WebP or GIF image.');
  const about = checkSubject(subject || {}, user, { monsterExists });
  fs.mkdirSync(dir(), { recursive: true });
  const file = `token-${crypto.randomBytes(12).toString('hex')}.${type}`;
  fs.writeFileSync(path.join(dir(), file), buffer);
  try {
    return db.transaction(() => {
      const id = Number(db.prepare(`
        INSERT INTO tokens (kind, character_id, npc_id, monster_name, name, name_key, label, file, uploaded_by_player_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(about.kind, about.characterId, about.npcId, about.monster, about.name, plain(about.name), clean(label, 60),
        file, Number(user.id) > 0 ? Number(user.id) : null).lastInsertRowid);
      const row = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id);
      settleMain(row, main ? id : null);
      setSubjectGroup(row, clean(group, 40) || subjectGroup(row));
      return id;
    })();
  } catch (error) {
    fs.rmSync(path.join(dir(), file), { force: true });
    throw error;
  }
}

const tokenUrl = file => `/tokens/${file}`;

// A row as the panel shows it. A character or NPC that was deleted keeps
// its token under the name it had.
function present(row) {
  const subjectName = row.character_name || row.npc_name || row.name;
  return {
    id: row.id,
    kind: row.kind,
    characterId: row.character_id,
    npcId: row.npc_id,
    monster: row.monster_name,
    name: subjectName,
    label: row.label || '',
    main: Boolean(row.is_main),
    orphaned: (row.kind === 'character' && !row.character_id) || (row.kind === 'npc' && !row.npc_id),
    privateNpc: Boolean(row.npc_private),
    group: row.group_name || '',
    race: row.character_race || null,
    baseMonster: row.npc_base_monster || null,
    url: tokenUrl(row.file),
    file: row.file,
    uploadedBy: row.uploaded_by_tag || null,
    createdAt: row.created_at
  };
}

const SELECT = `
  SELECT t.*, c.name AS character_name, c.race AS character_race, n.name AS npc_name, n.private AS npc_private,
    n.owner_player_id AS npc_owner, n.base_monster AS npc_base_monster,
    p.discord_tag AS uploaded_by_tag
  FROM tokens t
  LEFT JOIN characters c ON c.id = t.character_id
  LEFT JOIN npcs n ON n.id = t.npc_id
  LEFT JOIN players p ON p.id = t.uploaded_by_player_id`;

const visible = (rows, user) => rows.filter(row => !row.npc_id || canSeeNpcRow({ private: row.npc_private, owner_player_id: row.npc_owner }, user));

// Every token the DM may see: { kind, characterId, npcId, monster } narrow it.
function listTokens(user, { kind, characterId, npcId, monster } = {}) {
  if (!isDm(user)) return [];
  const where = [];
  const params = [];
  if (kind && KINDS.includes(kind)) { where.push('t.kind = ?'); params.push(kind); }
  if (characterId) { where.push('t.character_id = ?'); params.push(Number(characterId)); }
  if (npcId) { where.push('t.npc_id = ?'); params.push(Number(npcId)); }
  if (monster) { where.push("t.kind = 'monster' AND t.monster_name = ?"); params.push(String(monster)); }
  const rows = db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(c.name, n.name, t.name) COLLATE NOCASE, t.is_main DESC, t.created_at, t.id`).all(...params);
  return visible(rows, user).map(present);
}

function getToken(user, id) {
  if (!isDm(user)) return null;
  const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(Number(id));
  return row && visible([row], user).length ? present(row) : null;
}

function requireToken(user, id) {
  requireDm(user);
  const token = getToken(user, id);
  if (!token) throw new Error('Token not found.');
  return db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
}

// Change a token: { label, main, subject } (each optional).
// group: undefined leaves it; '' makes the subject's group automatic again.
function updateToken({ user, id, label, main, subject, group, monsterExists }) {
  const row = requireToken(user, id);
  // The same subject as now (the edit form always sends one): nothing to relink.
  const same = subject && subject.kind === row.kind && (
    row.kind === 'later' ? true
      : row.kind === 'character' ? Number(subject.characterId || 0) === Number(row.character_id || 0)
      : row.kind === 'npc' ? Number(subject.npcId || 0) === Number(row.npc_id || 0)
        : row.kind === 'monster' ? clean(subject.monster, 200) === row.monster_name
          : plain(subject.name) === row.name_key);
  db.transaction(() => {
    if (subject && !same) {
      const about = checkSubject(subject, user, { monsterExists });
      db.prepare('UPDATE tokens SET kind = ?, character_id = ?, npc_id = ?, monster_name = ?, name = ?, name_key = ?, is_main = 0 WHERE id = ?')
        .run(about.kind, about.characterId, about.npcId, about.monster, about.name, plain(about.name), row.id);
      settleMain(row);
      // Joining another subject: its group, unless one is chosen below.
      const moved = db.prepare('SELECT * FROM tokens WHERE id = ?').get(row.id);
      if (group === undefined) setSubjectGroup(moved, subjectGroup(moved));
    }
    if (group !== undefined) setSubjectGroup(db.prepare('SELECT * FROM tokens WHERE id = ?').get(row.id), group);
    if (label !== undefined) db.prepare('UPDATE tokens SET label = ? WHERE id = ?').run(clean(label, 60), row.id);
    const fresh = db.prepare('SELECT * FROM tokens WHERE id = ?').get(row.id);
    settleMain(fresh, main ? row.id : null);
  })();
  return getToken(user, row.id);
}

function deleteToken({ user, id }) {
  const row = requireToken(user, id);
  db.prepare('DELETE FROM tokens WHERE id = ?').run(row.id);
  settleMain(row);
  if (row.file && FILE_NAME.test(row.file)) fs.rmSync(path.join(dir(), row.file), { force: true });
}

// A token's file by name, for anyone (Owlbear loads it without a login).
function getTokenFileByName(name) {
  const value = String(name || '');
  if (!FILE_NAME.test(value) || !db.prepare('SELECT 1 FROM tokens WHERE file = ?').get(value)) return null;
  const file = path.join(dir(), value);
  if (!fs.existsSync(file)) return null;
  return { file, contentType: CONTENT_TYPES[path.extname(value).slice(1)] || 'application/octet-stream' };
}

// What a token can be of, for the forms: characters (with their player),
// the NPCs this DM sees, and the custom names already used.
function listTokenSubjects(user) {
  if (!isDm(user)) return { characters: [], npcs: [], customNames: [] };
  return {
    characters: db.prepare(`SELECT c.id, c.name, c.status, p.discord_tag AS player FROM characters c LEFT JOIN players p ON p.id = c.player_id
      ORDER BY c.status = 'dead', c.name COLLATE NOCASE`).all(),
    npcs: db.prepare('SELECT id, name, private, owner_player_id, status FROM npcs ORDER BY name COLLATE NOCASE').all()
      .filter(npc => canSeeNpcRow(npc, user)).map(npc => ({ id: npc.id, name: npc.name, private: Boolean(npc.private), dead: npc.status === 'dead' })),
    customNames: db.prepare("SELECT name FROM tokens WHERE kind = 'custom' GROUP BY name_key ORDER BY name COLLATE NOCASE").all().map(row => row.name)
  };
}

module.exports = {
  TOKEN_KINDS: KINDS,
  TOKEN_KIND_LABELS: KIND_LABELS,
  TOKEN_MAX_BYTES: MAX_BYTES,
  uploadToken,
  listTokens,
  getToken,
  updateToken,
  deleteToken,
  getTokenFileByName,
  listTokenSubjects
};
