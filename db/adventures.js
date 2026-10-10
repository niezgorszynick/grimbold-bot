// db/adventures.js — Adventures: recording sessions, XP rewards and DM points.

'use strict';

const { db } = require('./connection');
const { updateCharacterProgression } = require('./characters');

module.exports = {
  getAdventureById: (id) => {
    return db.prepare('SELECT * FROM adventures WHERE id = ?').get(Number(id));
  },
  getAdventureParticipantIds: (adventureId) => {
    const rows = db.prepare('SELECT character_id FROM adventure_rewards WHERE adventure_id = ?').all(Number(adventureId));
    return rows.map(r => r.character_id);
  },
  updateAdventure: ({ adventure_id, title, description, xp_awarded, dm_player_id, dm_character_id, character_ids }) => {
    const run = db.transaction(() => {
      const advId = Number(adventure_id);
      const newXp = Math.max(1, parseInt(xp_awarded, 10) || 1);
      const newDmPlayerId = dm_player_id ? Number(dm_player_id) : null;
      const newDmCharId = dm_character_id ? Number(dm_character_id) : null;
      const targetCharIds = Array.from(new Set((character_ids || []).map(Number)));

      // 1. Load the current adventure
      const oldAdv = db.prepare('SELECT * FROM adventures WHERE id = ?').get(advId);
      if (!oldAdv) {
        throw new Error(`Adventure #${advId} not found.`);
      }
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

      // 6. DM bonus (+1 XP to the DM's character, or +1 DM point to the player)
      if (oldDmCharId !== newDmCharId || oldDmPlayerId !== newDmPlayerId) {
        // Undo the previous DM reward
        if (oldDmCharId) {
          const prevChar = getCharStmt.get(oldDmCharId);
          if (prevChar) {
            const revXp = Math.max(0, prevChar.xp - 1);
            updateCharacterProgression(oldDmCharId, revXp);
          }
        } else if (oldDmPlayerId) {
          db.prepare('UPDATE players SET dm_points = MAX(0, dm_points - 1) WHERE id = ?').run(oldDmPlayerId);
        }

        // Przyznanie nowej nagrody DM
        if (newDmCharId) {
          const nextChar = getCharStmt.get(newDmCharId);
          if (nextChar) {
            const elevatedXp = nextChar.xp + 1;
            updateCharacterProgression(newDmCharId, elevatedXp);
          }
        } else if (newDmPlayerId) {
          db.prepare('UPDATE players SET dm_points = dm_points + 1 WHERE id = ?').run(newDmPlayerId);
        }
      }

      // 7. Save the adventure details
      db.prepare(`
        UPDATE adventures 
        SET title = ?, description = ?, xp_awarded = ?, dm_player_id = ?, dm_character_id = ?
        WHERE id = ?
      `).run(title, description || '', newXp, newDmPlayerId, newDmCharId, advId);
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
  getAllAdventures: () => db.prepare(`
    SELECT a.*, p.discord_tag AS dm_name 
    FROM adventures a
    LEFT JOIN players p ON a.dm_player_id = p.id
    WHERE a.status = 'completed'
    ORDER BY COALESCE(a.completed_at, a.created_at) DESC
  `).all(),
recordAdventure: ({ title, description, xp_awarded, dm_player_id, dm_character_id, character_ids }) => {
    const run = db.transaction(() => {
      const xp = Math.max(1, parseInt(xp_awarded, 10) || 1);
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

      // DM bonus: directly to a character, or banked with the player
      if (targetDmCharId) {
        const dmChar = db.prepare('SELECT xp FROM characters WHERE id = ?').get(targetDmCharId);
        if (dmChar) {
          const nextXp = dmChar.xp + 1;
          updateCharacterProgression(targetDmCharId, nextXp);
        }
      } else if (targetDmPlayerId) {
        db.prepare('UPDATE players SET dm_points = dm_points + 1 WHERE id = ?').run(targetDmPlayerId);
      }

      return adventureId;
    });
    return run();
  }
};
