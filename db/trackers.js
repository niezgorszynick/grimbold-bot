// db/trackers.js — Resources the DM tracks on the adventure table: for a party
// member, a notable NPC or a monster in an encounter, a name ("Legendary Resistance", "Bribe money"), a
// short comment and, if it counts something, how many are left of how many.
// Only the adventure's DM and the Root DM see or change them.

'use strict';

const { db } = require('./connection');

const MAX_NAME = 60;
const MAX_COMMENT = 200;
const MAX_COUNT = 999;

// Lazily: db/activeAdventures.js requires this module for its table.
const adventures = () => require('./activeAdventures');

function cleanName(name) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!text) throw new Error('Give the resource a name.');
  return text;
}

const cleanComment = comment => String(comment ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT);

// '' or null: no count. Otherwise a whole number from 0 to 999.
function cleanCount(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > MAX_COUNT) throw new Error(`${label} must be a whole number from 0 to ${MAX_COUNT}.`);
  return number;
}

// current without max is a plain counter; max without current starts full.
function cleanCounts(current, max) {
  const top = cleanCount(max, 'The maximum');
  let left = cleanCount(current, 'The count');
  if (left === null && top !== null) left = top;
  if (top !== null && left > top) left = top;
  return { current: left, max: top };
}

const toView = row => ({
  id: row.id,
  characterId: row.character_id,
  npcId: row.npc_id,
  combatantId: row.combatant_id,
  name: row.name,
  comment: row.comment,
  current: row.current,
  max: row.max
});

// For the table: every tracker of the adventure, for its DM and the Root DM.
function trackersForTable({ adventureId, secret }) {
  if (!secret) return [];
  return db.prepare('SELECT * FROM adventure_trackers WHERE adventure_id = ? ORDER BY id').all(Number(adventureId)).map(toView);
}

function openAdventure(adventureId, user) {
  const adventure = adventures().loadAdventureRow(adventureId);
  adventures().requireAdventureSecret(adventure, user);
  return adventure;
}

function loadTracker(adventure, trackerId) {
  const tracker = db.prepare('SELECT * FROM adventure_trackers WHERE id = ? AND adventure_id = ?').get(Number(trackerId), adventure.id);
  if (!tracker) throw new Error('That resource is not on this table.');
  return tracker;
}

// { characterId } (in the party), { npcId } (on the table or in an encounter)
// or { combatantId } (a monster in an encounter), name, comment, current, max.
// An NPC in a fight keeps the NPC's own trackers.
function addTracker({ adventureId, user, characterId, npcId, combatantId, name, comment, current, max }) {
  const adventure = openAdventure(adventureId, user);
  let character = null;
  let npc = null;
  let combatant = null;
  if (combatantId) {
    combatant = db.prepare(`
      SELECT ec.id FROM encounter_combatants ec JOIN encounters e ON e.id = ec.encounter_id
      WHERE ec.id = ? AND e.adventure_id = ? AND ec.character_id IS NULL AND ec.companion_id IS NULL AND ec.npc_id IS NULL
    `).get(Number(combatantId), adventure.id);
    if (!combatant) throw new Error('That monster is not in this adventure.');
  } else if (characterId) {
    character = db.prepare('SELECT character_id FROM adventure_party WHERE adventure_id = ? AND character_id = ?').get(adventure.id, Number(characterId));
    if (!character) throw new Error('That character is not in the party.');
  } else if (npcId) {
    npc = db.prepare(`
      SELECT npc_id FROM adventure_npcs WHERE adventure_id = ? AND npc_id = ?
      UNION SELECT ec.npc_id FROM encounter_combatants ec JOIN encounters e ON e.id = ec.encounter_id WHERE e.adventure_id = ? AND ec.npc_id = ?
    `).get(adventure.id, Number(npcId), adventure.id, Number(npcId));
    if (!npc) throw new Error('That NPC is not in this adventure.');
  } else {
    throw new Error('Choose a character, an NPC or a monster to track a resource for.');
  }
  const counts = cleanCounts(current, max);
  db.prepare(`
    INSERT INTO adventure_trackers (adventure_id, character_id, npc_id, combatant_id, name, comment, current, max) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(adventure.id, character ? character.character_id : null, npc ? npc.npc_id : null, combatant ? combatant.id : null,
    cleanName(name), cleanComment(comment), counts.current, counts.max);
  return adventures().getAdventureTable({ adventureId: adventure.id, user });
}

// Changes what's given: name, comment, current, max; or step (+1 / −1) the count.
function updateTracker({ adventureId, user, trackerId, changes = {} }) {
  const adventure = openAdventure(adventureId, user);
  const tracker = loadTracker(adventure, trackerId);
  const next = { name: tracker.name, comment: tracker.comment, current: tracker.current, max: tracker.max };
  if (changes.name !== undefined) next.name = cleanName(changes.name);
  if (changes.comment !== undefined) next.comment = cleanComment(changes.comment);
  if (changes.current !== undefined || changes.max !== undefined) {
    Object.assign(next, cleanCounts(
      changes.current !== undefined ? changes.current : tracker.current,
      changes.max !== undefined ? changes.max : tracker.max
    ));
  }
  if (changes.step !== undefined) {
    const step = Number(changes.step);
    if (step !== 1 && step !== -1) throw new Error('Step the count by 1 or −1.');
    const top = next.max === null ? MAX_COUNT : next.max;
    next.current = Math.max(0, Math.min(top, (next.current ?? 0) + step));
  }
  db.prepare('UPDATE adventure_trackers SET name = ?, comment = ?, current = ?, max = ? WHERE id = ?')
    .run(next.name, next.comment, next.current, next.max, tracker.id);
  return adventures().getAdventureTable({ adventureId: adventure.id, user });
}

function deleteTracker({ adventureId, user, trackerId }) {
  const adventure = openAdventure(adventureId, user);
  const tracker = loadTracker(adventure, trackerId);
  db.prepare('DELETE FROM adventure_trackers WHERE id = ?').run(tracker.id);
  return adventures().getAdventureTable({ adventureId: adventure.id, user });
}

module.exports = { trackersForTable, addTracker, updateTracker, deleteTracker };
