// db/spellEffects.js — Buff spells on characters (rules/buffs.js): cast on
// yourself or a party member, kept on the target's sheet (spellEffects).
// A Concentration spell counts while its caster still concentrates on that
// casting (castId); the others until End or a rest (1-hour spells end on a
// Short Rest, 8-hour ones on a Long Rest).

'use strict';

const crypto = require('crypto');
const { db } = require('./connection');
const rules = require('../rules');

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// casterId → the castId they concentrate on now (null: none), read once per call.
function concentrationLookup() {
  const cache = new Map();
  return casterId => {
    if (!cache.has(casterId)) {
      const caster = db.prepare('SELECT status, sheet_data FROM characters WHERE id = ?').get(casterId);
      const concentration = caster && caster.status === 'alive' ? rules.readSpellcasting(readSheet(caster.sheet_data)).concentration : null;
      cache.set(casterId, concentration && concentration.castId ? concentration.castId : null);
    }
    return cache.get(casterId);
  };
}

function isActive(entry, concentrationOf) {
  if (!entry.concentration) return true;
  return Boolean(entry.castId) && concentrationOf(entry.casterId) === entry.castId;
}

function activeSpellEffects(sheetData, concentrationOf = concentrationLookup()) {
  return rules.readSpellEffects(sheetData).filter(entry => isActive(entry, concentrationOf));
}

// The sheet with only the spells still on, for combat and rolls.
function withActiveSpellEffects(sheetData) {
  if (!sheetData || !Array.isArray(sheetData.spellEffects) || !sheetData.spellEffects.length) return sheetData;
  return { ...sheetData, spellEffects: activeSpellEffects(sheetData) };
}

// For the sheet: what is on the character, from whom.
function spellEffectsView(sheetData) {
  return activeSpellEffects(sheetData).map(entry => ({
    id: entry.id,
    spell: entry.spell,
    casterName: entry.casterName,
    concentration: Boolean(entry.concentration),
    slotLevel: entry.slotLevel,
    text: rules.BUFFS[entry.spell].text
  }));
}

// Self, and the living characters sharing a running adventure with the caster.
function buffTargets(characterId) {
  const self = db.prepare('SELECT id, name FROM characters WHERE id = ?').get(characterId);
  const allies = db.prepare(`
    SELECT DISTINCT c.id, c.name FROM adventure_party mine
    JOIN adventures a ON a.id = mine.adventure_id AND a.status = 'active'
    JOIN adventure_party other ON other.adventure_id = a.id
    JOIN characters c ON c.id = other.character_id
    WHERE mine.character_id = ? AND c.id != ? AND c.status = 'alive'
    ORDER BY c.name
  `).all(characterId, characterId);
  return [...(self ? [{ id: self.id, name: self.name, self: true }] : []), ...allies];
}

// After a cast: the spell goes on the chosen targets. casterSheet is the
// caster's sheet about to be saved (its own entry goes in there, not the DB).
// Returns { casterSheet, targets: [names] }.
function applyBuff({ caster, casterSheet, spell, slotLevel, targetIds }) {
  const targeting = rules.buffTargeting(spell.name, slotLevel);
  if (!targeting) return { casterSheet, targets: [] };
  let ids = Array.isArray(targetIds) ? [...new Set(targetIds.map(Number).filter(Number.isSafeInteger))] : [];
  if (targeting.selfOnly || !ids.length) ids = targeting.selfOnly ? [caster.id] : ids;
  if (!ids.length) return { casterSheet, targets: [] };
  if (ids.length > targeting.max) throw new Error(`${spell.name} can target ${targeting.max} creature${targeting.max === 1 ? '' : 's'} with this slot.`);
  const allowed = new Map(buffTargets(caster.id).map(target => [target.id, target]));
  const unknown = ids.find(id => !allowed.has(id));
  if (unknown !== undefined) throw new Error('Spells can go on yourself or characters in a running adventure with you.');

  const concentration = rules.readSpellcasting(casterSheet).concentration;
  const castId = spell.concentration && concentration && concentration.spell === spell.name ? concentration.castId : null;
  const entryFor = () => ({
    id: crypto.randomUUID(),
    spell: spell.name,
    slotLevel,
    casterId: caster.id,
    casterName: caster.name,
    castId,
    concentration: Boolean(spell.concentration),
    ends: rules.BUFFS[spell.name].ends || 'short'
  });
  // A new casting replaces the same spell from the same caster.
  const withEntry = sheet => ({
    ...sheet,
    spellEffects: [
      ...rules.readSpellEffects(sheet).filter(entry => !(entry.spell === spell.name && entry.casterId === caster.id)),
      entryFor()
    ]
  });
  let nextCaster = casterSheet;
  for (const id of ids) {
    if (id === caster.id) {
      nextCaster = withEntry(nextCaster);
      continue;
    }
    const target = db.prepare('SELECT sheet_data FROM characters WHERE id = ?').get(id);
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(withEntry(readSheet(target.sheet_data))), id);
  }
  return { casterSheet: nextCaster, targets: ids.map(id => allowed.get(id).name) };
}

// End one spell on a character: its owner, an admin, or whoever cast it.
function endSpellEffect({ characterId, effectId, user, isAdmin = false }) {
  return db.transaction(() => {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(characterId));
    if (!character) throw new Error('Character not found.');
    const sheetData = readSheet(character.sheet_data);
    const entry = rules.readSpellEffects(sheetData).find(item => item.id === effectId);
    if (!entry) throw new Error('That spell is no longer on this character.');
    const caster = db.prepare('SELECT player_id FROM characters WHERE id = ?').get(entry.casterId);
    if (!isAdmin && character.player_id !== user.id && !(caster && caster.player_id === user.id)) throw new Error('Forbidden.');
    const nextSheet = { ...sheetData, spellEffects: sheetData.spellEffects.filter(item => item.id !== effectId) };
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), character.id);
    return { spellEffects: spellEffectsView(nextSheet), spell: entry.spell };
  })();
}

// Rests: a Short Rest outlasts the 1-hour spells, a Long Rest all of them.
function spellEffectsAfterRest(sheetData, action) {
  if (!Array.isArray(sheetData.spellEffects) || !['shortRest', 'longRest'].includes(action)) return sheetData;
  const kept = action === 'longRest' ? [] : rules.readSpellEffects(sheetData).filter(entry => !entry.concentration && entry.ends === 'long');
  return { ...sheetData, spellEffects: kept };
}

// Clears spells whose caster stopped concentrating, so the targets' sheets
// change (and refresh live) at once.
function pruneSpellEffects() {
  const concentrationOf = concentrationLookup();
  const rows = db.prepare(`SELECT id, sheet_data FROM characters WHERE sheet_data LIKE '%"spellEffects":[{%'`).all();
  for (const row of rows) {
    const sheetData = readSheet(row.sheet_data);
    const list = Array.isArray(sheetData.spellEffects) ? sheetData.spellEffects : [];
    const kept = list.filter(entry => entry && rules.isBuff(entry.spell) && isActive(entry, concentrationOf));
    if (kept.length !== list.length) {
      db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify({ ...sheetData, spellEffects: kept }), row.id);
    }
  }
}

module.exports = {
  activeSpellEffects, withActiveSpellEffects, spellEffectsView, buffTargets, applyBuff, endSpellEffect, spellEffectsAfterRest, pruneSpellEffects
};
