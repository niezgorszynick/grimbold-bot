// db/familiars.js — A character's familiar (rules/familiars.js), kept in the
// companions table (kind 'familiar'): its form, name, Celestial / Fey /
// Fiend, its own Hit Points, and whether it is here, dismissed to its pocket
// dimension, or gone (0 HP, or dismissed forever) until Find Familiar is
// cast again. Used by the sheet's familiar card, the dice (db/dice.js), the
// adventure table (db/roster.js) and the fights (db/encounters.js).
//
// Casting Find Familiar (action 'summon') doesn't spend a spell slot here:
// the hour-long ritual or the free cast is the player's to note.
//
// A pet (kind 'pet') is a companion for show, given by an admin: a name, what
// creature it is (form, free text: "Ostrich") and a description (options).
// No stat block, no HP, never in a fight. One per character, beside a familiar.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { getCharacterClasses } = require('./characters');

const KIND = 'familiar';
const MAX_NAME = 60;
const STATUSES = ['active', 'dismissed', 'gone'];
// What the DM of an adventure the character is in may do from the table.
const DM_ACTIONS = ['damage', 'heal', 'tempHp', 'setHp', 'dismiss', 'recall'];
const OWNER_ACTIONS = ['summon', 'update', 'dismiss', 'recall', 'release', 'damage', 'heal', 'tempHp', 'setHp'];
const ADMIN_ACTIONS = ['grant', 'anyForm', 'setPet', 'removePet'];
const PET = 'pet';
const MAX_PET_TEXT = 500;

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readOptions(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function classesOf(character) {
  const rows = getCharacterClasses(character.id);
  return rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
}

function companionRow(characterId) {
  return db.prepare('SELECT * FROM companions WHERE character_id = ? AND kind = ?').get(Number(characterId), KIND) || null;
}

function ensureRow(characterId) {
  db.prepare('INSERT OR IGNORE INTO companions (character_id, kind) VALUES (?, ?)').run(Number(characterId), KIND);
  return companionRow(characterId);
}

// Everything about the character's familiar. null when they can't have one.
// character: a characters row; sheetData: its parsed sheet.
function familiarState(character, sheetData = readSheet(character.sheet_data)) {
  const row = companionRow(character.id);
  const status = rules.familiarRules({ classes: classesOf(character), species: character.race, sheetData }, { dmGranted: Boolean(row && row.dm_granted) });
  if (!status) return null;
  const options = rules.cleanFamiliarOptions(readOptions(row && row.options), status);
  const form = row && row.form ? row.form : null;
  const block = form ? rules.familiarBlock(form, status, { name: row.name, creatureType: row.creature_type, options }) : null;
  const hpMax = block ? block.hpMax : null;
  const hpCurrent = block ? Math.min(hpMax, Number.isInteger(row.hp_current) ? row.hp_current : hpMax) : null;
  return {
    id: row ? row.id : null,
    rules: status,
    form,
    name: (row && row.name) || form,
    creatureType: block ? block.creatureType : (row && row.creature_type) || null,
    options,
    status: row && STATUSES.includes(row.status) && form ? row.status : 'gone',
    dmGranted: Boolean(row && row.dm_granted),
    anyForm: Boolean(row && row.any_form),
    hp: block ? { current: hpCurrent, max: hpMax, temp: row.hp_temp || 0 } : null,
    block,
    missing: Boolean(form && !block)
  };
}

// The familiar when it is here (not dismissed or gone), else null.
function activeFamiliar(character, sheetData) {
  const state = familiarState(character, sheetData);
  return state && state.status === 'active' && state.block ? state : null;
}

function loadCharacter(id) {
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(id));
  if (!character) throw new Error('Character not found.');
  return character;
}

// The DM of a running adventure this character is in.
function isAdventureDm(character, user) {
  return Boolean(db.prepare(`
    SELECT 1 FROM adventure_party ap JOIN adventures a ON a.id = ap.adventure_id
    WHERE ap.character_id = ? AND a.status = 'active' AND a.dm_player_id = ?
  `).get(character.id, Number(user && user.id)));
}

// The character's pet, or null: { name, creature, description }.
function petOf(characterId) {
  const row = db.prepare('SELECT * FROM companions WHERE character_id = ? AND kind = ?').get(Number(characterId), PET);
  if (!row) return null;
  return { id: row.id, name: row.name || row.form, creature: row.form || '', description: readOptions(row.options).description || '' };
}

function view(character, user) {
  const sheetData = readSheet(character.sheet_data);
  const state = familiarState(character, sheetData);
  const isAdmin = Boolean(user && user.role === 'admin');
  const row = companionRow(character.id);
  const pet = petOf(character.id);
  if (!state) {
    // The DM can still grant one.
    return { available: false, canGrant: isAdmin, dmGranted: Boolean(row && row.dm_granted), pet };
  }
  return {
    available: true,
    pet,
    ...state,
    canGrant: isAdmin,
    canEdit: isAdmin || character.player_id === Number(user && user.id),
    forms: rules.familiarForms(state.rules, { anyForm: state.anyForm }),
    types: state.rules.wildCompanionOnly ? ['Fey'] : rules.FAMILIAR_TYPES,
    elementalTypes: state.rules.elemental ? rules.ELEMENTAL_TYPES : [],
    otherworldlyTypes: state.rules.otherworldly ? rules.OTHERWORLDLY_TYPES : [],
    chainMasterMoves: state.rules.chainMaster ? rules.CHAIN_MASTER_MOVES : []
  };
}

function getCharacterFamiliar({ id, user }) {
  const character = loadCharacter(id);
  const own = character.player_id === Number(user && user.id);
  if (!own && !(user && user.role === 'admin') && !isAdventureDm(character, user)) throw new Error('Forbidden.');
  return view(character, user);
}

function cleanName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME) throw new Error(`A familiar's name can be ${MAX_NAME} characters at most.`);
  return name || null;
}

function amountOf(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > 1000) throw new Error('Enter a whole number from 0 to 1000.');
  return amount;
}

// Damage takes temporary HP first; HP stay between 0 and the maximum. At 0
// the familiar disappears until Find Familiar is cast again.
function changeHp(state, action, amount) {
  const { current, max, temp } = state.hp;
  if (action === 'damage') {
    const absorbed = Math.min(temp, amount);
    const hp = Math.max(0, current - (amount - absorbed));
    return { hp_current: hp, hp_temp: temp - absorbed, status: hp === 0 ? 'gone' : state.status };
  }
  if (action === 'heal') return { hp_current: Math.min(max, current + amount), hp_temp: temp };
  if (action === 'tempHp') return { hp_current: current, hp_temp: Math.max(temp, amount) };
  // setHp
  const hp = Math.min(max, amount);
  return { hp_current: hp, hp_temp: temp, status: hp === 0 ? 'gone' : state.status };
}

function update(rowId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE companions SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...keys.map(key => fields[key]), rowId);
}

// change: { action, ... }:
//   summon { form, name, creatureType, options }: cast Find Familiar (a new
//     form, or the same one back at full HP); update { name, options };
//   dismiss / recall (the pocket dimension), release (dismissed forever);
//   damage / heal / tempHp / setHp { amount };
//   grant { on }, anyForm { on }: admins only.
// Returns { familiar: view, events: [...] }.
function changeCharacterFamiliar({ id, user, change = {} }) {
  return db.transaction(() => {
    const character = loadCharacter(id);
    const action = String(change.action || '');
    const isAdmin = Boolean(user && user.role === 'admin');
    const own = character.player_id === Number(user && user.id);
    const allowed = (isAdmin && [...OWNER_ACTIONS, ...ADMIN_ACTIONS].includes(action)) ||
      (own && OWNER_ACTIONS.includes(action)) ||
      (DM_ACTIONS.includes(action) && isAdventureDm(character, user));
    if (![...OWNER_ACTIONS, ...ADMIN_ACTIONS].includes(action)) throw new Error('Unknown familiar action.');
    if (!allowed) throw new Error('Forbidden.');

    const events = [];
    // A pet: set (name, creature, description) or removed. Admins only.
    if (action === 'setPet') {
      const name = cleanName(change.name);
      const creature = cleanName(change.creature);
      if (!name && !creature) throw new Error('Give the pet a name or say what creature it is.');
      const description = String(change.description || '').trim().slice(0, MAX_PET_TEXT);
      db.prepare('INSERT OR IGNORE INTO companions (character_id, kind, status) VALUES (?, ?, ?)').run(character.id, PET, 'active');
      db.prepare("UPDATE companions SET name = ?, form = ?, options = ?, updated_at = CURRENT_TIMESTAMP WHERE character_id = ? AND kind = ?")
        .run(name, creature, JSON.stringify({ description }), character.id, PET);
      return { familiar: view(character, user), events: ['petSet'] };
    }
    if (action === 'removePet') {
      db.prepare('DELETE FROM companions WHERE character_id = ? AND kind = ?').run(character.id, PET);
      return { familiar: view(character, user), events: ['petRemoved'] };
    }
    const row = ensureRow(character.id);
    if (action === 'grant' || action === 'anyForm') {
      update(row.id, action === 'grant' ? { dm_granted: change.on ? 1 : 0 } : { any_form: change.on ? 1 : 0 });
      return { familiar: view(character, user), events };
    }

    const sheetData = readSheet(character.sheet_data);
    const state = familiarState(character, sheetData);
    if (!state) throw new Error(`${character.name} has no way to cast Find Familiar.`);

    if (action === 'summon') {
      const form = String(change.form || state.form || '').trim();
      if (!form) throw new Error('Choose a form for the familiar.');
      const problem = rules.familiarFormProblem(form, state.rules, { anyForm: state.anyForm });
      if (problem) throw new Error(problem);
      const creatureType = state.rules.wildCompanionOnly ? 'Fey' : String(change.creatureType || state.creatureType || 'Fey');
      if (!rules.FAMILIAR_TYPES.includes(creatureType)) throw new Error('A familiar is a Celestial, Fey or Fiend.');
      const options = rules.cleanFamiliarOptions({ ...state.options, ...(change.options || {}) }, state.rules);
      const name = change.name === undefined ? row.name : cleanName(change.name);
      const block = rules.familiarBlock(form, state.rules, { name, creatureType, options });
      update(row.id, {
        form: block.form, name, creature_type: creatureType, options: JSON.stringify(options),
        hp_current: block.hpMax, hp_temp: 0, status: 'active'
      });
      events.push(state.status === 'active' && state.form !== block.form ? 'reshaped' : 'summoned');
    } else if (action === 'update') {
      const fields = {};
      if (change.name !== undefined) fields.name = cleanName(change.name);
      if (change.options !== undefined) fields.options = JSON.stringify(rules.cleanFamiliarOptions({ ...state.options, ...change.options }, state.rules));
      update(row.id, fields);
    } else {
      if (!state.form) throw new Error('Cast Find Familiar first.');
      if (action === 'dismiss') {
        if (state.status !== 'active') throw new Error(`${state.name} is not here to dismiss.`);
        update(row.id, { status: 'dismissed' });
        events.push('dismissed');
      } else if (action === 'recall') {
        if (state.status !== 'dismissed') throw new Error(state.status === 'gone' ? `${state.name} is gone: cast Find Familiar again.` : `${state.name} is already here.`);
        update(row.id, { status: 'active' });
        events.push('recalled');
      } else if (action === 'release') {
        update(row.id, { status: 'gone' });
        events.push('released');
      } else {
        if (state.status !== 'active') throw new Error(`${state.name} is not here.`);
        const next = changeHp(state, action, amountOf(change.amount));
        update(row.id, next);
        if (next.status === 'gone') events.push('vanished');
      }
    }
    // Gone or dismissed: out of the fights it was in.
    const after = companionRow(character.id);
    if (after.status !== 'active') db.prepare('DELETE FROM encounter_combatants WHERE companion_id = ?').run(after.id);
    return { familiar: view(character, user), events };
  })();
}

// HP changed from a fight's combatant row (db/encounters.js): same rules.
function changeFamiliarHpById(companionId, action, amount) {
  const row = db.prepare('SELECT * FROM companions WHERE id = ?').get(Number(companionId));
  if (!row) throw new Error('That familiar is gone.');
  const character = loadCharacter(row.character_id);
  const state = familiarState(character);
  if (!state || !state.hp) throw new Error('That familiar has no form.');
  const next = changeHp(state, action, amountOf(amount));
  update(row.id, next);
  if (next.status === 'gone') db.prepare('DELETE FROM encounter_combatants WHERE companion_id = ?').run(row.id);
}

// A Long Rest: a familiar from Wild Companion alone leaves.
function familiarAfterLongRest(character) {
  const state = familiarState(character);
  if (!state || !state.rules.wildCompanionOnly || state.status === 'gone') return false;
  update(state.id, { status: 'gone' });
  db.prepare('DELETE FROM encounter_combatants WHERE companion_id = ?').run(state.id);
  return true;
}

// The familiar's statblock and numbers for a fight row, by companion id.
function familiarForCombat(companionId) {
  const row = db.prepare('SELECT * FROM companions WHERE id = ?').get(Number(companionId));
  if (!row) return null;
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(row.character_id);
  if (!character) return null;
  const state = familiarState(character);
  return state && state.block ? { ...state, characterId: character.id, characterName: character.name, playerId: character.player_id } : null;
}

module.exports = {
  petOf,
  familiarState,
  activeFamiliar,
  getCharacterFamiliar,
  changeCharacterFamiliar,
  changeFamiliarHpById,
  familiarAfterLongRest,
  familiarForCombat
};
