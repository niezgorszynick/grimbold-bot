// db/spells.js — Character spells: choosing, preparing and casting, together
// with the spell slot or gold that each change spends, in one transaction.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { formatCp } = require('../currency');
const { getCharacterClasses } = require('./characters');

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('Stored character sheet data is invalid.');
  }
}

function loadCharacter(characterId, playerId, isAdmin) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) throw new Error('Character not found.');
  if (!isAdmin && character.player_id !== Number(playerId)) throw new Error('Forbidden.');
  return character;
}

// The shape the rules engine expects.
function spellCharacter(character, sheetData) {
  const rows = getCharacterClasses(character.id);
  const classes = rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
  return { classes, species: character.race, sheetData };
}

function vitalsFor(spellChar) {
  const context = rules.deriveVitalsContext({
    species: spellChar.species, sheetData: spellChar.sheetData, classRows: spellChar.classes
  });
  return { context, vitals: rules.normalizeVitals(spellChar.sheetData, context.hpMax) };
}

function buildView(character, sheetData) {
  const spellChar = spellCharacter(character, sheetData);
  const view = rules.buildSpellsView(spellChar, rules.readSpellcasting(sheetData));
  let slots = [];
  let pact = null;
  try {
    const { context, vitals } = vitalsFor(spellChar);
    const vitalsView = rules.buildVitalsView(vitals, context);
    slots = vitalsView.spellSlots;
    pact = vitalsView.pact;
  } catch {
    // Characters without valid class levels have no slots to show.
  }
  return { ...view, slots, pact, goldCp: character.gold_cp };
}

function getCharacterSpells({ id, player_id, is_admin }) {
  const character = loadCharacter(id, player_id, is_admin);
  return buildView(character, readSheet(character.sheet_data));
}

function findSource(spellChar, key) {
  const source = rules.getSpellSources(spellChar).find(item => item.key === key);
  if (!source) throw new Error('This character has no such spellcasting feature.');
  return source;
}

// request: { cantrips, prepared, addToSpellbook, copyAddedSpells }
function chooseCharacterSpells({ id, player_id, is_admin, source: sourceKey, request }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    const source = findSource(spellCharacter(character, sheetData), sourceKey);
    const { state, copyCostGp } = rules.chooseSpells(rules.readSpellcasting(sheetData), source, request);
    const costCp = copyCostGp * 100;
    if (costCp > character.gold_cp) {
      throw new Error(`Copying costs ${copyCostGp} GP, but ${character.name} has only ${formatCp(character.gold_cp)}.`);
    }
    const nextSheet = { ...sheetData, spellcasting: state };
    db.prepare('UPDATE characters SET sheet_data = ?, gold_cp = gold_cp - ? WHERE id = ?')
      .run(JSON.stringify(nextSheet), costCp, character.id);
    return { copyCostGp, spells: buildView({ ...character, gold_cp: character.gold_cp - costCp }, nextSheet) };
  })();
}

// request: { source, spell, slotLevel | pact | free | ritual }
function castCharacterSpell({ id, player_id, is_admin, request }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    if (character.status !== 'alive') throw new Error('Only living characters can cast spells.');
    const sheetData = readSheet(character.sheet_data);
    const spellChar = spellCharacter(character, sheetData);
    const result = rules.castSpell(rules.readSpellcasting(sheetData), rules.getSpellSources(spellChar), request || {});
    let nextSheet = { ...sheetData, spellcasting: result.state };
    if (result.slotChange) {
      const { context, vitals } = vitalsFor(spellChar);
      const outcome = rules.applyVitalsAction(vitals, 'spendSlot', { level: result.slotChange.level }, context);
      nextSheet = { ...nextSheet, ...outcome.vitals };
    }
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return { spell: result.spell.name, events: result.events, slotChange: result.slotChange, spells: buildView(character, nextSheet) };
  })();
}

function endCharacterConcentration({ id, player_id, is_admin }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    const nextSheet = { ...sheetData, spellcasting: { ...rules.readSpellcasting(sheetData), concentration: null } };
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return { spells: buildView(character, nextSheet) };
  })();
}

// choices: [{ name, cantrip, feat }] — the full new list of Eldritch Invocations.
function chooseCharacterInvocations({ id, player_id, is_admin, choices }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    const nextSheet = rules.chooseInvocations(spellCharacter(character, sheetData), choices, {
      // Resolve a Lessons of the First Ones feat as if no invocation feats existed yet.
      resolveFeat: (featRequest, sheet) => rules.resolveOriginFeatChoice(featRequest, { ...sheet, invocations: [] })
    });
    // Tough from Lessons of the First Ones changes max HP.
    const vitalsContext = rules.deriveVitalsContext({
      species: character.race, sheetData: nextSheet, classRows: spellCharacter(character, nextSheet).classes
    });
    nextSheet.hpMax = vitalsContext.hpMax;
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return { spells: buildView(character, nextSheet) };
  })();
}

// Spell side effects of a vitals action: rests open the change windows (and a
// Long Rest resets free casts); damage asks for a concentration save (or ends
// it at 0 HP).
function spellEffectsOfVitals(character, sheetData, action, params, outcome) {
  const spellChar = spellCharacter(character, sheetData);
  let state = rules.readSpellcasting(sheetData);
  let concentration = null;
  if (action === 'longRest') state = rules.onLongRest(state, rules.getSpellSources(spellChar));
  if (action === 'shortRest') state = rules.onShortRest(state, rules.getSpellSources(spellChar));
  if (action === 'damage') {
    const droppedToZero = outcome.events.some(event => ['droppedToZero', 'instantDeath', 'dead'].includes(event));
    const result = rules.concentrationAfterDamage(state, Number(params.amount) || 0, { droppedToZero });
    state = result.state;
    concentration = result.check;
  }
  return { spellcasting: state, concentration };
}

module.exports = {
  getCharacterSpells,
  chooseCharacterSpells,
  castCharacterSpell,
  endCharacterConcentration,
  chooseCharacterInvocations,
  spellEffectsOfVitals
};
