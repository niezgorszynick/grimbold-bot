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

const { featName } = require('./feats');

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
