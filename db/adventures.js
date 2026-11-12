// db/adventures.js — Adventures: recording sessions, XP rewards and DM points.

'use strict';

const { db } = require('./connection');
const { updateCharacterProgression } = require('./characters');

// XP for an adventure: 0 to 20 as given (0 is allowed, if stingy); else 1.
function xpOrOne(value) {
  const xp = parseInt(value, 10);
  return Number.isInteger(xp) && xp >= 0 ? xp : 1;
}

// What the DM earns for an adventure: its XP, and at least 1 (a 0 XP adventure
// still gives the DM 1).
const dmRewardFor = xp => Math.max(1, Number(xp) || 0);

// The DM's reward (the amount from dmRewardFor), to one of the DM's characters, or
// banked as that many DM points with the DM. Returns the XP given (stored as
// adventures.dm_reward_xp, so it can be taken back exactly).
function giveDmReward({ dmCharacterId, dmPlayerId, xp }) {
  const amount = Math.max(0, Number(xp) || 0);
  if (dmCharacterId) {
    const character = db.prepare('SELECT xp FROM characters WHERE id = ?').get(Number(dmCharacterId));
    if (!character) return 0;
    if (amount) updateCharacterProgression(Number(dmCharacterId), character.xp + amount);
    return amount;
  }
  if (dmPlayerId) {
    if (amount) db.prepare('UPDATE players SET dm_points = dm_points + ? WHERE id = ?').run(amount, Number(dmPlayerId));
    return amount;
  }
  return 0;
}

// Takes back what an adventure gave its DM.
function takeDmReward(adventure) {
  const amount = Number(adventure.dm_reward_xp) || 0;
  if (!amount) return;
  if (adventure.dm_character_id) {
    const character = db.prepare('SELECT xp FROM characters WHERE id = ?').get(adventure.dm_character_id);
    if (character) updateCharacterProgression(adventure.dm_character_id, Math.max(0, character.xp - amount));
  } else if (adventure.dm_player_id) {
    db.prepare('UPDATE players SET dm_points = MAX(0, dm_points - ?) WHERE id = ?').run(amount, adventure.dm_player_id);
  }
}

// Once, after migration 35: finished adventures gave their DM 1 XP whatever the
// adventure was worth; the DM gets the rest now (0 XP adventures keep their 1).
// Only adventures still short are touched, so running it again changes nothing.
function settleDmRewards() {
  const short = db.prepare(`
    SELECT * FROM adventures
    WHERE status = 'completed' AND dm_reward_xp > 0 AND dm_reward_xp < xp_awarded
      AND (dm_character_id IS NOT NULL OR dm_player_id IS NOT NULL)
  `).all();
  db.transaction(() => {
    for (const adventure of short) {
      const extra = adventure.xp_awarded - adventure.dm_reward_xp;
      const given = giveDmReward({ dmCharacterId: adventure.dm_character_id, dmPlayerId: adventure.dm_player_id, xp: extra });
      if (given) db.prepare('UPDATE adventures SET dm_reward_xp = dm_reward_xp + ? WHERE id = ?').run(given, adventure.id);
    }
  })();
  return short.length;
}

const isRootDm = user => Boolean(user && user.role === 'admin' && Number(user.id) === 0);

// Editing a finished adventure (and deleting a cancelled one): its own DM, or the Root DM.
function canEditAdventure(adventure, user) {
  if (isRootDm(user)) return true;
  return Boolean(user && user.role === 'admin' && adventure && adventure.dm_player_id !== null && Number(adventure.dm_player_id) === Number(user.id));
}

module.exports = {
  dmRewardFor,
  giveDmReward,
  settleDmRewards,
  canEditAdventure,
  // Deleting a finished adventure (it takes XP back): the Root DM only.
  canDeleteAdventure: (adventure, user) => (adventure && adventure.status === 'completed' ? isRootDm(user) : canEditAdventure(adventure, user)),
  getAdventureById: (id) => {
    return db.prepare('SELECT * FROM adventures WHERE id = ?').get(Number(id));
  },
  getAdventureParticipantIds: (adventureId) => {
    const rows = db.prepare('SELECT character_id FROM adventure_rewards WHERE adventure_id = ?').all(Number(adventureId));
    return rows.map(r => r.character_id);
  },
  updateAdventure: ({ adventure_id, title, description, xp_awarded, dm_player_id, dm_character_id, character_ids, user }) => {
    const run = db.transaction(() => {
      const advId = Number(adventure_id);
      const newXp = xpOrOne(xp_awarded);
      const newDmPlayerId = dm_player_id ? Number(dm_player_id) : null;
      const newDmCharId = dm_character_id ? Number(dm_character_id) : null;
      const targetCharIds = Array.from(new Set((character_ids || []).map(Number)));

      // 1. Load the current adventure
      const oldAdv = db.prepare('SELECT * FROM adventures WHERE id = ?').get(advId);
      if (!oldAdv) {
        throw new Error(`Adventure #${advId} not found.`);
      }
      if (!canEditAdventure(oldAdv, user)) throw new Error('Only the DM who ran this adventure (or the Root DM) can edit it.');
      // Running adventures award XP when they are finished, not here.
      if (oldAdv.status && oldAdv.status !== 'completed') {
        throw new Error('This adventure is still running: finish it from its adventure table.');
      }

      const oldXp = oldAdv.xp_awarded || 0;
      const diffXp = newXp - oldXp;
      const oldDmCharId = oldAdv.dm_character_id ? Number(oldAdv.dm_character_id) : null;
      const oldDmPlayerId = oldAdv.dm_player_id ? Number(oldAdv.dm_player_id) : null;

      // 2. Compare participant lists
      const currentRewards = db.prepare('SELECT character_id FROM adventure_rewards WHERE adventure_id = ?').all(advId);
      const oldCharIds = currentRewards.map(r => r.character_id);

      const toRemove = oldCharIds.filter(id => !targetCharIds.includes(id));
      const toKeep = oldCharIds.filter(id => targetCharIds.includes(id));
      const toAdd = targetCharIds.filter(id => !oldCharIds.includes(id));

      const getCharStmt = db.prepare('SELECT xp FROM characters WHERE id = ?');

      // 3. Removed participants: take back their XP and recalculate level
      for (const charId of toRemove) {
        const char = getCharStmt.get(charId);
        if (char) {
          const nextXp = Math.max(0, char.xp - oldXp);
          updateCharacterProgression(charId, nextXp);
        }
        db.prepare('DELETE FROM adventure_rewards WHERE adventure_id = ? AND character_id = ?').run(advId, charId);
      }

      // 4. Remaining participants: adjust by the XP difference
      if (diffXp !== 0) {
        for (const charId of toKeep) {
          const char = getCharStmt.get(charId);
          if (char) {
            const nextXp = Math.max(0, char.xp + diffXp);
            updateCharacterProgression(charId, nextXp);
            db.prepare('UPDATE adventure_rewards SET xp = ? WHERE adventure_id = ? AND character_id = ?').run(newXp, advId, charId);
          }
        }
      }

      // 5. Postacie nowo dodane: przyznanie newXp
      for (const charId of toAdd) {
        const char = getCharStmt.get(charId);
        if (char) {
          const nextXp = char.xp + newXp;
          updateCharacterProgression(charId, nextXp);
          db.prepare('INSERT INTO adventure_rewards (adventure_id, character_id, xp) VALUES (?, ?, ?)').run(advId, charId, newXp);
        }
      }

      // 6. DM reward: the adventure's XP (at least 1), to the DM's character or as DM points.
      // A new DM, character or XP: the old reward goes back, the new one is given.
      let dmRewardXp = Number(oldAdv.dm_reward_xp) || 0;
      if (oldDmCharId !== newDmCharId || oldDmPlayerId !== newDmPlayerId || dmRewardXp !== dmRewardFor(newXp)) {
        takeDmReward(oldAdv);
        dmRewardXp = giveDmReward({ dmCharacterId: newDmCharId, dmPlayerId: newDmPlayerId, xp: dmRewardFor(newXp) });
      }

      // 7. Save the adventure details
      db.prepare(`
        UPDATE adventures
        SET title = ?, description = ?, xp_awarded = ?, dm_player_id = ?, dm_character_id = ?, dm_reward_xp = ?
        WHERE id = ?
      `).run(title, description || '', newXp, newDmPlayerId, newDmCharId, dmRewardXp, advId);
    });

    return run();
  },
    // Spend 1 banked DM point as +1 XP on one of the player's characters
  assignDmPointToCharacter: (playerId, characterId) => {
    const run = db.transaction(() => {
      const player = db.prepare('SELECT dm_points FROM players WHERE id = ?').get(playerId);
      if (!player || player.dm_points < 1) {
        throw new Error('This player has no DM points to spend.');
      }
      const char = db.prepare('SELECT id, xp FROM characters WHERE id = ? AND player_id = ?').get(characterId, playerId);
      if (!char) {
        throw new Error('That character does not belong to this player.');
      }

      const newXp = char.xp + 1;
      db.prepare('UPDATE players SET dm_points = dm_points - 1 WHERE id = ?').run(playerId);
      updateCharacterProgression(characterId, newXp);
    });
    return run();
  },
  // Adventures
  // The characters in each adventure, by adventure id: those rewarded for a
  // finished one, the party of a running one. [{ id, name, player, dmReward }]
  getAdventureParties: adventureIds => {
    const ids = [...new Set(adventureIds.map(Number))].filter(Number.isSafeInteger);
    if (!ids.length) return {};
    const marks = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT r.adventure_id, c.id, c.name, p.discord_tag AS player, 0 AS dm_reward
      FROM adventure_rewards r JOIN characters c ON c.id = r.character_id LEFT JOIN players p ON p.id = c.player_id
      WHERE r.adventure_id IN (${marks})
      UNION ALL
      SELECT ap.adventure_id, c.id, c.name, p.discord_tag, 0
      FROM adventure_party ap JOIN adventures a ON a.id = ap.adventure_id JOIN characters c ON c.id = ap.character_id
      LEFT JOIN players p ON p.id = c.player_id
      WHERE ap.adventure_id IN (${marks}) AND a.status = 'active'
      UNION ALL
      SELECT a.id, c.id, c.name, p.discord_tag, 1
      FROM adventures a JOIN characters c ON c.id = a.dm_character_id LEFT JOIN players p ON p.id = c.player_id
      WHERE a.id IN (${marks}) AND a.status = 'completed'
    `).all(...ids, ...ids, ...ids);
    const parties = {};
    rows.forEach(row => {
      const list = parties[row.adventure_id] = parties[row.adventure_id] || [];
      if (!list.some(entry => entry.id === row.id && entry.dmReward === Boolean(row.dm_reward))) {
        list.push({ id: row.id, name: row.name, player: row.player || null, dmReward: Boolean(row.dm_reward) });
      }
    });
    Object.values(parties).forEach(list => list.sort((a, b) => Number(a.dmReward) - Number(b.dmReward) || a.name.localeCompare(b.name)));
    return parties;
  },
  // Adventures that never happened (cancelled), newest first.
  getCancelledAdventures: () => db.prepare(`
    SELECT a.*, p.discord_tag AS dm_name FROM adventures a LEFT JOIN players p ON a.dm_player_id = p.id
    WHERE a.status = 'cancelled' ORDER BY a.id DESC
  `).all(),
  // A test or mistaken adventure, gone for good: a finished one by the Root DM
  // only (its XP and DM reward are taken back first), a cancelled one also by
  // the DM who would have run it. A running one must be cancelled before
  // (that tags its Discord thread, so the bot doesn't open it again). Its
  // party, sessions, encounters and map routes go with it.
  deleteAdventure: ({ adventureId, user }) => {
    if (!user || user.role !== 'admin') throw new Error('Only a DM can delete an adventure.');
    return db.transaction(() => {
      const adventure = db.prepare('SELECT * FROM adventures WHERE id = ?').get(Number(adventureId));
      if (!adventure) throw new Error('Adventure not found.');
      if (adventure.status === 'active') throw new Error(`${adventure.title} is still running: cancel it from its adventure table first, then delete it.`);
      if (!module.exports.canDeleteAdventure(adventure, user)) {
        throw new Error(adventure.status === 'completed'
          ? 'Only the Root DM can delete a finished adventure.'
          : 'Only the DM of this adventure (or the Root DM) can delete it.');
      }
      const rewards = adventure.status === 'completed'
        ? db.prepare('SELECT character_id, xp FROM adventure_rewards WHERE adventure_id = ?').all(adventure.id)
        : [];
      const getXp = db.prepare('SELECT xp FROM characters WHERE id = ?');
      for (const reward of rewards) {
        const character = getXp.get(reward.character_id);
        if (character) updateCharacterProgression(reward.character_id, Math.max(0, character.xp - reward.xp));
      }
      if (adventure.status === 'completed') takeDmReward(adventure);
      db.prepare('DELETE FROM adventures WHERE id = ?').run(adventure.id);
      return { title: adventure.title, xpTakenBack: rewards.length };
    })();
  },
  getAllAdventures: () => db.prepare(`
    SELECT a.*, p.discord_tag AS dm_name 
    FROM adventures a
    LEFT JOIN players p ON a.dm_player_id = p.id
    WHERE a.status = 'completed'
    ORDER BY COALESCE(a.completed_at, a.created_at) DESC
  `).all(),
recordAdventure: ({ title, description, xp_awarded, dm_player_id, dm_character_id, character_ids }) => {
    const run = db.transaction(() => {
      const xp = xpOrOne(xp_awarded);
      const targetDmCharId = dm_character_id ? Number(dm_character_id) : null;
      const targetDmPlayerId = dm_player_id ? Number(dm_player_id) : null;

      const insertAdv = db.prepare(`
        INSERT INTO adventures (title, description, xp_awarded, dm_player_id, dm_character_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(title, description, xp, targetDmPlayerId, targetDmCharId);

      const adventureId = insertAdv.lastInsertRowid;

      // Przyznanie XP uczestnikom
      if (Array.isArray(character_ids)) {
        for (const charId of character_ids) {
          db.prepare(`
            INSERT INTO adventure_rewards (adventure_id, character_id, xp)
            VALUES (?, ?, ?)
          `).run(adventureId, charId, xp);

          const char = db.prepare('SELECT xp FROM characters WHERE id = ?').get(charId);
          if (char) {
            const nextXp = char.xp + xp;
            updateCharacterProgression(charId, nextXp);
          }
        }
      }

      // DM reward: the adventure's XP (at least 1), to a character or banked as DM points.
      const dmRewardXp = giveDmReward({ dmCharacterId: targetDmCharId, dmPlayerId: targetDmPlayerId, xp: dmRewardFor(xp) });
      db.prepare('UPDATE adventures SET dm_reward_xp = ? WHERE id = ?').run(dmRewardXp, adventureId);

      return adventureId;
    });
    return run();
  }
};
