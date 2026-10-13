// db/npcs.js — Notable NPCs (Kevah, Arleta, ...): lore everyone can read,
// stats and notes for DMs, and the adventures each appeared in. Adding NPCs to
// a running adventure and their HP there live in db/activeAdventures.js.

'use strict';

const { db } = require('./connection');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const STATUSES = ['alive', 'dead', 'unknown'];

function readAbilities(json) {
  let data = {};
  try {
    data = JSON.parse(json || '{}') || {};
  } catch {
    data = {};
  }
  return Object.fromEntries(ABILITIES.filter(ability => Number.isInteger(data[ability])).map(ability => [ability, data[ability]]));
}

// Adventures each NPC appeared in: { npcId: [{ id, title, status }] }.
function appearances(npcIds) {
  if (!npcIds.length) return {};
  const rows = db.prepare(`
    SELECT an.npc_id, a.id, a.title, a.status FROM adventure_npcs an JOIN adventures a ON a.id = an.adventure_id
    WHERE an.npc_id IN (${npcIds.map(() => '?').join(',')}) ORDER BY a.id
  `).all(...npcIds);
  const byNpc = {};
  rows.forEach(row => { (byNpc[row.npc_id] = byNpc[row.npc_id] || []).push({ id: row.id, title: row.title, status: row.status }); });
  return byNpc;
}

// Stats and DM notes only with showStats (DMs).
function npcView(row, adventures, showStats) {
  const view = {
    id: row.id,
    name: row.name,
    affiliation: row.affiliation,
    description: row.description,
    sheetUrl: row.sheet_url,
    status: row.status,
    adventures: adventures || []
  };
  if (!showStats) return view;
  const abilities = readAbilities(row.abilities);
  return {
    ...view,
    dmNotes: row.dm_notes,
    stats: {
      armorClass: row.armor_class,
      hpMax: row.hp_max,
      hpCurrent: row.hp_current,
      hpTemp: row.hp_temp,
      speed: row.speed,
      abilities: Object.fromEntries(Object.entries(abilities).map(([ability, score]) => [ability, { score, modifier: Math.floor((score - 10) / 2) }]))
    }
  };
}

function listNpcs({ showStats = false } = {}) {
  const rows = db.prepare('SELECT * FROM npcs ORDER BY name COLLATE NOCASE').all();
  const byNpc = appearances(rows.map(row => row.id));
  return rows.map(row => npcView(row, byNpc[row.id], showStats));
}

function getNpc(id, { showStats = false } = {}) {
  const row = db.prepare('SELECT * FROM npcs WHERE id = ?').get(Number(id));
  if (!row) return null;
  return npcView(row, appearances([row.id])[row.id], showStats);
}

// NPCs on an adventure's table.
function getAdventureNpcs(adventureId, { showStats = false } = {}) {
  const rows = db.prepare(`
    SELECT n.* FROM adventure_npcs an JOIN npcs n ON n.id = an.npc_id
    WHERE an.adventure_id = ? ORDER BY an.added_at, n.name COLLATE NOCASE
  `).all(Number(adventureId));
  const byNpc = appearances(rows.map(row => row.id));
  return rows.map(row => npcView(row, byNpc[row.id], showStats));
}

function cleanText(value, max, label) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

function optionalInt(value, min, max, label) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return number;
}

// Creates (no id) or updates an NPC (admins). fields: name, affiliation,
// description, sheet_url, status, dm_notes, armor_class, hp_max, hp_current,
// speed, str…cha, adventure_ids (the adventures they appeared in).
function saveNpc(fields) {
  const name = cleanText(fields.name, 100, 'Name');
  if (!name) throw new Error('An NPC needs a name.');
  const status = STATUSES.includes(fields.status) ? fields.status : 'alive';
  const sheetUrl = cleanText(fields.sheet_url, 500, 'Sheet link');
  if (sheetUrl && !/^https?:\/\//i.test(sheetUrl)) throw new Error('The sheet link must start with http:// or https://.');
  const hpMax = optionalInt(fields.hp_max, 1, 5000, 'Max HP');
  let hpCurrent = optionalInt(fields.hp_current, 0, 5000, 'Current HP');
  if (hpCurrent === null) hpCurrent = hpMax;
  if (hpMax !== null && hpCurrent !== null && hpCurrent > hpMax) hpCurrent = hpMax;
  const abilities = {};
  for (const ability of ABILITIES) {
    const score = optionalInt(fields[ability], 1, 30, ability.toUpperCase());
    if (score !== null) abilities[ability] = score;
  }
  const values = [
    name,
    cleanText(fields.affiliation, 100, 'Affiliation'),
    cleanText(fields.description, 5000, 'Description'),
    sheetUrl,
    status,
    cleanText(fields.dm_notes, 5000, 'DM notes'),
    optionalInt(fields.armor_class, 0, 40, 'AC'),
    hpMax,
    hpCurrent,
    cleanText(fields.speed, 60, 'Speed'),
    JSON.stringify(abilities)
  ];
  const adventureIds = [...new Set([].concat(fields.adventure_ids || []).map(Number))].filter(Number.isSafeInteger);
  return db.transaction(() => {
    let id = Number(fields.id) || null;
    if (id) {
      const result = db.prepare(`
        UPDATE npcs SET name = ?, affiliation = ?, description = ?, sheet_url = ?, status = ?, dm_notes = ?,
          armor_class = ?, hp_max = ?, hp_current = ?, speed = ?, abilities = ? WHERE id = ?
      `).run(...values, id);
      if (!result.changes) throw new Error('NPC not found.');
    } else {
      id = Number(db.prepare(`
        INSERT INTO npcs (name, affiliation, description, sheet_url, status, dm_notes, armor_class, hp_max, hp_current, speed, abilities)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...values).lastInsertRowid);
    }
    if (fields.adventure_ids !== undefined) {
      const known = new Set(db.prepare('SELECT adventure_id FROM adventure_npcs WHERE npc_id = ?').all(id).map(row => row.adventure_id));
      const wanted = new Set(adventureIds.filter(adventureId => db.prepare('SELECT 1 FROM adventures WHERE id = ?').get(adventureId)));
      known.forEach(adventureId => { if (!wanted.has(adventureId)) db.prepare('DELETE FROM adventure_npcs WHERE adventure_id = ? AND npc_id = ?').run(adventureId, id); });
      wanted.forEach(adventureId => { if (!known.has(adventureId)) db.prepare('INSERT INTO adventure_npcs (adventure_id, npc_id) VALUES (?, ?)').run(adventureId, id); });
    }
    return id;
  })();
}

function deleteNpc(id) {
  return db.prepare('DELETE FROM npcs WHERE id = ?').run(Number(id)).changes > 0;
}

module.exports = { NPC_STATUSES: STATUSES, listNpcs, getNpc, getAdventureNpcs, saveNpc, deleteNpc };
