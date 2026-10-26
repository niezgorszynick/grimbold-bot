// db/encounters.js — Encounters the DM prepares for an adventure: monsters
// from the catalog (rules/monsters.js), one row per creature with its own HP,
// Notable NPCs (their HP stays on the NPC) and party members (only their
// initiative here: a character's initiative roll during a running encounter
// lands on it, adding them if the DM had not; players may also leave the
// fight). A running encounter can be paused (kept as it is, out of the party's
// sight) and resumed later. Planned encounters are the
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
  SELECT ec.*, ch.name AS character_name, n.name AS npc_name, n.hp_max AS npc_hp_max, n.hp_current AS npc_hp_current, n.hp_temp AS npc_hp_temp,
    n.armor_class AS npc_ac, n.abilities AS npc_abilities, n.base_monster AS npc_base, n.portrait_file AS npc_portrait
  FROM encounter_combatants ec LEFT JOIN npcs n ON n.id = ec.npc_id LEFT JOIN characters ch ON ch.id = ec.character_id
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
  if (row.character_id) return { max: null, current: null, temp: 0 };
  return row.npc_id
    ? { max: row.npc_hp_max, current: row.npc_hp_current, temp: row.npc_hp_temp || 0 }
    : { max: row.hp_max, current: row.hp_current, temp: row.hp_temp || 0 };
}

// "Goblin 2" when there are several; the NPC's name for an NPC.
function defaultLabel(row, counts) {
  if (row.character_id) return row.character_name;
  if (row.npc_id) return row.npc_name;
  return counts[row.monster_name] > 1 ? `${row.monster_name} ${row.number}` : row.monster_name;
}

// counts: how many of each monster are in the encounter (to number them).
// row.name: the DM's own name for it (e.g. to match a token in Owlbear).
function combatantView(row, counts, secret) {
  const monster = row.monster_name ? rules.getMonster(row.monster_name) : null;
  const label = row.name || defaultLabel(row, counts);
  const hp = hpOf(row);
  const condition = npcCondition({ hp_max: hp.max, hp_current: hp.current });
  const kind = row.character_id ? 'pc' : row.npc_id ? 'npc' : 'monster';
  const view = { id: row.id, kind, label, condition, npcId: row.npc_id || null, characterId: row.character_id || null };
  if (!secret) return view;
  // A party member: their numbers are on their own card at the table.
  if (row.character_id) {
    return { ...view, monster: null, customName: null, defaultLabel: label, statblockFound: false, armorClass: null, hpMax: null, hpCurrent: null, hpTemp: 0, initiative: row.initiative, initiativeBonus: null, xp: 0, crText: null };
  }
  const source = rollSource(row);
  const base = row.npc_id ? (row.npc_base ? rules.getMonster(row.npc_base) : null) : monster;
  const dex = (source && source.abilities && source.abilities.dex) || 10;
  return {
    ...view,
    monster: row.monster_name || row.npc_base || null,
    customName: row.name || null,
    defaultLabel: defaultLabel(row, counts),
    statblockFound: Boolean(base),
    armorClass: row.npc_id ? row.npc_ac : (row.armor_class ?? (monster ? monster.armorClass : null)),
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
  const encounters = db.prepare("SELECT * FROM encounters WHERE adventure_id = ? ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END, id")
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

function partyOf(adventure) {
  return db.prepare('SELECT character_id FROM adventure_party WHERE adventure_id = ?').all(adventure.id).map(row => row.character_id);
}

// { characterId } — one party member, or all of them without: the party joins the fight.
function addEncounterCharacters({ adventureId, user, encounterId, characterId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = openEncounter(adventure, encounterId);
  const party = partyOf(adventure);
  const wanted = characterId === undefined || characterId === null ? party : [Number(characterId)];
  if (!wanted.length) throw new Error('There is no one in the party yet.');
  if (!wanted.every(id => party.includes(id))) throw new Error('Only party members can join the encounter.');
  const already = new Set(db.prepare('SELECT character_id FROM encounter_combatants WHERE encounter_id = ? AND character_id IS NOT NULL').all(encounter.id).map(row => row.character_id));
  const missing = wanted.filter(id => !already.has(id));
  if (!missing.length) throw new Error(characterId ? 'That character is already in this encounter.' : 'The whole party is already in this encounter.');
  roomFor(encounter, missing.length);
  const insert = db.prepare('INSERT INTO encounter_combatants (encounter_id, character_id) VALUES (?, ?)');
  db.transaction(() => missing.forEach(id => insert.run(encounter.id, id)))();
  return table(adventure, user);
}

// A character rolled initiative: it becomes their initiative in each running
// encounter of an adventure they are in (joining it if the DM had not added them).
function recordInitiativeRoll(characterId, total) {
  const encounters = db.prepare(`
    SELECT e.id FROM encounters e JOIN adventures a ON a.id = e.adventure_id
    JOIN adventure_party ap ON ap.adventure_id = a.id AND ap.character_id = ?
    WHERE e.status = 'running' AND a.status = 'active'
  `).all(Number(characterId));
  for (const encounter of encounters) {
    const row = db.prepare('SELECT id FROM encounter_combatants WHERE encounter_id = ? AND character_id = ?').get(encounter.id, Number(characterId));
    if (row) db.prepare('UPDATE encounter_combatants SET initiative = ? WHERE id = ?').run(total, row.id);
    else db.prepare('INSERT INTO encounter_combatants (encounter_id, character_id, initiative) VALUES (?, ?, ?)').run(encounter.id, Number(characterId), total);
  }
  return encounters.length;
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

// Kept as it is (HP, initiative, who is in it) for later; the party stops seeing it.
function pauseEncounter({ adventureId, user, encounterId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = loadEncounter(adventure, encounterId);
  if (encounter.status !== 'running') throw new Error(`"${encounter.name}" is not running.`);
  db.prepare("UPDATE encounters SET status = 'paused' WHERE id = ?").run(encounter.id);
  return table(adventure, user);
}

function resumeEncounter({ adventureId, user, encounterId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = loadEncounter(adventure, encounterId);
  if (encounter.status !== 'paused') throw new Error(`"${encounter.name}" is not paused.`);
  const running = db.prepare("SELECT name FROM encounters WHERE adventure_id = ? AND status = 'running'").get(adventure.id);
  if (running) throw new Error(`Pause or end "${running.name}" first.`);
  const npcIds = db.prepare('SELECT npc_id FROM encounter_combatants WHERE encounter_id = ? AND npc_id IS NOT NULL').all(encounter.id).map(row => row.npc_id);
  db.transaction(() => {
    db.prepare("UPDATE encounters SET status = 'running' WHERE id = ?").run(encounter.id);
    revealNpcs(adventure, npcIds);
  })();
  return table(adventure, user);
}

// A party member leaves the running fight (the player, or the DM). They stay
// in the party; rolling initiative again brings them back.
function leaveEncounter({ adventureId, user, characterId }) {
  const { loadAdventureRow, canSeeAdventureSecrets } = adventures();
  const adventure = loadAdventureRow(adventureId);
  if (adventure.status !== 'active') throw new Error('This adventure is no longer running.');
  const character = db.prepare('SELECT id, name, player_id FROM characters WHERE id = ?').get(Number(characterId));
  if (!character) throw new Error('Character not found.');
  const own = character.player_id === Number(user && user.id);
  if (!own && !canSeeAdventureSecrets(adventure, user)) throw new Error('Forbidden.');
  const removed = db.prepare(`
    DELETE FROM encounter_combatants WHERE character_id = ? AND encounter_id IN
      (SELECT id FROM encounters WHERE adventure_id = ? AND status = 'running')
  `).run(character.id, adventure.id).changes;
  if (!removed) throw new Error(`${character.name} is not in the fight.`);
  return table(adventure, user);
}

function endEncounter({ adventureId, user, encounterId }) {
  const adventure = secretAdventure(adventureId, user);
  const encounter = loadEncounter(adventure, encounterId);
  if (encounter.status !== 'running' && encounter.status !== 'paused') throw new Error(`"${encounter.name}" is not running.`);
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
  // Party members roll their own (on their sheet or the table).
  const rows = db.prepare(`${COMBATANT_QUERY} WHERE ec.encounter_id = ? AND ec.initiative IS NULL AND ec.character_id IS NULL`).all(encounter.id);
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
  if (row.character_id) throw new Error(`Change ${row.character_name}'s HP on their card.`);
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error('Enter a whole number from 0 to 10000.');
  const hp = hpOf(row);
  if (!Number.isInteger(hp.max)) throw new Error(`${row.npc_name || row.monster_name} has no Hit Points set.`);
  const next = applyHp(hp, action, value);
  if (row.npc_id) db.prepare('UPDATE npcs SET hp_current = ?, hp_temp = ? WHERE id = ?').run(next.current, next.temp, row.npc_id);
  else db.prepare('UPDATE encounter_combatants SET hp_current = ?, hp_temp = ? WHERE id = ?').run(next.current, next.temp, row.id);
  return table(adventure, user);
}

function optionalNumber(value, min, max, label) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return number;
}

// The DM changes a creature: { name, armorClass, hpMax, hpCurrent }, each
// optional; an empty name or AC goes back to the statblock's. A monster keeps
// its numbers here; an NPC's AC and HP are the NPC's own, so they change on
// the NPC too.
function updateCombatant({ adventureId, user, combatantId, name, armorClass, hpMax, hpCurrent }) {
  const adventure = secretAdventure(adventureId, user);
  const row = loadCombatant(adventure, combatantId);
  const encounter = loadEncounter(adventure, row.encounter_id);
  if (encounter.status === 'done') throw new Error(`"${encounter.name}" is over.`);
  if (row.character_id) throw new Error(`Change ${row.character_name} on their character sheet.`);
  const newName = name === undefined ? row.name : (String(name || '').replace(/\s+/g, ' ').trim() || null);
  if (newName && newName.length > MAX_NAME) throw new Error(`Names can be ${MAX_NAME} characters at most.`);
  const ac = optionalNumber(armorClass, 0, 40, 'AC');
  const max = optionalNumber(hpMax, 1, 5000, 'Max HP');
  const current = optionalNumber(hpCurrent, 0, 5000, 'Current HP');
  if (max === null) throw new Error('Max HP must be a whole number from 1 to 5000.');
  const hp = hpOf(row);
  const nextMax = max === undefined ? hp.max : max;
  // A creature at full HP stays at full HP when its maximum changes.
  let nextCurrent = current === undefined || current === null
    ? (Number.isInteger(hp.current) && hp.current !== hp.max ? hp.current : nextMax)
    : current;
  if (Number.isInteger(nextMax) && Number.isInteger(nextCurrent)) nextCurrent = Math.min(nextCurrent, nextMax);
  db.transaction(() => {
    if (row.npc_id) {
      db.prepare('UPDATE encounter_combatants SET name = ? WHERE id = ?').run(newName, row.id);
      db.prepare('UPDATE npcs SET armor_class = ?, hp_max = ?, hp_current = ? WHERE id = ?')
        .run(ac === undefined ? row.npc_ac : ac, nextMax, nextCurrent, row.npc_id);
    } else {
      db.prepare('UPDATE encounter_combatants SET name = ?, armor_class = ?, hp_max = ?, hp_current = ? WHERE id = ?')
        .run(newName, ac === undefined ? row.armor_class : ac, nextMax, nextCurrent, row.id);
    }
  })();
  return table(adventure, user);
}

// A roll from a creature's statblock, for the DM only (not logged or shown
// to the party). request: { roll: option id, mode, critical }.
function rollForCombatant({ adventureId, user, combatantId, request = {} }) {
  const adventure = secretAdventure(adventureId, user);
  const row = loadCombatant(adventure, combatantId);
  if (row.character_id) throw new Error(`${row.character_name} rolls on their own sheet.`);
  const source = rollSource(row);
  if (!source) throw new Error(`${row.monster_name} is not in the monster list on this server.`);
  const option = rules.creatureRollOptions(source).get(String(request.roll || ''));
  if (!option) throw new Error('That roll is not on this statblock.');
  const mode = MODES.includes(request.mode) && option.kind !== 'damage' ? request.mode : 'normal';
  const critical = Boolean(request.critical) && option.kind === 'damage';
  const result = rules.rollFormula(option.formula, { mode, critical });
  const count = db.prepare('SELECT COUNT(*) AS n FROM encounter_combatants WHERE encounter_id = ? AND monster_name = ?').get(row.encounter_id, row.monster_name || '').n;
  const name = row.name || defaultLabel(row, { [row.monster_name]: count });
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

// The running encounters of the adventures this key's player is the DM of,
// for the Owlbear extension to put into the initiative tracker: names and
// initiative only.
function getVttEncounters({ key }) {
  const player = require('./dice').vttPlayerForKey(key);
  const rows = db.prepare(`
    SELECT e.*, a.title AS adventure_title FROM encounters e JOIN adventures a ON a.id = e.adventure_id
    WHERE e.status = 'running' AND a.status = 'active' AND a.dm_player_id = ? ORDER BY e.started_at
  `).all(player.player_id);
  return {
    player: player.discord_tag,
    encounters: rows.map(encounter => {
      const view = encounterView(encounter, db.prepare(`${COMBATANT_QUERY} WHERE ec.encounter_id = ? ORDER BY ec.id`).all(encounter.id), true, { low: 0, moderate: 0, high: 0 });
      return {
        id: encounter.id,
        adventure: encounter.adventure_title,
        name: encounter.name,
        combatants: view.combatants.map(combatant => ({
          id: combatant.id,
          label: combatant.label,
          // "Goblin Warrior" for "Goblin Warrior 2": tokens are often named after the monster.
          // A character's token may carry only their first name.
          baseName: combatant.kind === 'pc' ? combatant.label.split(' ')[0]
            : combatant.kind === 'monster' && !combatant.customName ? combatant.label.replace(/ \d+$/, '') : combatant.label,
          kind: combatant.kind,
          initiative: combatant.initiative ?? null,
          down: combatant.hpCurrent === 0
        }))
      };
    })
  };
}

// Where a DM can add a monster from the Monsters tab: the running adventures
// whose secrets they hold (their own, or all for the Root DM), each with its
// encounters that aren't over.
function listEncounterTargets(user) {
  const { getActiveAdventures, canSeeAdventureSecrets } = adventures();
  return getActiveAdventures()
    .filter(adventure => canSeeAdventureSecrets(adventure, user))
    .map(adventure => ({
      id: adventure.id,
      title: adventure.title,
      dm: adventure.dm_name || null,
      encounters: db.prepare(`
        SELECT id, name, status FROM encounters WHERE adventure_id = ? AND status != 'done'
        ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, id
      `).all(adventure.id)
    }));
}

module.exports = {
  listEncounterTargets,
  getVttEncounters,
  encountersForTable,
  createEncounter,
  updateEncounter,
  deleteEncounter,
  addEncounterMonster,
  addEncounterNpc,
  removeCombatant,
  updateCombatant,
  addEncounterCharacters,
  recordInitiativeRoll,
  runEncounter,
  endEncounter,
  pauseEncounter,
  resumeEncounter,
  leaveEncounter,
  setCombatantInitiative,
  rollEncounterInitiative,
  changeCombatantHp,
  rollForCombatant
};
