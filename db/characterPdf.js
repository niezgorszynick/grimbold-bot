// db/characterPdf.js — A character exported onto the official fillable 2024
// character sheet (two pages). The template is Wizards of the Coast's own PDF,
// so it is kept out of Git like the book text: rules/content/character-sheet.pdf
// (or CHARACTER_SHEET_PDF). Its fields have no names worth reading (Text1,
// Check Box37, ...), so FIELDS below says which is which, by where it sits.
//
// Everything on the sheet comes from what the panel already works out: the
// roll options (saves, skills, initiative), the combat view (AC, attacks), the
// vitals (HP, hit dice, slots, uses), the spell view and the magic items.
// The fields stay editable, so the sheet can be kept up at the table.

'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const rules = require('../rules');
const { db } = require('./connection');
const { getCharacterClasses } = require('./characters');
const { rollOptions } = require('./dice');
const { buildCharacterCombat } = require('./combat');
const { getCharacterMagicItems } = require('./magicItems');
const { getCharacterSpells } = require('./spells');
const { splitCp } = require('../currency');

const TEMPLATE = process.env.CHARACTER_SHEET_PDF
  ? path.resolve(__dirname, '..', process.env.CHARACTER_SHEET_PDF)
  : path.join(__dirname, '..', 'rules', 'content', 'character-sheet.pdf');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

// The template's fields by meaning.
const FIELDS = {
  name: 'Text1', background: 'Text6', className: 'Text7', species: 'Text8', subclass: 'Text9', level: 'Text11', xp: 'Text12',
  ac: 'Text13', shield: 'Check Box3',
  hpCurrent: 'Text14', hpTemp: 'Text15', hpMax: 'Text16', hitDiceSpent: 'Text18', hitDiceMax: 'Text17',
  deathSuccesses: ['Check Box5', 'Check Box6', 'Check Box7'], deathFailures: ['Check Box8', 'Check Box9', 'Check Box10'],
  proficiency: 'Text19', initiative: 'Text26', speed: 'Text27', size: 'Text28', passivePerception: 'Text29',
  heroicInspiration: 'Check Box11',
  // ability: [modifier, score, save box, save bonus]
  abilities: {
    str: ['Text21', 'Text64', 'Check Box37', 'Text91'],
    dex: ['Text22', 'Text66', 'Check Box33', 'Text87'],
    con: ['Text24', 'Text67', 'Check Box32', 'Text86'],
    int: ['Text20', 'Text63', 'Check Box4', 'Text69'],
    wis: ['Text23', 'Text65', 'Check Box21', 'Text75'],
    cha: ['Text25', 'Text68', 'Check Box26', 'Text81']
  },
  // skill: [proficiency box, bonus]
  skills: {
    Athletics: ['Check Box38', 'Text92'],
    Acrobatics: ['Check Box34', 'Text88'], 'Sleight of Hand': ['Check Box35', 'Text89'], Stealth: ['Check Box36', 'Text90'],
    Arcana: ['Check Box16', 'Text70'], History: ['Check Box17', 'Text71'], Investigation: ['Check Box19', 'Text72'],
    Nature: ['Check Box20', 'Text73'], Religion: ['Check Box18', 'Text74'],
    'Animal Handling': ['Check Box22', 'Text76'], Insight: ['Check Box23', 'Text77'], Medicine: ['Check Box25', 'Text78'],
    Perception: ['Check Box31', 'Text79'], Survival: ['Check Box24', 'Text80'],
    Deception: ['Check Box27', 'Text82'], Intimidation: ['Check Box28', 'Text83'], Performance: ['Check Box30', 'Text84'],
    Persuasion: ['Check Box29', 'Text85']
  },
  // Weapons & damage cantrips: [name, attack bonus / DC, damage & type, notes] × 6
  attacks: [30, 34, 38, 42, 46, 50].map(n => [n, n + 1, n + 2, n + 3].map(i => 'Text' + i)),
  classFeatures: ['Text54', 'Text55'], speciesTraits: 'Text57', feats: 'Text58',
  armorTraining: { Light: 'Check Box13', Medium: 'Check Box14', Heavy: 'Check Box15', Shields: 'Check Box12' },
  weaponTraining: 'Text59', tools: 'Text60',
  // Page 2
  spellAbility: 'Text111', spellModifier: 'Text93', spellDc: 'Text94', spellAttack: 'Text95',
  // level: [total, expended boxes]
  slots: {
    1: ['Text112', ['Check Box227', 'Check Box228', 'Check Box229', 'Check Box230']],
    2: ['Text113', ['Check Box231', 'Check Box232', 'Check Box233']],
    3: ['Text114', ['Check Box234', 'Check Box235', 'Check Box236']],
    4: ['Text117', ['Check Box237', 'Check Box238', 'Check Box239']],
    5: ['Text116', ['Check Box240', 'Check Box241', 'Check Box242']],
    6: ['Text115', ['Check Box243', 'Check Box244']],
    7: ['Text118', ['Check Box245', 'Check Box246']],
    8: ['Text119', ['Check Box247']],
    9: ['Text120', ['Check Box248']]
  },
  spellRows: Array.from({ length: 30 }, (_, row) => {
    const notes = ['Text108', ...Array.from({ length: 18 }, (_, i) => 'Text' + (208 + i)), 'Text227', 'Text228', 'Text229', 'Text230', 'Text244',
      'Text231', 'Text232', 'Text233', 'Text234', 'Text235', 'Text236'];
    const [c, r, m] = row < 7 ? [252, 253, '254.0'] : row < 20 ? [255, 256, 257] : [258, 259, 260];
    const sub = row < 7 ? row : row < 20 ? row - 7 : row - 20;
    return {
      level: 'Text105.' + row, name: 'Text106.' + row, time: 'Text107.' + row, range: 'Text109.' + row, notes: notes[row],
      concentration: `Check Box${c}.${sub}`, ritual: `Check Box${r}.${sub}`, material: `Check Box${m}.${sub}`
    };
  }),
  appearance: 'Text96', backstory: 'Text97', alignment: 'Text100', languages: 'Text98', equipment: 'Text99',
  attunement: [['Check Box249', 'Text101'], ['Check Box250', 'Text102'], ['Check Box251', 'Text103']],
  coins: { cp: 'Text226', sp: 'Text267', ep: 'Text268', gp: 'Text269', pp: 'Text270' }
};

// Boxes with room for several lines.
const MULTILINE = ['Text54', 'Text55', 'Text57', 'Text58', 'Text59', 'Text60', 'Text96', 'Text97', 'Text98', 'Text99'];

function templateAvailable() {
  return fs.existsSync(TEMPLATE);
}

function readSheet(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const signed = n => (n >= 0 ? '+' + n : String(n));
// "1d20+5" → "+5"
const bonusOf = formula => signed(Number(String(formula || '').replace(/^1d20/, '')) || 0);

// The standard PDF font only has Western European letters: others lose their
// accents (ł → l, ś → s) instead of breaking the export.
function winAnsi(text) {
  return String(text ?? '')
    .replace(/[łŁ]/g, c => (c === 'ł' ? 'l' : 'L'))
    .replace(/[−–]/g, '-')
    .replace(/[  ]/g, ' ')
    .replace(/[^\n\x20-\x7e -ÿ—‘’“”•…×]/g, c => {
      const plain = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return /^[\x20-\x7e]+$/.test(plain) ? plain : '';
    });
}

function classRowsOf(character) {
  const rows = getCharacterClasses(character.id);
  return rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass || null, level: character.level }];
}

function vitalsOf(character, sheetData, classes) {
  try {
    const context = rules.deriveVitalsContext({ species: character.race, sheetData, classRows: classes });
    return rules.buildVitalsView(rules.normalizeVitals(sheetData, context.hpMax), context);
  } catch {
    return null;
  }
}

// shortOne: one use back on a Short Rest, all on a Long Rest (Second Wind).
const RECOVERY = { long: 'Long Rest', short: 'Short Rest', shortOne: 'Long Rest, 1 on Short' };

// Class and subclass features by name, with uses where the sheet counts them.
function classFeatureLines(classes, vitals) {
  const skip = name => /^Ability Score Improvement$|Subclass$|^Epic Boon$|^Subclass Feature$/.test(name);
  const lines = [];
  const seen = new Set();
  const add = (name, prefix = '') => {
    if (seen.has(name)) return;
    seen.add(name);
    lines.push(prefix + name);
  };
  const resources = vitals ? vitals.resources || [] : [];
  const usesOf = name => {
    const resource = resources.find(entry => entry.name === name);
    if (!resource || !resource.max) return '';
    return ` (${resource.max}${resource.recovery && RECOVERY[resource.recovery] ? ' / ' + RECOVERY[resource.recovery] : ''})`;
  };
  for (const row of classes) {
    const data = rules.getClass(row.className);
    if (!data) continue;
    Object.entries(data.featuresByLevel || {})
      .filter(([level]) => Number(level) <= row.level)
      .forEach(([, names]) => names.filter(name => !skip(name)).forEach(name => add(name + usesOf(name))));
  }
  for (const entry of rules.subclassFeatureTexts(classes)) {
    entry.features.forEach(feature => add(feature.name + usesOf(feature.name)));
  }
  // Uses from features named differently in the class table (Channel Divinity, ...).
  resources.filter(resource => !lines.some(line => line.startsWith(resource.name)))
    .forEach(resource => add(resource.name + usesOf(resource.name)));
  return lines;
}

function speciesTraitLines(character, sheetData, vitals) {
  const species = rules.DND_SPECIES_DATA[character.race];
  const senses = vitals ? (vitals.defenses || []).filter(entry => entry.kind === 'sense').map(entry => entry.text) : [];
  const lines = (species ? species.traits || [] : []).map(trait => {
    if (trait.name === 'Darkvision') return senses.find(text => /^Darkvision/.test(text)) || trait.name;
    if (/Lineage|Legacy|Ancestry$/.test(trait.name) && sheetData.speciesOption && /Lineage|Legacy/.test(trait.name)) {
      return trait.name + ': ' + sheetData.speciesOption;
    }
    return trait.name;
  });
  senses.filter(text => !lines.includes(text)).forEach(text => lines.push(text));
  return lines;
}

function featLines(sheetData) {
  return rules.collectCharacterFeats(sheetData).map(feat => {
    const name = typeof feat === 'string' ? feat : feat && feat.name;
    if (!name) return null;
    return feat.spellList ? `${name} (${feat.spellList})` : name;
  }).filter(Boolean);
}

const TIME_SHORT = [[/^Bonus Action/i, 'BA'], [/^Reaction/i, 'R'], [/^Action/i, 'A']];
function castingTime(text) {
  const value = String(text || '');
  const found = TIME_SHORT.find(([pattern]) => pattern.test(value));
  return found ? found[1] : value.replace(/ or Ritual$/i, '');
}

// Cantrips and prepared spells from every source, the main class first.
function spellRows(spellView) {
  const rows = [];
  const seen = new Set();
  const sources = (spellView && spellView.sources) || [];
  sources.forEach((source, index) => {
    const names = [...(source.cantrips || []), ...(source.alwaysPrepared || []), ...(source.prepared || [])];
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      const spell = rules.findSpell(name);
      const notes = [];
      if (index > 0 || source.kind !== 'class') notes.push(source.label);
      if (source.freeLeft && source.freeLeft[name] !== undefined && spell && spell.level > 0) notes.push('1 free / LR');
      if (spell && spell.components && spell.components.materialCostGp) {
        notes.push(`M ${spell.components.materialCostGp}+ GP${spell.components.materialConsumed ? ', used up' : ''}`);
      }
      rows.push({
        level: spell ? spell.level : null,
        name,
        time: spell ? castingTime(spell.castingTime) : '',
        range: spell ? spell.range.replace(/ feet\b/, ' ft.') : '',
        concentration: Boolean(spell && spell.concentration),
        ritual: Boolean(spell && spell.ritual),
        material: Boolean(spell && spell.components && spell.components.material),
        notes: notes.join('; ')
      });
    }
  });
  return rows.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name));
}

function appearanceText(sheetData) {
  const look = sheetData.appearance && typeof sheetData.appearance === 'object' ? sheetData.appearance : {};
  return [
    look.height ? 'Height: ' + look.height : '',
    look.eyes ? 'Eyes: ' + look.eyes : '',
    look.hairColor || look.hairstyle ? 'Hair: ' + [look.hairColor, look.hairstyle].filter(Boolean).join(', ') : '',
    look.other || ''
  ].filter(Boolean).join('\n');
}

function equipmentText(sheetData, magicItems) {
  const inventory = Array.isArray(sheetData.inventory) ? sheetData.inventory : [];
  const items = inventory.map(row => (row.quantity > 1 ? `${row.name} ×${row.quantity}` : row.name));
  const magic = (magicItems ? magicItems.items : []).filter(item => !item.attuned).map(item => item.name);
  const lines = [items.join(', '), magic.length ? 'Magic: ' + magic.join(', ') : '', sheetData.equipmentText || ''];
  return lines.filter(Boolean).join('\n');
}

// Everything that goes on the sheet, by field name: text or true/false.
function sheetValues(character, user) {
  const sheetData = readSheet(character.sheet_data);
  const classes = classRowsOf(character);
  const level = classes.reduce((sum, row) => sum + row.level, 0) || character.level || 1;
  const pb = rules.proficiencyBonus(Math.max(1, level));
  const vitals = vitalsOf(character, sheetData, classes);
  const combat = buildCharacterCombat(character, sheetData);
  const options = rollOptions(character);
  const who = { id: character.id, player_id: user.id, is_admin: true };
  let spells = null;
  try { spells = getCharacterSpells(who); } catch { spells = null; }
  let magicItems = null;
  try { magicItems = getCharacterMagicItems(who); } catch { magicItems = null; }

  const values = {};
  const set = (field, value) => { if (field && value !== undefined && value !== null && value !== '') values[field] = value; };

  set(FIELDS.name, character.name);
  set(FIELDS.background, sheetData.background);
  set(FIELDS.className, classes.length > 1 ? classes.map(row => `${row.className} ${row.level}`).join(' / ') : classes[0].className);
  set(FIELDS.subclass, classes.map(row => row.subclassName).filter(Boolean).join(' / '));
  set(FIELDS.species, sheetData.speciesOption ? `${character.race} (${sheetData.speciesOption})` : character.race);
  set(FIELDS.level, String(level));
  set(FIELDS.xp, String(character.xp || 0));

  set(FIELDS.ac, String(combat.armorClass.value));
  set(FIELDS.shield, Boolean(combat.armorClass.shield));
  if (vitals) {
    set(FIELDS.hpCurrent, String(vitals.hpCurrent));
    set(FIELDS.hpMax, String(vitals.hpMax));
    if (vitals.hpTemp) set(FIELDS.hpTemp, String(vitals.hpTemp));
    set(FIELDS.hitDiceMax, vitals.hitDice.map(pool => pool.total + pool.die).join(' + '));
    const spent = vitals.hitDice.filter(pool => pool.spent).map(pool => pool.spent + pool.die).join(' + ');
    if (spent) set(FIELDS.hitDiceSpent, spent);
    FIELDS.deathSuccesses.forEach((box, i) => set(box, i < vitals.deathSaves.successes));
    FIELDS.deathFailures.forEach((box, i) => set(box, i < vitals.deathSaves.failures));
    set(FIELDS.heroicInspiration, Boolean(vitals.heroicInspiration));
  }

  set(FIELDS.proficiency, signed(pb));
  set(FIELDS.initiative, bonusOf(options.get('initiative').formula));
  set(FIELDS.speed, sheetData.speed);
  set(FIELDS.size, sheetData.size);
  set(FIELDS.passivePerception, String(10 + Number(bonusOf(options.get('skill:Perception').formula))));

  const saves = Array.isArray(sheetData.savingProficiencies) ? sheetData.savingProficiencies : [];
  for (const ability of ABILITIES) {
    const [modField, scoreField, saveBox, saveField] = FIELDS.abilities[ability];
    const score = rules.effectiveAbilityScore(sheetData, ability);
    set(scoreField, String(score));
    set(modField, signed(rules.abilityModifier(score)));
    set(saveBox, saves.includes(ability));
    set(saveField, bonusOf(options.get('save:' + ability).formula));
  }
  const skills = Array.isArray(sheetData.skillProficiencies) ? sheetData.skillProficiencies : [];
  const expertise = Array.isArray(sheetData.expertise) ? sheetData.expertise : [];
  for (const [skill, [box, field]] of Object.entries(FIELDS.skills)) {
    set(box, skills.includes(skill) || expertise.includes(skill));
    set(field, bonusOf(options.get('skill:' + skill).formula) + (expertise.includes(skill) ? ' E' : ''));
  }

  // Weapons first, then the attacks typed in on the sheet.
  const attacks = [
    ...combat.attacks.filter(attack => !attack.needsType).map(attack => {
      // "1d6-1 Bludgeoning (1d8-1 two-handed)": the two-handed damage goes to the notes.
      const twoHanded = String(attack.damage || '').match(/^(.*?)\s*\((\S+) two-handed\)$/);
      return {
        name: attack.name,
        bonus: attack.attackBonus + (attack.hitDice ? ' ' + attack.hitDice : ''),
        damage: twoHanded ? twoHanded[1] : attack.damage,
        notes: (() => {
          const parts = [twoHanded ? 'Two-handed ' + twoHanded[2] : '', ...(attack.notes || [])].filter(Boolean);
          // Too long for two lines: features by name only ("Great Weapon Fighting").
          return (parts.join('; ').length > 70
            ? parts.map(part => (/^Mastery:/.test(part) ? part : part.replace(/:\s.*$/, '')))
            : parts).join('; ');
        })()
      };
    }),
    ...(Array.isArray(sheetData.attacks) ? sheetData.attacks : []).filter(row => row && row.name).map(row => ({
      name: row.name, bonus: row.attackBonus || row.bonus || '', damage: row.damage || '', notes: row.notes || ''
    }))
  ];
  FIELDS.attacks.forEach(([name, bonus, damage, notes], i) => {
    const attack = attacks[i];
    if (!attack) return;
    set(name, attack.name);
    set(bonus, attack.bonus);
    set(damage, attack.damage);
    set(notes, attack.notes);
  });

  const features = classFeatureLines(classes, vitals);
  const half = Math.ceil(features.length / 2);
  set(FIELDS.classFeatures[0], features.slice(0, half).join('\n'));
  set(FIELDS.classFeatures[1], features.slice(half).join('\n'));
  set(FIELDS.speciesTraits, speciesTraitLines(character, sheetData, vitals).join('\n'));
  set(FIELDS.feats, featLines(sheetData).join('\n'));

  const armor = Array.isArray(sheetData.armorTraining) ? sheetData.armorTraining.join(' ') : '';
  for (const [kind, box] of Object.entries(FIELDS.armorTraining)) set(box, new RegExp(kind.replace(/s$/, ''), 'i').test(armor));
  set(FIELDS.weaponTraining, (sheetData.weaponProficiencies || []).join(', '));
  set(FIELDS.tools, (sheetData.toolProficiencies || []).join(', '));

  // Page 2: spellcasting from the main source (a class, else a feat or species).
  const sources = spells ? spells.sources : [];
  const main = sources.find(source => source.kind === 'class') || sources[0];
  if (main) {
    set(FIELDS.spellAbility, ABILITY_NAMES[main.ability]);
    set(FIELDS.spellModifier, signed(rules.abilityModifier(rules.effectiveAbilityScore(sheetData, main.ability))));
    set(FIELDS.spellDc, String(main.saveDc));
    set(FIELDS.spellAttack, signed(Number(main.attackBonus)));
  }
  const slots = new Map(((spells && spells.slots) || []).map(slot => [slot.level, { ...slot }]));
  // Pact Magic slots join the slots of their level.
  const pact = vitals && vitals.pact;
  if (pact && pact.count) {
    const level = pact.slotLevel || pact.level;
    const slot = slots.get(level) || { level, total: 0, spent: 0 };
    slots.set(level, { level, total: slot.total + pact.count, spent: slot.spent + (pact.spent || 0) });
  }
  for (const [level, [total, boxes]] of Object.entries(FIELDS.slots)) {
    const slot = slots.get(Number(level));
    if (!slot || !slot.total) continue;
    set(total, String(slot.total));
    boxes.forEach((box, i) => set(box, i < slot.spent));
  }
  const rows = spellRows(spells);
  FIELDS.spellRows.forEach((fields, i) => {
    const spell = rows[i];
    if (!spell) return;
    const last = i === FIELDS.spellRows.length - 1 && rows.length > FIELDS.spellRows.length;
    set(fields.level, spell.level === null ? '' : String(spell.level));
    set(fields.name, spell.name);
    set(fields.time, spell.time);
    set(fields.range, spell.range);
    set(fields.concentration, spell.concentration);
    set(fields.ritual, spell.ritual);
    set(fields.material, spell.material);
    set(fields.notes, last ? `+${rows.length - i - 1} more on the panel` : spell.notes);
  });

  set(FIELDS.appearance, appearanceText(sheetData));
  set(FIELDS.languages, (sheetData.languages || []).join(', '));
  set(FIELDS.equipment, equipmentText(sheetData, magicItems));
  const attuned = magicItems ? magicItems.items.filter(item => item.attuned) : [];
  FIELDS.attunement.forEach(([box, field], i) => {
    if (!attuned[i]) return;
    set(box, true);
    set(field, attuned[i].name);
  });
  const coins = splitCp(character.gold_cp);
  for (const coin of ['cp', 'sp', 'gp']) if (coins[coin] || coin === 'gp') set(FIELDS.coins[coin], String(coins[coin]));
  return values;
}

async function fillTemplate(values) {
  const doc = await PDFDocument.load(fs.readFileSync(TEMPLATE));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  for (const field of form.getFields()) {
    const name = field.getName();
    const value = values[name];
    if (field.constructor.name === 'PDFCheckBox') {
      if (value === true) field.check();
      else field.uncheck();
      continue;
    }
    if (field.constructor.name !== 'PDFTextField') continue;
    const text = value === undefined ? '' : winAnsi(value);
    const multiline = MULTILINE.includes(name);
    // Some of the template's fields carry no font, others a huge one: the size
    // follows the box (big for AC, HP and scores, small for rows) and shrinks
    // when the text would not fit.
    let size = 8;
    let wrap = multiline;
    if (!multiline) {
      const { width, height } = field.acroField.getWidgets()[0].getRectangle();
      size = height >= 20 ? height * 0.6 : Math.min(10, height * 0.65);
      if (text) size = Math.min(size, (width - 4) / font.widthOfTextAtSize(text, 1));
      // Too long for one line in a row (attack or spell notes): two small lines.
      if (size < 6 && height >= 14) {
        wrap = true;
        size = 5.5;
      }
      size = Math.max(5, Math.round(size * 10) / 10);
    }
    field.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
    if (wrap) field.enableMultiline();
    field.setMaxLength(undefined);
    field.setText(text);
  }
  form.updateFieldAppearances(font);
  return Buffer.from(await doc.save());
}

// The character on the official sheet, as PDF bytes. Owner or admin only.
async function characterSheetPdf({ characterId, user, isAdmin = false }) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) throw new Error('Character not found.');
  if (!(user && (isAdmin || character.player_id === user.id))) throw new Error('Forbidden.');
  if (!templateAvailable()) throw new Error('The character sheet template is missing on the server (rules/content/character-sheet.pdf).');
  return { name: character.name, pdf: await fillTemplate(sheetValues(character, user)) };
}

module.exports = { characterSheetPdf, characterSheetValues: sheetValues, CHARACTER_SHEET_FIELDS: FIELDS, characterSheetTemplateAvailable: templateAvailable };
