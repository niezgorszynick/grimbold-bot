// db/npcs.js — Notable NPCs (Kevah, Arleta, ...). Players see who they are:
// name, role, portrait and the adventures they appeared in. DMs also see the
// lore, personality, status, stats, notes, and which DM looks after the NPC
// and whether they have plans for it. Adding NPCs to a running adventure and
// their HP there live in db/activeAdventures.js; uploaded portraits in
// db/npcFiles.js.

'use strict';

const { db } = require('./connection');
// The Root DM (auth.js ROOT_ADMIN) has no players row; auth.js loads db, so
// it is not required here.
const ROOT_ADMIN = { id: 0, discord_tag: 'Root DM' };

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const STATUSES = ['alive', 'dead', 'unknown'];
// 'reserved': the owning DM has long-term plans, ask them first.
// 'free': a one-off, any DM may reuse them. '': not said.
const PLANS = ['', 'reserved', 'free'];

const NPC_QUERY = 'SELECT n.*, p.discord_tag AS owner_tag FROM npcs n LEFT JOIN players p ON p.id = n.owner_player_id';

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

// The browser URL of an uploaded file; the file name busts the cache on change.
const fileUrl = (row, kind) => {
  const file = row[`${kind}_file`];
  return file ? `/api/npcs/${row.id}/files/${kind}?v=${encodeURIComponent(file)}` : null;
};

function ownerOf(row) {
  if (row.owner_player_id === null || row.owner_player_id === undefined) return null;
  if (row.owner_player_id === ROOT_ADMIN.id) return { id: ROOT_ADMIN.id, tag: ROOT_ADMIN.discord_tag };
  return { id: row.owner_player_id, tag: row.owner_tag || 'a former DM' };
}

// Players: name, role (affiliation), portrait, adventures. DMs (showStats): the rest.
function npcView(row, adventures, showStats) {
  const view = {
    id: row.id,
    name: row.name,
    affiliation: row.affiliation,
    portraitUrl: fileUrl(row, 'portrait'),
    adventures: adventures || []
  };
  if (!showStats) return view;
  const abilities = readAbilities(row.abilities);
  return {
    ...view,
    status: row.status,
    description: row.description,
    personality: row.personality || '',
    owner: ownerOf(row),
    plans: row.plans || '',
    plansNote: row.plans_note || '',
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
  const rows = db.prepare(`${NPC_QUERY} ORDER BY n.name COLLATE NOCASE`).all();
  const byNpc = appearances(rows.map(row => row.id));
  return rows.map(row => npcView(row, byNpc[row.id], showStats));
}

function getNpc(id, { showStats = false } = {}) {
  const row = db.prepare(`${NPC_QUERY} WHERE n.id = ?`).get(Number(id));
  if (!row) return null;
  return npcView(row, appearances([row.id])[row.id], showStats);
}

// NPCs on an adventure's table.
// How an NPC looks to the party: a word, never numbers.
function npcCondition(row) {
  if (!Number.isInteger(row.hp_max) || row.hp_max <= 0) return null;
  const current = Number.isInteger(row.hp_current) ? row.hp_current : row.hp_max;
  if (current <= 0) return 'Down';
  if (current * 2 <= row.hp_max) return 'Bloodied';
  return current < row.hp_max ? 'Wounded' : 'Unhurt';
}

// NPCs on an adventure's table. showStats: the adventure's DM (stats, HP and
// the hidden ones, marked). Everyone else: the revealed ones and their condition.
function getAdventureNpcs(adventureId, { showStats = false } = {}) {
  const rows = db.prepare(`
    SELECT n.*, an.hidden AS table_hidden, p.discord_tag AS owner_tag FROM adventure_npcs an JOIN npcs n ON n.id = an.npc_id
    LEFT JOIN players p ON p.id = n.owner_player_id
    WHERE an.adventure_id = ? ORDER BY an.added_at, n.name COLLATE NOCASE
  `).all(Number(adventureId));
  const shown = showStats ? rows : rows.filter(row => !row.table_hidden);
  const byNpc = appearances(shown.map(row => row.id));
  return shown.map(row => {
    const view = npcView(row, byNpc[row.id], showStats);
    return showStats ? { ...view, hidden: Boolean(row.table_hidden) } : { ...view, condition: npcCondition(row) };
  });
}

// The DMs who can look after an NPC: the Root DM and every admin account.
function listNpcOwners() {
  const admins = db.prepare("SELECT id, discord_tag FROM players WHERE role = 'admin' ORDER BY discord_tag COLLATE NOCASE").all();
  return [{ id: ROOT_ADMIN.id, tag: ROOT_ADMIN.discord_tag }, ...admins.filter(admin => admin.id !== ROOT_ADMIN.id).map(admin => ({ id: admin.id, tag: admin.discord_tag }))];
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

function readOwner(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const id = Number(value);
  if (!listNpcOwners().some(owner => owner.id === id)) throw new Error('The owning DM must be a DM account.');
  return id;
}

// Creates (no id) or updates an NPC (admins). fields: name, affiliation,
// description, personality, status, dm_notes, owner_player_id,
// plans, plans_note, armor_class, hp_max, hp_current, speed, str…cha,
// adventure_ids (the adventures they appeared in). A new NPC without an owner
// belongs to created_by (the DM adding it).
function saveNpc(fields) {
  const name = cleanText(fields.name, 100, 'Name');
  if (!name) throw new Error('An NPC needs a name.');
  const status = STATUSES.includes(fields.status) ? fields.status : 'alive';
  const plans = PLANS.includes(fields.plans) ? fields.plans : '';
  const hpMax = optionalInt(fields.hp_max, 1, 5000, 'Max HP');
  let hpCurrent = optionalInt(fields.hp_current, 0, 5000, 'Current HP');
  if (hpCurrent === null) hpCurrent = hpMax;
  if (hpMax !== null && hpCurrent !== null && hpCurrent > hpMax) hpCurrent = hpMax;
  const abilities = {};
  for (const ability of ABILITIES) {
    const score = optionalInt(fields[ability], 1, 30, ability.toUpperCase());
    if (score !== null) abilities[ability] = score;
  }
  let owner = readOwner(fields.owner_player_id);
  const values = [
    name,
    cleanText(fields.affiliation, 100, 'Role'),
    cleanText(fields.description, 5000, 'Lore'),
    cleanText(fields.personality, 1000, 'Personality'),
    status,
    cleanText(fields.dm_notes, 5000, 'DM notes'),
    plans,
    cleanText(fields.plans_note, 500, 'Plans note'),
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
        UPDATE npcs SET name = ?, affiliation = ?, description = ?, personality = ?, status = ?, dm_notes = ?,
          plans = ?, plans_note = ?, armor_class = ?, hp_max = ?, hp_current = ?, speed = ?, abilities = ?, owner_player_id = ? WHERE id = ?
      `).run(...values, owner, id);
      if (!result.changes) throw new Error('NPC not found.');
    } else {
      if (owner === null && fields.created_by !== undefined && fields.created_by !== null) owner = Number(fields.created_by);
      id = Number(db.prepare(`
        INSERT INTO npcs (name, affiliation, description, personality, status, dm_notes, plans, plans_note,
          armor_class, hp_max, hp_current, speed, abilities, owner_player_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...values, owner).lastInsertRowid);
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
  const row = db.prepare('SELECT portrait_file, statblock_file FROM npcs WHERE id = ?').get(Number(id));
  const deleted = db.prepare('DELETE FROM npcs WHERE id = ?').run(Number(id)).changes > 0;
  if (deleted && row) require('./npcFiles').removeNpcFiles([row.portrait_file, row.statblock_file]);
  return deleted;
}

module.exports = { NPC_STATUSES: STATUSES, NPC_PLANS: PLANS, npcCondition, listNpcs, getNpc, getAdventureNpcs, listNpcOwners, saveNpc, deleteNpc };
