// db/activeAdventures.js — Adventures that are running: created from a
// Discord thread (or by hand), with a party the DM puts together, a live table
// of the party's numbers, and finishing, which awards XP and the DM reward.

'use strict';

const { db } = require('./connection');
const { updateCharacterProgression } = require('./characters');
const { getCharacterSnapshots } = require('./roster');
const { getRecentRolls } = require('./dice');
const { getAdventureNpcs } = require('./npcs');

const MAX_TITLE = 200;
const MAX_NOTES = 4000;

function cleanTitle(title) {
  const text = String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  return text || 'Untitled adventure';
}

function threadUrl(adventure) {
  return adventure.discord_thread_id && adventure.discord_guild_id
    ? `https://discord.com/channels/${adventure.discord_guild_id}/${adventure.discord_thread_id}`
    : null;
}

// A new thread in the adventures channel: one active adventure per thread.
// The DM is the player whose Discord account started the thread.
function createAdventureFromThread({ threadId, guildId, title, ownerDiscordId }) {
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM adventures WHERE discord_thread_id = ?').get(String(threadId));
    if (existing) return { adventure: existing, created: false };
    const dm = ownerDiscordId
      ? db.prepare('SELECT id FROM players WHERE discord_id = ?').get(String(ownerDiscordId))
      : null;
    const id = Number(db.prepare(`
      INSERT INTO adventures (title, description, xp_awarded, dm_player_id, status, discord_thread_id, discord_guild_id)
      VALUES (?, '', 1, ?, 'active', ?, ?)
    `).run(cleanTitle(title), dm ? dm.id : null, String(threadId), guildId ? String(guildId) : null).lastInsertRowid);
    return { adventure: db.prepare('SELECT * FROM adventures WHERE id = ?').get(id), created: true };
  })();
}

// An adventure made in the panel, tied to a Discord thread afterwards.
function linkAdventureToThread({ adventureId, user, threadId, guildId }) {
  const adventure = loadAdventure(adventureId);
  if (!accessTo(adventure, user).manage) throw new Error('Forbidden.');
  if (adventure.discord_thread_id) throw new Error('This adventure already has a Discord thread.');
  const taken = db.prepare('SELECT id, title FROM adventures WHERE discord_thread_id = ?').get(String(threadId));
  if (taken) throw new Error(`That thread already belongs to "${taken.title}".`);
  db.prepare('UPDATE adventures SET discord_thread_id = ?, discord_guild_id = ? WHERE id = ?')
    .run(String(threadId), guildId ? String(guildId) : null, adventure.id);
  return { linked: true, threadUrl: threadUrl({ discord_thread_id: String(threadId), discord_guild_id: guildId }) };
}

// Renaming the thread renames an adventure that is still running.
function renameAdventureForThread(threadId, title) {
  return db.prepare("UPDATE adventures SET title = ? WHERE discord_thread_id = ? AND status = 'active'")
    .run(cleanTitle(title), String(threadId)).changes > 0;
}

function getActiveAdventures() {
  return db.prepare(`
    SELECT a.*, p.discord_tag AS dm_name,
      (SELECT COUNT(*) FROM adventure_party ap WHERE ap.adventure_id = a.id) AS party_size
    FROM adventures a LEFT JOIN players p ON p.id = a.dm_player_id
    WHERE a.status = 'active'
    ORDER BY a.created_at DESC
  `).all().map(adventure => ({ ...adventure, thread_url: threadUrl(adventure) }));
}

function loadAdventure(adventureId) {
  const adventure = db.prepare(`
    SELECT a.*, p.discord_tag AS dm_name
    FROM adventures a LEFT JOIN players p ON p.id = a.dm_player_id WHERE a.id = ?
  `).get(Number(adventureId));
  if (!adventure) throw new Error('Adventure not found.');
  return adventure;
}

function partyIds(adventureId) {
  return db.prepare('SELECT character_id FROM adventure_party WHERE adventure_id = ? ORDER BY added_at, character_id')
    .all(Number(adventureId)).map(row => row.character_id);
}

// For live updates: who may follow this table, and which characters it shows now.
function getAdventureLiveScope({ adventureId, user }) {
  const adventure = loadAdventure(adventureId);
  if (!accessTo(adventure, user).view) throw new Error('Forbidden.');
  return {
    adventureId: adventure.id,
    characterIds: () => new Set(partyIds(adventure.id)),
    npcIds: () => new Set(db.prepare('SELECT npc_id FROM adventure_npcs WHERE adventure_id = ?').all(adventure.id).map(row => row.npc_id))
  };
}

// Admins and the adventure's own DM run it; players with a character in the
// party may look at the table.
function accessTo(adventure, user) {
  const isAdmin = Boolean(user && user.role === 'admin');
  const manage = isAdmin || (adventure.dm_player_id !== null && adventure.dm_player_id === Number(user && user.id));
  if (manage) return { manage: true, view: true };
  const inParty = db.prepare(`
    SELECT 1 FROM adventure_party ap JOIN characters c ON c.id = ap.character_id
    WHERE ap.adventure_id = ? AND c.player_id = ?
  `).get(adventure.id, Number(user && user.id));
  return { manage: false, view: Boolean(inParty) };
}

function requireManage(adventure, user) {
  if (!accessTo(adventure, user).manage) throw new Error('Forbidden.');
  if (adventure.status !== 'active') throw new Error('This adventure is no longer running.');
}

// Everything the adventure table shows. `candidates` (alive characters not in
// the party, with their player) only for those who can manage it.
function getAdventureTable({ adventureId, user }) {
  const adventure = loadAdventure(adventureId);
  const access = accessTo(adventure, user);
  if (!access.view) throw new Error('Forbidden.');
  const ids = adventure.status === 'active'
    ? partyIds(adventure.id)
    : db.prepare('SELECT character_id FROM adventure_rewards WHERE adventure_id = ? ORDER BY id').all(adventure.id).map(row => row.character_id);
  const candidates = access.manage && adventure.status === 'active'
    ? db.prepare(`
        SELECT c.id, c.name, c.class, c.level, c.player_id, p.discord_tag AS player
        FROM characters c JOIN players p ON p.id = c.player_id
        WHERE c.status = 'alive'
        ORDER BY p.discord_tag COLLATE NOCASE, c.name COLLATE NOCASE
      `).all().filter(row => !ids.includes(row.id))
    : [];
  const dmCharacters = access.manage && adventure.dm_player_id
    ? db.prepare("SELECT id, name, level, xp FROM characters WHERE player_id = ? AND status = 'alive' ORDER BY name").all(adventure.dm_player_id)
      // The DM reward can't go to a character who took part.
      .filter(row => !ids.includes(row.id))
    : [];
  return {
    adventure: {
      id: adventure.id,
      title: adventure.title,
      status: adventure.status,
      dm: adventure.dm_name || null,
      dmPlayerId: adventure.dm_player_id,
      startedAt: adventure.created_at,
      completedAt: adventure.completed_at,
      threadUrl: threadUrl(adventure),
      xp: adventure.xp_awarded,
      notes: adventure.description || ''
    },
    canManage: access.manage,
    party: getCharacterSnapshots(ids),
    // The party's latest rolls; private ones only for the DM (and the roller).
    rolls: getRecentRolls({ characterIds: ids, limit: 25, showPrivate: access.manage, viewerId: Number(user && user.id) || null }),
    candidates,
    dmCharacters,
    // Notable NPCs with the party; stats and HP only for the DM.
    npcs: getAdventureNpcs(adventure.id, { showStats: access.manage }),
    // reservedBy: another DM has long-term plans for this NPC (a warning, not a lock).
    npcCandidates: access.manage && adventure.status === 'active'
      ? db.prepare(`
        SELECT n.id, n.name, n.affiliation, n.plans, n.owner_player_id, p.discord_tag AS owner_tag FROM npcs n
        LEFT JOIN players p ON p.id = n.owner_player_id
        WHERE n.status != 'dead' AND n.id NOT IN (SELECT npc_id FROM adventure_npcs WHERE adventure_id = ?) ORDER BY n.name COLLATE NOCASE
      `).all(adventure.id).map(row => ({
        id: row.id,
        name: row.name,
        affiliation: row.affiliation,
        reservedBy: row.plans === 'reserved' && row.owner_player_id !== Number(user && user.id)
          ? (row.owner_player_id === 0 ? 'Root DM' : row.owner_tag || 'another DM')
          : null
      }))
      : []
  };
}

// Adds an NPC to the adventure's table, or takes them off it (the DM).
function setAdventureNpc({ adventureId, user, npcId, inAdventure }) {
  const adventure = loadAdventure(adventureId);
  requireManage(adventure, user);
  const npc = db.prepare('SELECT id FROM npcs WHERE id = ?').get(Number(npcId));
  if (!npc) throw new Error('NPC not found.');
  if (inAdventure) db.prepare('INSERT OR IGNORE INTO adventure_npcs (adventure_id, npc_id) VALUES (?, ?)').run(adventure.id, npc.id);
  else db.prepare('DELETE FROM adventure_npcs WHERE adventure_id = ? AND npc_id = ?').run(adventure.id, npc.id);
  return getAdventureTable({ adventureId: adventure.id, user });
}

// Damage, healing or temporary HP for an NPC on the table (the DM).
// Damage takes temporary HP first; HP never go below 0 or above the maximum.
function changeNpcHp({ adventureId, user, npcId, action, amount }) {
  const adventure = loadAdventure(adventureId);
  requireManage(adventure, user);
  const npc = db.prepare(`
    SELECT n.* FROM adventure_npcs an JOIN npcs n ON n.id = an.npc_id WHERE an.adventure_id = ? AND n.id = ?
  `).get(adventure.id, Number(npcId));
  if (!npc) throw new Error('That NPC is not in this adventure.');
  if (!Number.isInteger(npc.hp_max)) throw new Error(`${npc.name} has no Hit Points set: add them on the Notable NPCs tab.`);
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error('Enter a whole number from 0 to 10000.');
  let current = Number.isInteger(npc.hp_current) ? npc.hp_current : npc.hp_max;
  let temp = npc.hp_temp || 0;
  if (action === 'damage') {
    const absorbed = Math.min(temp, value);
    temp -= absorbed;
    current = Math.max(0, current - (value - absorbed));
  } else if (action === 'heal') {
    current = Math.min(npc.hp_max, current + value);
  } else if (action === 'tempHp') {
    temp = Math.max(temp, value);
  } else {
    throw new Error('Unknown action.');
  }
  db.prepare('UPDATE npcs SET hp_current = ?, hp_temp = ? WHERE id = ?').run(current, temp, npc.id);
  return { npc: { id: npc.id, name: npc.name, hpCurrent: current, hpMax: npc.hp_max, hpTemp: temp } };
}

function setPartyMember({ adventureId, user, characterId, inParty }) {
  return db.transaction(() => {
    const adventure = loadAdventure(adventureId);
    requireManage(adventure, user);
    const character = db.prepare('SELECT id, name, status FROM characters WHERE id = ?').get(Number(characterId));
    if (!character) throw new Error('Character not found.');
    if (inParty) {
      if (character.status !== 'alive') throw new Error(`${character.name} is not among the living.`);
      db.prepare('INSERT OR IGNORE INTO adventure_party (adventure_id, character_id) VALUES (?, ?)').run(adventure.id, character.id);
    } else {
      db.prepare('DELETE FROM adventure_party WHERE adventure_id = ? AND character_id = ?').run(adventure.id, character.id);
    }
    return getAdventureTable({ adventureId, user });
  })();
}

// Awards the adventure XP to the party and the DM reward: +1 XP to one of the
// DM's own characters, or +1 DM point banked with the DM.
function finishAdventure({ adventureId, user, xp, dmCharacterId, notes, title }) {
  return db.transaction(() => {
    const adventure = loadAdventure(adventureId);
    requireManage(adventure, user);
    const award = Number(xp);
    if (!Number.isInteger(award) || award < 1 || award > 20) throw new Error('XP must be a whole number from 1 to 20.');
    const party = partyIds(adventure.id);
    if (!party.length) throw new Error('Add the characters who took part before finishing the adventure.');

    let dmCharacter = null;
    if (dmCharacterId) {
      dmCharacter = db.prepare('SELECT id, player_id, xp, status FROM characters WHERE id = ?').get(Number(dmCharacterId));
      if (!dmCharacter || dmCharacter.player_id !== adventure.dm_player_id) throw new Error("The DM reward goes to one of the DM's own characters.");
      if (party.includes(dmCharacter.id)) throw new Error('The DM reward cannot go to a character in the party.');
    }

    const getXp = db.prepare('SELECT xp FROM characters WHERE id = ?');
    for (const characterId of party) {
      db.prepare('INSERT INTO adventure_rewards (adventure_id, character_id, xp) VALUES (?, ?, ?)').run(adventure.id, characterId, award);
      updateCharacterProgression(characterId, getXp.get(characterId).xp + award);
    }
    if (dmCharacter) updateCharacterProgression(dmCharacter.id, dmCharacter.xp + 1);
    else if (adventure.dm_player_id) db.prepare('UPDATE players SET dm_points = dm_points + 1 WHERE id = ?').run(adventure.dm_player_id);

    db.prepare(`
      UPDATE adventures SET status = 'completed', completed_at = CURRENT_TIMESTAMP, xp_awarded = ?,
        dm_character_id = ?, description = ?, title = ?
      WHERE id = ?
    `).run(award, dmCharacter ? dmCharacter.id : null, String(notes || '').slice(0, MAX_NOTES),
      title === undefined ? adventure.title : cleanTitle(title), adventure.id);
    return { adventureId: adventure.id, party: party.length, xp: award, dmReward: dmCharacter ? 'character' : (adventure.dm_player_id ? 'point' : 'none') };
  })();
}

// An adventure that didn't happen: nothing is awarded.
function cancelAdventure({ adventureId, user }) {
  const adventure = loadAdventure(adventureId);
  requireManage(adventure, user);
  db.prepare("UPDATE adventures SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(adventure.id);
}

// An adventure started by hand (no Discord thread), for admins.
function startAdventure({ title, dmPlayerId }) {
  const id = Number(db.prepare("INSERT INTO adventures (title, description, xp_awarded, dm_player_id, status) VALUES (?, '', 1, ?, 'active')")
    .run(cleanTitle(title), dmPlayerId ? Number(dmPlayerId) : null).lastInsertRowid);
  return id;
}

// Active adventures this user can open (as DM or with a character in the party).
function getAdventuresForUser(user) {
  return getActiveAdventures().filter(adventure => accessTo(adventure, user).view);
}

module.exports = {
  createAdventureFromThread,
  renameAdventureForThread,
  getActiveAdventures,
  getAdventuresForUser,
  getAdventureTable,
  getAdventureLiveScope,
  setAdventureNpc,
  changeNpcHp,
  setPartyMember,
  finishAdventure,
  cancelAdventure,
  startAdventure,
  adventureThreadUrl: threadUrl,
  linkAdventureToThread,
  canManageAdventure: (adventure, user) => accessTo(adventure, user).manage
};
