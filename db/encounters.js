// db/encounters.js — Encounters the DM prepares for an adventure: monsters
// from the catalog (rules/monsters.js), one row per creature with its own HP,
// and Notable NPCs (their HP stays on the NPC). Planned encounters are the
// DM's secret (the adventure's DM and the Root DM); when the DM runs one, the
// party sees who is in the fight and how hurt they look, never the numbers.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { npcCondition } = require('./npcs');

// db/activeAdventures.js uses this module for the table; required late.
const adventures = () => require('./activeAdventures');

const MAX_NAME = 100;
const MAX_NOTES = 2000;
const MAX_COMBATANTS = 60;
const MODES = ['normal', 'advantage', 'disadvantage'];

function readAbilities(json) {
  try {
    const data = JSON.parse(json || '{}') || {};
    return Object.fromEntries(Object.entries(data).filter(([, score]) => Number.isInteger(score)));
  } catch {
    return {};
  }
}

// The adventure, if this user may change its secrets (and it is running).
function secretAdventure(adventureId, user) {
  const { loadAdventureRow, requireAdventureSecret } = adventures();
  const adventure = loadAdventureRow(adventureId);
  requireAdventureSecret(adventure, user);
  return adventure;
}

function loadEncounter(adventure, encounterId) {
  const encounter = db.prepare('SELECT * FROM encounters WHERE id = ? AND adventure_id = ?').get(Number(encounterId), adventure.id);
  if (!encounter) throw new Error('Encounter not found.');
  return encounter;
}

const COMBATANT_QUERY = `
  SELECT ec.*, n.name AS npc_name, n.hp_max AS npc_hp_max, n.hp_current AS npc_hp_current, n.hp_temp AS npc_hp_temp,
    n.armor_class AS npc_ac, n.abilities AS npc_abilities, n.base_monster AS npc_base, n.portrait_file AS npc_portrait
  FROM encounter_combatants ec LEFT JOIN npcs n ON n.id = ec.npc_id
`;

function loadCombatant(adventure, combatantId) {
  const row = db.prepare(`${COMBATANT_QUERY} JOIN encounters e ON e.id = ec.encounter_id WHERE ec.id = ? AND e.adventure_id = ?`)
    .get(Number(combatantId), adventure.id);
  if (!row) throw new Error('That creature is not in this adventure.');
  return row;
}

// What a combatant rolls with: its monster, the NPC's base statblock, or the NPC's scores.
function rollSource(row) {
  if (row.monster_name) return rules.getMonster(row.monster_name);
  const base = row.npc_base ? rules.getMonster(row.npc_base) : null;
  return base || { abilities: readAbilities(row.npc_abilities) };
}

function hpOf(row) {
  return row.npc_id
    ? { max: row.npc_hp_max, current: row.npc_hp_current, temp: row.npc_hp_temp || 0 }
    : { max: row.hp_max, current: row.hp_current, temp: row.hp_temp || 0 };
}

// counts: how many of each monster are in the encounter (to number them).
function combatantView(row, counts, secret) {
  const monster = row.monster_name ? rules.getMonster(row.monster_name) : null;
  const label = row.npc_id
    ? row.npc_name
    : (counts[row.monster_name] > 1 ? `${row.monster_name} ${row.number}` : row.monster_name);
  const hp = hpOf(row);
  const condition = npcCondition({ hp_max: hp.max, hp_current: hp.current });
  const view = { id: row.id, kind: row.npc_id ? 'npc' : 'monster', label, condition, npcId: row.npc_id || null };
  if (!secret) return view;
  const source = rollSource(row);
  const base = row.npc_id ? (row.npc_base ? rules.getMonster(row.npc_base) : null) : monster;
  const dex = (source && source.abilities && source.abilities.dex) || 10;
  return {
    ...view,
    monster: row.monster_name || row.npc_base || null,
    statblockFound: Boolean(base),
    armorClass: row.npc_id ? row.npc_ac : (monster ? monster.armorClass : null),
    hpMax: hp.max,
    hpCurrent: Number.isInteger(hp.current) ? hp.current : hp.max,
    hpTemp: hp.temp,
    initiative: row.initiative,
    initiativeBonus: base && Number.isInteger(base.initiative) ? base.initiative : rules.abilityModifier(dex),
    xp: base ? base.xp : 0,
    crText: base ? base.crText : null
  };
}

// Running: initiative order (highest first, unrolled last); otherwise as added.
function sortCombatants(list, running) {
  if (!running) return list;
  return [...list].sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) || a.id - b.id);
}

function encounterView(encounter, rows, secret, budget) {
  const counts = {};
  rows.forEach(row => { if (row.monster_name) counts[row.monster_name] = (counts[row.monster_name] || 0) + 1; });
  const running = encounter.status === 'running';
  const combatants = sortCombatants(rows.map(row => ({ ...combatantView(row, counts, secret), initiative: row.initiative })), running);
  if (!secret) {
    // The party: who is in the fight, in turn order, and how they look.
    return { id: encounter.id, name: encounter.name, status: encounter.status, combatants: combatants.map(({ initiative, ...rest }) => rest) };
  }
  const xp = combatants.reduce((sum, combatant) => sum + (combatant.xp || 0), 0);
  return {
    id: encounter.id,
    name: encounter.name,
    notes: encounter.notes,
    status: encounter.status,
    startedAt: encounter.started_at,
    endedAt: encounter.ended_at,
    combatants,
    xp,
    difficulty: rules.encounterDifficulty(xp, budget),
    // NPCs without a statblock count no XP.
    npcsWithoutXp: combatants.filter(combatant => combatant.kind === 'npc' && !combatant.xp).length
  };
}

// A statblock for the table, with its dice ([{ id, label, formula, kind }]).
function statblockWithRolls(monster) {
  return { ...monster, rolls: [...rules.creatureRollOptions(monster).values()] };
}

// The encounters part of the adventure table. secret: the adventure's DM
// (everything, with the XP budget for the party and the running fight's
// statblocks); otherwise only the running encounter as the party sees it.
function encountersForTable({ adventureId, secret, manage, partyLevels }) {
  const encounters = db.prepare("SELECT * FROM encounters WHERE adventure_id = ? ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, id")
    .all(Number(adventureId));
  const ids = encounters.map(encounter => encounter.id);
  const rows = ids.length
    ? db.prepare(`${COMBATANT_QUERY} WHERE ec.encounter_id IN (${ids.map(() => '?').join(',')}) ORDER BY ec.id`).all(...ids)
    : [];
  const byEncounter = id => rows.filter(row => row.encounter_id === id);
  const runningRow = encounters.find(encounter => encounter.status === 'running');
  if (!secret) {
    return {
      running: runningRow ? encounterView(runningRow, byEncounter(runningRow.id), false) : null,
      // Other DMs only learn that something is prepared.
      prepared: manage ? encounters.filter(encounter => encounter.status === 'planned').length : 0
    };
  }
  const budget = rules.encounterBudget(partyLevels);
  const statblocks = {};
  if (runningRow) {
    for (const row of byEncounter(runningRow.id)) {
      const name = row.monster_name || row.npc_base;
      const monster = name && !statblocks[name] ? rules.getMonster(name) : null;
      if (monster) statblocks[name] = statblockWithRolls(monster);
    }
  }
  return {
    budget,
    partyLevels,
    list: encounters.map(encounter => encounterView(encounter, byEncounter(encounter.id), true, budget)),
    statblocks
  };
}

const table = (adventure, user) => adventures().getAdventureTable({ adventureId: adventure.id, user });

function cleanName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Give the encounter a name.');
  if (name.length > MAX_NAME) throw new Error(`Encounter names can be ${MAX_NAME} characters at most.`);
  return name;
}

function createEncounter({ adventureId, user, name }) {
  const adventure = secretAdventure(adventureId, user);
  db.prepare('INSERT INTO encounters (adventure_id, name) VALUES (?, ?)').run(adventure.id, cleanName(name));
  return table(adventure, user);
}

function updateEncounter({ adventureId, user, encounterId, name, notes }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = loadEncounter(adventure, encounterId);
  const text = notes === undefined ? encounter.notes : String(notes || '').slice(0, MAX_NOTES);
  db.prepare('UPDATE encounters SET name = ?, notes = ? WHERE id = ?')
    .run(name === undefined ? encounter.name : cleanName(name), text, encounter.id);
  return table(adventure, user);
}

function deleteEncounter({ adventureId, user, encounterId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = loadEncounter(adventure, encounterId);
  db.prepare('DELETE FROM encounters WHERE id = ?').run(encounter.id);
  return table(adventure, user);
}

function openEncounter(adventure, encounterId) {
  const encounter = loadEncounter(adventure, encounterId);
  if (encounter.status === 'done') throw new Error(`"${encounter.name}" is over.`);
  return encounter;
}

function roomFor(encounter, count) {
  const size = db.prepare('SELECT COUNT(*) AS n FROM encounter_combatants WHERE encounter_id = ?').get(encounter.id).n;
  if (size + count > MAX_COMBATANTS) throw new Error(`An encounter holds ${MAX_COMBATANTS} creatures at most.`);
}

// { monster, count }: that many of a catalog monster, each with full HP.
function addEncounterMonster({ adventureId, user, encounterId, monster: name, count = 1 }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = openEncounter(adventure, encounterId);
  const monster = rules.getMonster(String(name || '').trim());
  if (!monster) throw new Error(`There is no monster called "${name}" in the catalog.`);
  if (monster.summon || !Number.isInteger(monster.hitPoints)) throw new Error(`${monster.name} is a summoned creature; its numbers depend on the spell.`);
  const many = Number(count);
  if (!Number.isInteger(many) || many < 1 || many > 20) throw new Error('Add from 1 to 20 at a time.');
  roomFor(encounter, many);
  db.transaction(() => {
    let number = db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM encounter_combatants WHERE encounter_id = ? AND monster_name = ?').get(encounter.id, monster.name).n;
    const insert = db.prepare('INSERT INTO encounter_combatants (encounter_id, monster_name, number, hp_max, hp_current) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < many; i += 1) {
      number += 1;
      insert.run(encounter.id, monster.name, number, monster.hitPoints, monster.hitPoints);
    }
  })();
  return table(adventure, user);
}

function addEncounterNpc({ adventureId, user, encounterId, npcId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = openEncounter(adventure, encounterId);
  const npc = db.prepare('SELECT id, name FROM npcs WHERE id = ?').get(Number(npcId));
  if (!npc) throw new Error('NPC not found.');
  if (db.prepare('SELECT 1 FROM encounter_combatants WHERE encounter_id = ? AND npc_id = ?').get(encounter.id, npc.id)) {
    throw new Error(`${npc.name} is already in this encounter.`);
  }
  roomFor(encounter, 1);
  db.prepare('INSERT INTO encounter_combatants (encounter_id, npc_id) VALUES (?, ?)').run(encounter.id, npc.id);
  // Joining a running fight puts the NPC on the table.
  if (encounter.status === 'running') revealNpcs(adventure, [npc.id]);
  return table(adventure, user);
}

function removeCombatant({ adventureId, user, combatantId }) {
  const adventure = secretAdventure(adventureId, user);
  const row = loadCombatant(adventure, combatantId);
  db.prepare('DELETE FROM encounter_combatants WHERE id = ?').run(row.id);
  return table(adventure, user);
}

function revealNpcs(adventure, npcIds) {
  const add = db.prepare('INSERT OR IGNORE INTO adventure_npcs (adventure_id, npc_id) VALUES (?, ?)');
  const show = db.prepare('UPDATE adventure_npcs SET hidden = 0 WHERE adventure_id = ? AND npc_id = ? AND hidden = 1');
  npcIds.forEach(npcId => { add.run(adventure.id, npcId); show.run(adventure.id, npcId); });
}

// The fight starts: the party sees it, and its NPCs join the table.
function runEncounter({ adventureId, user, encounterId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = loadEncounter(adventure, encounterId);
  if (encounter.status !== 'planned') throw new Error(`"${encounter.name}" has already been run.`);
  const running = db.prepare("SELECT name FROM encounters WHERE adventure_id = ? AND status = 'running'").get(adventure.id);
  if (running) throw new Error(`End "${running.name}" first.`);
  const npcIds = db.prepare('SELECT npc_id FROM encounter_combatants WHERE encounter_id = ? AND npc_id IS NOT NULL').all(encounter.id).map(row => row.npc_id);
  if (!npcIds.length && !db.prepare('SELECT 1 FROM encounter_combatants WHERE encounter_id = ?').get(encounter.id)) {
    throw new Error('Add some monsters or NPCs to the encounter first.');
  }
  db.transaction(() => {
    db.prepare("UPDATE encounters SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(encounter.id);
    revealNpcs(adventure, npcIds);
  })();
  return table(adventure, user);
}

function endEncounter({ adventureId, user, encounterId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = loadEncounter(adventure, encounterId);
  if (encounter.status !== 'running') throw new Error(`"${encounter.name}" is not running.`);
  db.prepare("UPDATE encounters SET status = 'done', ended_at = CURRENT_TIMESTAMP WHERE id = ?").run(encounter.id);
  return table(adventure, user);
}

// initiative: a number, or null/'' to clear it.
function setCombatantInitiative({ adventureId, user, combatantId, initiative }) {
  const adventure = secretAdventure(adventureId, user);
  const row = loadCombatant(adventure, combatantId);
  const empty = initiative === null || initiative === undefined || String(initiative).trim() === '';
  const value = empty ? null : Number(initiative);
  if (!empty && (!Number.isInteger(value) || value < -10 || value > 50)) throw new Error('Initiative must be a whole number from -10 to 50.');
  db.prepare('UPDATE encounter_combatants SET initiative = ? WHERE id = ?').run(value, row.id);
  return table(adventure, user);
}

// Rolls initiative for every creature in the encounter that has none yet.
function rollEncounterInitiative({ adventureId, user, encounterId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = openEncounter(adventure, encounterId);
  const rows = db.prepare(`${COMBATANT_QUERY} WHERE ec.encounter_id = ? AND ec.initiative IS NULL`).all(encounter.id);
  const update = db.prepare('UPDATE encounter_combatants SET initiative = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of rows) {
      const option = rules.creatureRollOptions(rollSource(row) || { abilities: {} }).get('initiative');
      update.run(rules.rollFormula(option.formula).total, row.id);
    }
  })();
  return table(adventure, user);
}

// Damage takes temporary HP first; HP never go below 0 or above the maximum.
function applyHp({ max, current, temp }, action, value) {
  let hp = Number.isInteger(current) ? current : max;
  let extra = temp || 0;
  if (action === 'damage') {
    const absorbed = Math.min(extra, value);
    extra -= absorbed;
    hp = Math.max(0, hp - (value - absorbed));
  } else if (action === 'heal') {
    hp = Math.min(max, hp + value);
  } else if (action === 'tempHp') {
    extra = Math.max(extra, value);
  } else {
    throw new Error('Unknown action.');
  }
  return { current: hp, temp: extra };
}

function changeCombatantHp({ adventureId, user, combatantId, action, amount }) {
  const adventure = secretAdventure(adventureId, user);
  const row = loadCombatant(adventure, combatantId);
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error('Enter a whole number from 0 to 10000.');
  const hp = hpOf(row);
  if (!Number.isInteger(hp.max)) throw new Error(`${row.npc_name || row.monster_name} has no Hit Points set.`);
  const next = applyHp(hp, action, value);
  if (row.npc_id) db.prepare('UPDATE npcs SET hp_current = ?, hp_temp = ? WHERE id = ?').run(next.current, next.temp, row.npc_id);
  else db.prepare('UPDATE encounter_combatants SET hp_current = ?, hp_temp = ? WHERE id = ?').run(next.current, next.temp, row.id);
  return table(adventure, user);
}

// A roll from a creature's statblock, for the DM only (not logged or shown
// to the party). request: { roll: option id, mode, critical }.
function rollForCombatant({ adventureId, user, combatantId, request = {} }) {
  const adventure = secretAdventure(adventureId, user);
  const row = loadCombatant(adventure, combatantId);
  const source = rollSource(row);
  if (!source) throw new Error(`${row.monster_name} is not in the monster list on this server.`);
  const option = rules.creatureRollOptions(source).get(String(request.roll || ''));
  if (!option) throw new Error('That roll is not on this statblock.');
  const mode = MODES.includes(request.mode) && option.kind !== 'damage' ? request.mode : 'normal';
  const critical = Boolean(request.critical) && option.kind === 'damage';
  const result = rules.rollFormula(option.formula, { mode, critical });
  const rows = db.prepare('SELECT monster_name FROM encounter_combatants WHERE encounter_id = ? AND monster_name = ?').all(row.encounter_id, row.monster_name || '');
  const name = row.npc_id ? row.npc_name : (rows.length > 1 ? `${row.monster_name} ${row.number}` : row.monster_name);
  return {
    roll: {
      combatant: name,
      label: critical ? `${option.label} — critical` : option.label,
      formula: result.formula,
      mode,
      total: result.total,
      natural: result.natural,
      text: rules.describeRoll(result)
    }
  };
}

module.exports = {
  encountersForTable,
  createEncounter,
  updateEncounter,
  deleteEncounter,
  addEncounterMonster,
  addEncounterNpc,
  removeCombatant,
  runEncounter,
  endEncounter,
  setCombatantInitiative,
  rollEncounterInitiative,
  changeCombatantHp,
  rollForCombatant
};
