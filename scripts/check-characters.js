// scripts/check-characters.js — Read-only report of how existing characters
// look under the rules engine, to review before deploying it.
//
// Usage: node scripts/check-characters.js path/to/copy-of-data.sqlite
// Opens the database read-only and changes nothing. Run it on a copy.

const path = require('path');
const Database = require('better-sqlite3');
const rules = require('../rules');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/check-characters.js path/to/copy-of-data.sqlite');
  process.exit(1);
}
const db = new Database(path.resolve(file), { readonly: true, fileMustExist: true });

const characters = db.prepare('SELECT id, name, race, class, subclass, level, status, sheet_data FROM characters ORDER BY id').all();
const classRowsFor = db.prepare(`
  SELECT class_name, subclass_name, class_level FROM character_classes
  WHERE character_id = ? ORDER BY is_primary DESC, id ASC
`);

let warnings = 0;
for (const character of characters) {
  const notes = [];
  let sheet = {};
  try {
    sheet = JSON.parse(character.sheet_data || '{}') || {};
  } catch {
    notes.push('sheet_data is not valid JSON (sheet will fail to load)');
  }
  const rows = classRowsFor.all(character.id);
  const classes = rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }));
  const applied = classes.reduce((sum, row) => sum + row.level, 0);

  if (applied !== character.level) notes.push(`level ${character.level} but ${applied} class levels → ${character.level - applied} pending level-up(s)`);
  classes.filter(row => !rules.getClass(row.className)).forEach(row => notes.push(`unknown class "${row.className}" (no HP tracking)`));
  classes.filter(row => row.level >= 3 && !row.subclassName && rules.getClass(row.className))
    .forEach(row => notes.push(`${row.className} ${row.level} has no subclass (asked at next level-up)`));
  if (!sheet.abilities || !sheet.abilities.con) notes.push('no ability scores saved: HP assumes CON 10 until the sheet is saved');

  let hpSummary = 'HP n/a';
  try {
    const context = rules.deriveVitalsContext({ species: character.race, sheetData: sheet, classRows: classes });
    const vitals = rules.normalizeVitals(sheet, context.hpMax);
    const storedMax = sheet.hpMax ?? sheet.maxHp;
    hpSummary = `HP ${vitals.hpCurrent}/${context.hpMax}` + (storedMax !== undefined ? ` (sheet said max ${storedMax})` : '');
    if (Number.isInteger(sheet.hpCurrent) && sheet.hpCurrent > context.hpMax) {
      notes.push(`current HP ${sheet.hpCurrent} is above the calculated max and will show as ${context.hpMax}`);
    }
    if (storedMax !== undefined && Number(storedMax) !== context.hpMax) {
      notes.push(`max HP changes from ${storedMax} to ${context.hpMax} (use the HP adjustment field if the old value was intended)`);
    }
  } catch (error) {
    notes.push(`HP cannot be calculated: ${error.message}`);
  }

  const label = `#${character.id} ${character.name} — ${rows.map(r => `${r.class_name} ${r.class_level}`).join(' / ') || character.class}, level ${character.level}, ${character.status}, ${hpSummary}`;
  console.log((notes.length ? '⚠️  ' : '✅ ') + label);
  notes.forEach(note => console.log('     - ' + note));
  warnings += notes.length;
}
console.log(`\n${characters.length} characters checked, ${warnings} note(s). Nothing was changed.`);
