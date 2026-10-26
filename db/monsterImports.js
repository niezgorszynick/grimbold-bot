// db/monsterImports.js — 5etools monster files DMs import on the Monsters
// tab (a book's bestiary or a homebrew collection). The creatures are kept
// raw (so a "_copy" in one file can use a creature from another) and turned
// into statblocks with rules/fiveTools.js whenever the imports change; those
// join the monster catalog (rules/monsters.js). Book text stays in the
// database on the server, never in Git.
//
// The browser reads the file and sends its creatures in small batches
// (startMonsterImport, addImportedMonsters, finishMonsterImport), so no
// request is larger than the panel (or nginx) accepts.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');

const MAX_LABEL = 100;
const MAX_PER_BATCH = 500;

function readJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// Converts every finished import and hands the statblocks to the catalog.
// Returns { monsters, skipped } with each import's id (for the report).
function refreshImportedMonsters() {
  const imports = db.prepare("SELECT id, meta FROM monster_imports WHERE status = 'ready' ORDER BY id").all();
  const rawByImport = new Map(imports.map(row => [row.id, []]));
  if (imports.length) {
    db.prepare(`SELECT import_id, raw FROM imported_monsters WHERE import_id IN (${imports.map(() => '?').join(',')}) ORDER BY id`)
      .all(...imports.map(row => row.id))
      .forEach(row => { const raw = readJson(row.raw, null); if (raw) rawByImport.get(row.import_id).push(raw); });
  }
  const result = rules.convertFiveToolsFiles(imports.map(row => ({ id: row.id, data: { monster: rawByImport.get(row.id), _meta: readJson(row.meta, null) } })));
  rules.setImportedMonsters(result.monsters.map(entry => ({ ...entry.monster, importId: entry.fileId })));
  return result;
}

function requireDm(user) {
  if (!user || user.role !== 'admin') throw new Error('Only a DM can import monsters.');
}

// { label, fileName, meta } — the file's own _meta keeps homebrew source names.
function startMonsterImport({ user, label, fileName, meta }) {
  requireDm(user);
  const name = String(fileName || '').trim().slice(0, 200);
  const title = String(label || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL) || name || 'Imported monsters';
  const existing = name && db.prepare("SELECT label FROM monster_imports WHERE file_name = ? AND status = 'ready'").get(name);
  if (existing) throw new Error(`${name} is already imported (as "${existing.label}"): remove it first to load it again.`);
  // Leftovers of an upload that never finished.
  db.prepare("DELETE FROM imported_monsters WHERE import_id IN (SELECT id FROM monster_imports WHERE status = 'uploading' AND created_at < datetime('now', '-1 day'))").run();
  db.prepare("DELETE FROM monster_imports WHERE status = 'uploading' AND created_at < datetime('now', '-1 day')").run();
  const id = Number(db.prepare(`
    INSERT INTO monster_imports (label, file_name, meta, uploaded_by, status) VALUES (?, ?, ?, ?, 'uploading')
  `).run(title, name, JSON.stringify(meta && typeof meta === 'object' ? meta : null), Number(user.id) > 0 ? Number(user.id) : null).lastInsertRowid);
  return { importId: id };
}

function loadUploading(importId) {
  const row = db.prepare("SELECT * FROM monster_imports WHERE id = ? AND status = 'uploading'").get(Number(importId));
  if (!row) throw new Error('That import is not being uploaded (start again).');
  return row;
}

// { monsters: [5etools monster, …] } — one batch.
function addImportedMonsters({ user, importId, monsters }) {
  requireDm(user);
  const row = loadUploading(importId);
  if (!Array.isArray(monsters) || monsters.length > MAX_PER_BATCH) throw new Error('Send the creatures as a list (at most 500 at a time).');
  const insert = db.prepare('INSERT INTO imported_monsters (import_id, name, source, raw) VALUES (?, ?, ?, ?)');
  db.transaction(() => monsters.forEach(monster => {
    if (!monster || typeof monster !== 'object') return;
    insert.run(row.id, String(monster.name || '').slice(0, 200), String(monster.source || '').slice(0, 50), JSON.stringify(monster));
  }))();
  return { received: monsters.length };
}

// The upload is complete: convert, and report what came in and what didn't.
function finishMonsterImport({ user, importId }) {
  requireDm(user);
  const row = loadUploading(importId);
  const count = db.prepare('SELECT COUNT(*) AS n FROM imported_monsters WHERE import_id = ?').get(row.id).n;
  if (!count) {
    db.prepare('DELETE FROM monster_imports WHERE id = ?').run(row.id);
    throw new Error('That file has no monsters in it (5etools keeps them in a "monster" list).');
  }
  db.prepare("UPDATE monster_imports SET status = 'ready' WHERE id = ?").run(row.id);
  const result = refreshImportedMonsters();
  const mine = result.monsters.filter(entry => entry.fileId === row.id);
  const skipped = result.skipped.filter(entry => entry.fileId === row.id).map(({ name, reason }) => ({ name, reason }));
  db.prepare('UPDATE monster_imports SET monster_count = ?, skipped = ? WHERE id = ?').run(mine.length, JSON.stringify(skipped), row.id);
  return { import: getMonsterImport(row.id), imported: mine.length, skipped };
}

function getMonsterImport(id) {
  const row = db.prepare(`
    SELECT i.*, p.discord_tag AS uploaded_by_tag FROM monster_imports i LEFT JOIN players p ON p.id = i.uploaded_by WHERE i.id = ?
  `).get(Number(id));
  return row ? importView(row) : null;
}

function importView(row) {
  const meta = readJson(row.meta, null);
  return {
    id: row.id,
    label: row.label,
    fileName: row.file_name,
    monsters: row.monster_count,
    skipped: readJson(row.skipped, []) || [],
    sources: meta && Array.isArray(meta.sources) ? meta.sources.map(source => source.full || source.json).filter(Boolean) : [],
    uploadedBy: row.uploaded_by_tag || (row.uploaded_by === null ? 'Root DM' : null),
    createdAt: row.created_at
  };
}

function listMonsterImports() {
  return db.prepare(`
    SELECT i.*, p.discord_tag AS uploaded_by_tag FROM monster_imports i LEFT JOIN players p ON p.id = i.uploaded_by
    WHERE i.status = 'ready' ORDER BY i.id
  `).all().map(importView);
}

// Removes a file's creatures from the catalog (encounters that used them
// keep their HP, but lose the statblock).
function deleteMonsterImport({ user, importId }) {
  requireDm(user);
  const row = db.prepare('SELECT id FROM monster_imports WHERE id = ?').get(Number(importId));
  if (!row) throw new Error('That import is gone already.');
  db.transaction(() => {
    db.prepare('DELETE FROM imported_monsters WHERE import_id = ?').run(row.id);
    db.prepare('DELETE FROM monster_imports WHERE id = ?').run(row.id);
  })();
  refreshImportedMonsters();
  return { deleted: true };
}

// The catalog has the imported creatures from the start.
try {
  refreshImportedMonsters();
} catch (error) {
  console.warn('Imported monsters could not be loaded:', error.message);
}

module.exports = {
  refreshImportedMonsters,
  startMonsterImport,
  addImportedMonsters,
  finishMonsterImport,
  getMonsterImport,
  listMonsterImports,
  deleteMonsterImport
};
