// rules/defenses.js — A character's defenses at a glance: damage resistances
// and immunities, condition immunities, special senses, creature type, and
// save Advantages from species. Worked out from species (with lineage or
// ancestry), subclass features and feats; shown on the sheet and the DM's
// adventure table.
//
// Each entry: { kind, text, source, when }. kind: resistance | immunity |
// condition | sense | type | advantage | note. `when` is a condition in words
// ("while in Starry Form") or null when it always applies; `activeWhen` names a
// vitals state that switches it on (buildVitalsView sets `active`).

const { featName, featGrants } = require('./feats');

const entry = (kind, text, source, extra = {}) => ({ kind, text, source, when: null, ...extra });

function speciesDefenses(species, sheetData) {
  const option = (sheetData || {}).speciesOption || '';
  const list = [];
  const darkvision = range => list.push(entry('sense', `Darkvision ${range} ft.`, species));
  switch (species) {
    case 'Aasimar':
      list.push(entry('resistance', 'Necrotic', 'Aasimar'), entry('resistance', 'Radiant', 'Aasimar'));
      darkvision(60);
      break;
    case 'Dragonborn': {
      const type = (option.match(/\((\w+)\)/) || [])[1];
      if (type) list.push(entry('resistance', type, `Dragonborn (${option.split(' ')[0]})`));
      darkvision(60);
      break;
    }
    case 'Dwarf':
      list.push(entry('resistance', 'Poison', 'Dwarven Resilience'), entry('advantage', 'Saves against Poisoned', 'Dwarven Resilience'));
      darkvision(120);
      break;
    case 'Elf':
      darkvision(option === 'Drow' ? 120 : 60);
      list.push(entry('advantage', 'Saves against Charmed', 'Fey Ancestry'), entry('immunity', 'Magical sleep', 'Trance'));
      break;
    case 'Gnome':
      darkvision(60);
      list.push(entry('advantage', 'INT, WIS and CHA saves against magic', 'Gnomish Cunning'));
      break;
    case 'Halfling':
      list.push(entry('advantage', 'Saves against Frightened', 'Brave'));
      break;
    case 'Orc':
      darkvision(120);
      break;
    case 'Tiefling': {
      const type = { Abyssal: 'Poison', Chthonic: 'Necrotic', Infernal: 'Fire' }[option];
      if (type) list.push(entry('resistance', type, `Tiefling (${option})`));
      darkvision(60);
      break;
    }
    // Eberron: Forge of the Artificer
    case 'Changeling':
      list.push(entry('type', 'Fey', 'Changeling'));
      break;
    case 'Kalashtar':
      list.push(entry('type', 'Aberration', 'Kalashtar'), entry('resistance', 'Psychic', 'Mental Discipline'),
        entry('advantage', 'Wisdom and Charisma saves', 'Dual Mind'), entry('sense', 'Telepathy (10 ft. × your level)', 'Mind Link'),
        entry('note', "Can't be targeted by the Dream spell", 'Severed from Dreams'));
      break;
    case 'Khoravar':
      darkvision(60);
      list.push(entry('advantage', 'Saves against Charmed', 'Fey Ancestry'));
      break;
    case 'Shifter':
      darkvision(60);
      break;
    case 'Warforged':
      list.push(entry('type', 'Construct', 'Warforged'), entry('resistance', 'Poison', 'Construct Resilience'),
        entry('advantage', 'Saves against Poisoned', 'Construct Resilience'), entry('immunity', 'Magical sleep', "Sentry's Rest"));
      break;
    // Ravenloft: The Horrors Within
    case 'Dhampir':
      darkvision(60);
      list.push(entry('resistance', 'Necrotic', 'Trace of Undeath'), entry('note', 'Climb Speed equal to your Speed', 'Spider Climb'));
      break;
    case 'Hexblood':
      darkvision(60);
      list.push(entry('type', 'Fey', 'Hexblood'));
      break;
    case 'Lupin':
      darkvision(60);
      break;
    case 'Reborn':
      if (['Cold', 'Necrotic', 'Poison'].includes(option)) list.push(entry('resistance', option, 'Strange Endurance'));
      list.push(entry('advantage', 'Death Saving Throws', 'Escaped Death'), entry('immunity', 'Magical sleep', 'Everlasting'));
      break;
    default:
      break;
  }
  return list;
}

function subclassDefenses(classes) {
  const list = [];
  for (const row of classes || []) {
    if (row.subclassName === 'Pestilence Domain' && row.level >= 3) {
      list.push(entry('resistance', 'Necrotic', 'Inoculated Soul'), entry('resistance', 'Poison', 'Inoculated Soul'),
        entry('note', "Can't be infected by magical contagions", 'Inoculated Soul'));
      if (row.level >= 17) {
        const form = { source: 'Vermin Form', when: 'in Vermin Form' };
        list.push(entry('resistance', 'Bludgeoning, Piercing and Slashing', form.source, { when: form.when }),
          entry('condition', 'Grappled, Paralyzed, Prone and Restrained', form.source, { when: form.when }));
      }
    }
    if (row.subclassName === 'Hell Knight' && row.level >= 3) {
      list.push(entry('sense', "Devil's Sight 120 ft. (magical Darkness too)", 'Diabolical Gift'));
      if (row.level >= 7) list.push(entry('resistance', 'Fire', 'Hell-Forged Equipment', { when: 'wearing armor or wielding a Shield' }));
    }
    if (row.subclassName === 'Circle of the Stars' && row.level >= 14) {
      list.push(entry('resistance', 'Bludgeoning, Piercing and Slashing', 'Full of Stars', { when: 'in Starry Form', activeWhen: 'starryForm' }));
    }
    // Eberron: Forge of the Artificer; Arcana Unleashed; Ravenloft: The Horrors Within
    if (row.subclassName === 'Alchemist' && row.level >= 15) {
      list.push(entry('resistance', 'Acid', 'Chemical Mastery'), entry('resistance', 'Poison', 'Chemical Mastery'), entry('condition', 'Poisoned', 'Chemical Mastery'));
    }
    if (row.subclassName === 'Necromancer' && row.level >= 3) list.push(entry('resistance', 'Necrotic', 'Necromancy Spellbook'));
    if (row.subclassName === 'Shadow Sorcery' && row.level >= 3) {
      list.push(entry('sense', 'Darkvision 120 ft. (through your own spells\' Darkness)', 'Eyes of the Dark'), entry('sense', 'Blindsight 10 ft.', 'Eyes of the Dark'));
      if (row.level >= 18) list.push(entry('resistance', 'All damage except Force and Radiant', 'Umbral Form', { when: 'in Umbral Form' }));
    }
    if (row.subclassName === 'Undead Patron') {
      if (row.level >= 3) list.push(entry('condition', 'Frightened', 'Form of Dread', { when: 'in Form of Dread' }));
      if (row.level >= 6) list.push(entry('immunity', 'Magical sleep', 'Undead Endurance'), entry('note', 'No Exhaustion from dehydration, malnutrition or suffocation', 'Undead Endurance'));
      if (row.level >= 10) list.push(entry('resistance', 'Necrotic', 'Necrotic Resilience'), entry('immunity', 'Necrotic', 'Necrotic Resilience', { when: 'in Form of Dread' }));
      if (row.level >= 14) list.push(entry('resistance', 'Bludgeoning, Piercing and Slashing', 'Superior Dread', { when: 'in Form of Dread' }));
    }
    if (row.subclassName === 'Hollow Warden' && row.level >= 15) list.push(entry('condition', 'Exhaustion', 'Timeless'));
    if (row.subclassName === 'Phantom' && row.level >= 9) list.push(entry('advantage', 'Death Saving Throws and Constitution saves (with a soul trinket)', 'Life Essence'));
  }
  return list;
}

function featDefenses(feats) {
  const names = new Set((feats || []).map(featName));
  const list = [];
  for (const [feat, path] of [['Death Knight Ascension', 'Death Knight'], ['Lich Ascension', 'Lich']]) {
    if (!names.has(feat)) continue;
    list.push(entry('type', 'Undead', feat), entry('resistance', 'Necrotic', feat), entry('resistance', 'Poison', feat),
      entry('note', 'No Exhaustion from dehydration, malnutrition or suffocation', `Path of the ${path}`));
  }
  // Book feats (rules/bookFeats.js): Mark of Storm's Lightning, Aberrant Anatomy's Blindsight.
  for (const name of names) {
    for (const type of featGrants(name).resistances || []) list.push(entry('resistance', type, name));
  }
  if (names.has('Aberrant Anatomy')) list.push(entry('sense', 'Blindsight 15 ft.', 'Aberrant Anatomy'));
  return list;
}

// { classes: [{ className, subclassName, level }], species, sheetData, feats }
// → entries, with duplicates (same kind, text and condition) merged.
function characterDefenses({ classes, species, sheetData, feats = [] }) {
  const all = [...speciesDefenses(species, sheetData), ...subclassDefenses(classes), ...featDefenses(feats)];
  const merged = new Map();
  for (const item of all) {
    const key = `${item.kind}|${item.text}|${item.when || ''}`;
    if (merged.has(key)) merged.get(key).source += `, ${item.source}`;
    else merged.set(key, { ...item });
  }
  return [...merged.values()];
}

module.exports = { characterDefenses };
