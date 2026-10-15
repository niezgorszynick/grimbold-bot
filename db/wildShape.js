// db/wildShape.js — Wild Shape on the character sheet: the forms a druid has
// learned, the beasts they may still learn, and the combined stat block of
// each form (see rules/wildShape.js). Transforming and reverting are vitals
// actions ('wildShape', 'revertWildShape'), so HP and uses stay in one place.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { getCharacterClasses } = require('./characters');

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadCharacter(id, playerId, isAdmin) {
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(id));
  if (!character) throw new Error('Character not found.');
  if (!isAdmin && character.player_id !== Number(playerId)) throw new Error('Forbidden.');
  return character;
}

function classesOf(character) {
  const rows = getCharacterClasses(character.id);
  return rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
}

// The form the character is in now, as a stat block, or null. Used by the
// sheet, the dice and the adventure table.
function activeWildShape(character, sheetData) {
  const form = typeof sheetData.wildShapeForm === 'string' ? sheetData.wildShapeForm : null;
  if (!form) return null;
  const beast = rules.getBeast(form);
  if (!beast) return { name: form, missing: true };
  const classes = classesOf(character);
  const initiative = rules.initiativeOf({ classes, sheetData }).total;
  return rules.wildShapeBlock(beast, { classes, sheetData, status: rules.wildShapeRules(classes), initiative });
}

function beastSummary(beast) {
  return { name: beast.name, cr: rules.formatCr(beast.cr), crValue: beast.cr, size: beast.size, fly: beast.fly, swim: beast.swim };
}

function view(character, sheetData) {
  const classes = classesOf(character);
  const status = rules.wildShapeRules(classes);
  if (!status) return { available: false };
  const beasts = rules.loadBeasts();
  const known = rules.knownForms(sheetData);
  const initiative = rules.initiativeOf({ classes, sheetData }).total;
  const context = rules.deriveVitalsContext({ species: character.race, sheetData, classRows: classes });
  const vitals = rules.normalizeVitals(sheetData, context.hpMax);
  const uses = context.resources.find(resource => resource.key === 'wildShape');
  return {
    available: true,
    hasBeastList: Object.keys(beasts).length > 0,
    rules: { ...status, maxCr: rules.formatCr(status.maxCr) },
    uses: uses ? { max: uses.max, left: uses.max - Math.min(uses.max, vitals.resourcesUsed.wildShape || 0) } : { max: 0, left: 0 },
    active: vitals.wildShapeForm,
    hp: { current: vitals.hpCurrent, temp: vitals.hpTemp },
    known: known.map(name => {
      const beast = beasts[name];
      if (!beast) return { name, missing: true };
      return { ...beastSummary(beast), block: rules.wildShapeBlock(beast, { classes, sheetData, status, initiative }) };
    }),
    // Beasts that may be learned now, by CR then name.
    learnable: Object.values(beasts)
      .filter(beast => !known.includes(beast.name) && !rules.formProblem(beast, status))
      .sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name))
      .map(beastSummary)
  };
}

function getCharacterWildShape({ id, player_id, is_admin }) {
  const character = loadCharacter(id, player_id, is_admin);
  return view(character, readSheet(character.sheet_data));
}

// change: { learn: 'Wolf' } or { forget: 'Wolf' }.
function changeCharacterWildShapeForms({ id, player_id, is_admin, change }) {
  return db.transaction(() => {
    const character = loadCharacter(id, player_id, is_admin);
    const sheetData = readSheet(character.sheet_data);
    const status = rules.wildShapeRules(classesOf(character));
    const learn = change && change.learn ? String(change.learn) : null;
    const forget = change && change.forget ? String(change.forget) : null;
    if (!learn && !forget) throw new Error('Choose a form to learn or forget.');
    const next = rules.changeKnownForms(sheetData, status, { learn, forget });
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(next), character.id);
    return view(character, next);
  })();
}

module.exports = { getCharacterWildShape, changeCharacterWildShapeForms, activeWildShape };
