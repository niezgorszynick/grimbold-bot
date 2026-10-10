// db/analytics.js — Read-only statistics for the Analytics tab.

'use strict';

const { db } = require('./connection');

function getCharacterAnalytics() {
  const characters = db.prepare(`
    SELECT c.*,
           p.discord_tag AS player_tag,
           dm.discord_tag AS death_dm_name,
           a.title AS death_adv_title
    FROM characters c
    LEFT JOIN players p ON c.player_id = p.id
    LEFT JOIN players dm ON c.death_dm_player_id = dm.id
    LEFT JOIN adventures a ON c.death_adventure_id = a.id
    ORDER BY c.name ASC
  `).all();
  const primaryClasses = new Map(
    db.prepare(`
      SELECT character_id, class_name
      FROM character_classes
      WHERE is_primary = 1
    `).all().map(row => [row.character_id, row.class_name])
  );

  const speciesCount = {};
  const classCount = {};
  const statusCount = { Alive: 0, Dead: 0 };
  const levelCount = {};
  let totalXp = 0;

  for (const character of characters) {
    const status = character.status === 'dead' ? 'Dead' : 'Alive';
    const species = character.race || 'Unknown';
    const charClass = primaryClasses.get(character.id) || character.class || 'Unassigned';
    const level = character.level || 3;
    statusCount[status] += 1;
    speciesCount[species] = (speciesCount[species] || 0) + 1;
    classCount[charClass] = (classCount[charClass] || 0) + 1;
    const levelKey = `Lvl ${level}`;
    levelCount[levelKey] = (levelCount[levelKey] || 0) + 1;
    totalXp += character.xp || 0;
  }

  return {
    total: characters.length,
    totalXp,
    averageLevel: characters.length
      ? Number((characters.reduce((sum, character) => sum + (character.level || 3), 0) / characters.length).toFixed(1))
      : 0,
    speciesCount,
    classCount,
    statusCount,
    levelCount,
    graveyard: characters.filter(character => character.status === 'dead')
  };
}

function getDiceAnalytics() {
  const rollCounts = db.prepare(`
    SELECT roll_value, COUNT(*) AS count
    FROM rolls
    WHERE roll_value BETWEEN 1 AND 20
    GROUP BY roll_value
  `).all();
  const distribution = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [index + 1, 0])
  );

  let totalRolls = 0;
  let totalSum = 0;

  for (const { roll_value: value, count } of rollCounts) {
    distribution[value] = count;
    totalRolls += count;
    totalSum += value * count;
  }
  const weeklyRolls = totalRolls;

  // d20s rolled on character sheets and the adventure table (db/dice.js).
  const { getSheetD20Faces } = require('./dice');
  const sheetFaces = getSheetD20Faces();
  for (const value of sheetFaces) {
    distribution[value] += 1;
    totalRolls += 1;
    totalSum += value;
  }

  return {
    weeklyRolls,
    sheetRolls: sheetFaces.length,
    totalRolls,
    averageRoll: totalRolls ? Number((totalSum / totalRolls).toFixed(2)) : 0,
    nat20Count: distribution[20],
    nat1Count: distribution[1],
    distribution
  };
}

// The other dice rolled in the panel (damage, custom formulas, crits): one
// distribution per die, with the average against the expected one.
function getOtherDiceAnalytics() {
  const { TRACKED_DICE, getSheetDieFaces } = require('./dice');
  return TRACKED_DICE.filter(sides => sides !== 20).map(sides => {
    const faces = getSheetDieFaces(sides);
    const distribution = Object.fromEntries(Array.from({ length: sides }, (_, index) => [index + 1, 0]));
    let sum = 0;
    for (const value of faces) {
      distribution[value] += 1;
      sum += value;
    }
    return {
      sides,
      totalRolls: faces.length,
      averageRoll: faces.length ? Number((sum / faces.length).toFixed(2)) : 0,
      expectedAverage: (sides + 1) / 2,
      maxCount: distribution[sides],
      minCount: distribution[1],
      distribution
    };
  });
}

module.exports = {
  getOtherDiceAnalytics,
  getCharacterAnalytics,
  getDiceAnalytics
};
