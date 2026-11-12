// db/lineup.js — The Lineup tab: living characters side by side by height
// (Appearance → Height, parsed by rules/height.js), drawn from their build,
// species and class. Heights and looks aren't secret: every signed-in user
// sees every character; the running adventures' parties are quick picks.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');

const BUILDS = ['masculine', 'feminine', 'neutral'];
const HAIR_LENGTHS = ['bald', 'short', 'medium', 'long'];

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getLineup(user) {
  const classRows = db.prepare('SELECT character_id, class_name, class_level FROM character_classes ORDER BY class_level DESC, id').all();
  const mainClass = new Map();
  for (const row of classRows) if (!mainClass.has(row.character_id)) mainClass.set(row.character_id, row.class_name);
  const characters = db.prepare(`
    SELECT c.id, c.name, c.race, c.class, c.level, c.player_id, c.sheet_data, p.discord_tag AS player
    FROM characters c LEFT JOIN players p ON p.id = c.player_id
    WHERE c.status = 'alive' ORDER BY c.name COLLATE NOCASE
  `).all().map(row => {
    const sheet = readSheet(row.sheet_data);
    const look = sheet.appearance && typeof sheet.appearance === 'object' ? sheet.appearance : {};
    const heightText = typeof look.height === 'string' ? look.height : '';
    return {
      id: row.id,
      name: row.name,
      player: row.player || null,
      mine: Boolean(user && row.player_id === Number(user.id)),
      species: row.race,
      lineage: typeof sheet.speciesOption === 'string' ? sheet.speciesOption : null,
      className: mainClass.get(row.id) || row.class,
      level: row.level,
      heightText,
      heightCm: rules.parseHeightCm(heightText),
      build: BUILDS.includes(look.build) ? look.build : null,
      hairLength: HAIR_LENGTHS.includes(look.hairLength) ? look.hairLength : null
    };
  });
  const parties = db.prepare(`
    SELECT a.id, a.title, GROUP_CONCAT(ap.character_id) AS ids
    FROM adventures a JOIN adventure_party ap ON ap.adventure_id = a.id
    WHERE a.status = 'active' GROUP BY a.id ORDER BY a.created_at DESC
  `).all().map(row => ({ id: row.id, title: row.title, characterIds: String(row.ids || '').split(',').map(Number).filter(Boolean) }));
  return { characters, parties };
}

module.exports = { getLineup, LINEUP_BUILDS: BUILDS };
