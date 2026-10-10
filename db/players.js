// db/players.js — Player accounts: registration, passwords (salted scrypt) and roles.

'use strict';

const crypto = require('crypto');
const { db } = require('./connection');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const match = /^([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(storedHash);
  if (!match) return false;

  const expectedKey = Buffer.from(match[2], 'hex');
  const derivedKey = crypto.scryptSync(password, match[1], expectedKey.length);
  return crypto.timingSafeEqual(expectedKey, derivedKey);
}

module.exports = {
  getAllPlayersWithCharacters: () => {
    return db.prepare(`
      SELECT 
        p.id AS player_id,
        p.discord_id,
        p.discord_tag,
        p.role,
        CASE WHEN p.password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
        p.dm_points,
        c.id AS character_id,
        c.name AS character_name,
        c.race AS character_race,
        c.class AS character_class,
        c.subclass AS character_subclass,
        c.level AS character_level,
        c.xp AS character_xp,
        c.gold_cp AS character_gold_cp,
        c.status AS character_status
      FROM players p
      LEFT JOIN characters c ON p.id = c.player_id
      ORDER BY p.discord_tag ASC, c.name ASC
    `).all();
  },
getAllPlayers: () => db.prepare(`
    SELECT id, discord_id, discord_tag, role, dm_points, created_at,
           CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password
    FROM players
    ORDER BY discord_tag ASC
  `).all(),
authenticatePlayer: (loginTag, password) => {
    if (typeof loginTag !== 'string' || typeof password !== 'string' ||
        loginTag.length > 256 || password.length > 256) {
      return null;
    }

    const player = db.prepare(`
      SELECT id, discord_tag, role, password_hash
      FROM players
      WHERE discord_tag = ? COLLATE NOCASE
    `).get(loginTag.trim());
    if (!player || !player.password_hash || !verifyPassword(password, player.password_hash)) {
      return null;
    }

    return {
      id: player.id,
      discord_tag: player.discord_tag,
      role: player.role || 'player'
    };
  },
setPlayerCredentials: (playerId, plainPassword, role = 'player') => {
    const id = Number(playerId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Valid player must be selected.');
    if (typeof plainPassword !== 'string' || plainPassword.trim().length < 4 || plainPassword.length > 256) {
      throw new Error('Password must be 4-256 characters.');
    }
    if (role !== 'player' && role !== 'admin') throw new Error('Invalid account role.');

    const result = db.prepare(`
      UPDATE players
      SET password_hash = ?, role = ?
      WHERE id = ?
    `).run(hashPassword(plainPassword.trim()), role, id);
    if (result.changes === 0) throw new Error('Player not found.');
  },
addPlayer: ({ discord_id, discord_tag }) => {
    const trimmedId = (discord_id || '').trim();
    const trimmedTag = (discord_tag || '').trim();
    if (!trimmedId) throw new Error('Discord ID is required.');
    if (!trimmedTag) throw new Error('Discord Tag/Username is required.');

    const existing = db.prepare('SELECT id FROM players WHERE discord_id = ?').get(trimmedId);
    if (existing) throw new Error(`Player with Discord ID "${trimmedId}" already exists.`);

    return db.prepare('INSERT INTO players (discord_id, discord_tag) VALUES (?, ?)').run(trimmedId, trimmedTag);
  },
updatePlayer: ({ id, discord_id, discord_tag }) => {
    const trimmedId = (discord_id || '').trim();
    const trimmedTag = (discord_tag || '').trim();
    if (!trimmedId || !trimmedTag) throw new Error('Both Discord ID and Tag are required.');

    const existing = db.prepare('SELECT id FROM players WHERE discord_id = ? AND id != ?').get(trimmedId, id);
    if (existing) throw new Error(`Another player already uses Discord ID "${trimmedId}".`);

    return db.prepare('UPDATE players SET discord_id = ?, discord_tag = ? WHERE id = ?').run(trimmedId, trimmedTag, id);
  },
deletePlayer: (id) => {
    return db.prepare('DELETE FROM players WHERE id = ?').run(id);
  }
};
