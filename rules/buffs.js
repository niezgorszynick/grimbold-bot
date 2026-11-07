// rules/buffs.js — Spells cast on a character (by themselves or a party member)
// that change their numbers: Bless, Shield of Faith, Haste, Magic Weapon, ...
// The target's sheet keeps them as sheetData.spellEffects:
//   [{ id, spell, slotLevel, casterId, casterName, castId, concentration, ends }]
// db/spellEffects.js decides which are still on (a Concentration spell lasts
// while its caster still concentrates on that casting); the functions here get
// only the active ones and work out what they add.
//
// BUFFS[spell]:
//   targets(slotLevel): how many creatures (Infinity: any number), self: caster only
//   ends: 'short' (an hour or less: a Short Rest outlasts it) | 'long' (8 hours)
//   effect(slotLevel): what it adds —
//     attackDice / saveDice: dice on attack rolls / saving throws (Bless 1d4)
//     saves: flat bonus to saving throws; ac: flat bonus to AC
//     acFloor: AC can't be lower (Barkskin 17); acBase: unarmored base (Mage Armor 13 + DEX)
//     weaponAttack / weaponDamage: flat bonus with weapons (Magic Weapon)
//     weaponDice: extra damage dice with weapons (Divine Favor 1d4 Radiant)
//   text: what it does, for the sheet (also everything not counted above).

const plus = (base, perSlot, minLevel) => slot => base + perSlot * Math.max(0, (Number(slot) || minLevel) - minLevel);

const BUFFS = {
  Bless: { targets: plus(3, 1, 1), effect: () => ({ attackDice: '1d4', saveDice: '1d4' }), text: '+1d4 to attack rolls and saving throws.' },
  'Shield of Faith': { targets: () => 1, effect: () => ({ ac: 2 }), text: '+2 AC.' },
  Haste: { targets: () => 1, effect: () => ({ ac: 2 }), text: '+2 AC, Speed doubled, Advantage on Dexterity saves, one extra limited action each turn. When it ends: lose a turn.' },
  'Warding Bond': { targets: () => 1, ends: 'short', effect: () => ({ ac: 1, saves: 1 }), text: '+1 AC and saving throws, Resistance to all damage; the caster takes the same damage.' },
  'Magic Weapon': {
    targets: () => 1, ends: 'short',
    effect: slot => { const bonus = slot >= 6 ? 3 : slot >= 3 ? 2 : 1; return { weaponAttack: bonus, weaponDamage: bonus }; },
    text: 'One nonmagical weapon: bonus to its attack and damage rolls.'
  },
  'Elemental Weapon': {
    targets: () => 1,
    effect: slot => { const step = slot >= 7 ? 3 : slot >= 5 ? 2 : 1; return { weaponAttack: step, weaponDice: `${step}d4` }; },
    text: 'One nonmagical weapon: bonus to hit and extra Acid, Cold, Fire, Lightning or Thunder damage (chosen when cast).'
  },
  'Enlarge/Reduce': { targets: () => 1, effect: () => ({ weaponDice: '1d4' }), text: 'Enlarged: one size larger, +1d4 weapon damage, Advantage on Strength checks and saves.' },
  'Divine Favor': { self: true, targets: () => 1, ends: 'short', effect: () => ({ weaponDice: '1d4' }), text: 'Weapon hits deal an extra 1d4 Radiant damage.' },
  "Crusader's Mantle": { targets: () => Infinity, effect: () => ({ weaponDice: '1d4' }), text: 'Within the 30-ft aura: weapon hits deal an extra 1d4 Radiant damage.' },
  'Mage Armor': { targets: () => 1, ends: 'long', effect: () => ({ acBase: 13 }), text: 'With no armor: base AC 13 + Dexterity modifier.' },
  Barkskin: { targets: () => 1, ends: 'short', effect: () => ({ acFloor: 17 }), text: 'AC is at least 17.' },
  Longstrider: { targets: plus(1, 1, 1), ends: 'short', effect: () => ({}), text: 'Speed +10 ft.' },
  Heroism: { targets: plus(1, 1, 1), effect: () => ({}), text: 'Immune to Frightened; Temporary Hit Points equal to the caster\'s spellcasting modifier at the start of each turn.' },
  Guidance: { targets: () => 1, effect: () => ({}), text: '+1d4 to ability checks with the chosen skill.' },
  Resistance: { targets: () => 1, effect: () => ({}), text: 'Once per turn, reduce damage of the chosen type by 1d4.' },
  'Protection from Evil and Good': { targets: () => 1, effect: () => ({}), text: 'Aberrations, Celestials, Elementals, Fey, Fiends and Undead have Disadvantage to hit you; you can\'t be Charmed, Frightened or possessed by them.' },
  Fly: { targets: plus(1, 1, 3), effect: () => ({}), text: 'Fly Speed 60 ft.; you can hover.' },
  'Greater Invisibility': { targets: () => 1, effect: () => ({}), text: 'Invisible.' },
  Stoneskin: { targets: () => 1, effect: () => ({}), text: 'Resistance to Bludgeoning, Piercing and Slashing damage.' },
  'Beacon of Hope': { targets: () => Infinity, effect: () => ({}), text: 'Advantage on Wisdom saves and Death Saving Throws; healing restores the maximum.' },
  'Freedom of Movement': { targets: plus(1, 1, 4), ends: 'short', effect: () => ({}), text: 'Ignores Difficult Terrain; can\'t be slowed, Paralyzed or Restrained by magic.' },
  'Death Ward': { targets: () => 1, ends: 'long', effect: () => ({}), text: 'The first time you would drop to 0 HP, you drop to 1 HP instead.' },
  Foresight: { targets: () => 1, ends: 'long', effect: () => ({}), text: 'Advantage on D20 Tests; attacks against you have Disadvantage.' },
  "Hunter's Mark": { self: true, targets: () => 1, effect: () => ({}), text: '+1d6 Force damage when you hit the marked creature.' },
  Hex: { self: true, targets: () => 1, effect: () => ({}), text: '+1d6 Necrotic damage when you hit the cursed creature; it has Disadvantage on checks with one ability.' }
};

const isBuff = name => Object.hasOwn(BUFFS, name);

// Spells that give the caster Temporary Hit Points when cast, by slot level.
// (They don't stack: the higher number stays, rules/vitals.js setTempHp.)
const TEMP_HP_SPELLS = {
  'False Life': slot => `2d4+${4 + 5 * (Math.max(1, slot) - 1)}`,
  'Armor of Agathys': slot => String(5 * Math.max(1, slot))
};

// { formula } for a spell that gives Temporary Hit Points, else null.
function spellTempHp(name, slotLevel) {
  return Object.hasOwn(TEMP_HP_SPELLS, name) ? { formula: TEMP_HP_SPELLS[name](Number(slotLevel) || 1) } : null;
}

// How many it can target with this slot, and whether only the caster.
function buffTargeting(name, slotLevel) {
  const buff = BUFFS[name];
  if (!buff) return null;
  return { max: buff.self ? 1 : buff.targets(slotLevel), selfOnly: Boolean(buff.self) };
}

function readSpellEffects(sheetData) {
  const list = sheetData && Array.isArray(sheetData.spellEffects) ? sheetData.spellEffects : [];
  return list.filter(entry => entry && isBuff(entry.spell));
}

const label = entry => entry.spell;

// What the (active) spell effects add, summed up for combat and rolls.
function buffTotals(sheetData) {
  const totals = { attackDice: [], saveDice: [], saves: 0, ac: [], acFloor: null, acBase: null, weaponAttack: [], weaponDamage: [], weaponDice: [] };
  // The same spell twice doesn't stack: the strongest casting counts.
  const bySpell = new Map();
  for (const entry of readSpellEffects(sheetData)) {
    const current = bySpell.get(entry.spell);
    if (!current || (entry.slotLevel || 0) > (current.slotLevel || 0)) bySpell.set(entry.spell, entry);
  }
  for (const entry of bySpell.values()) {
    const effect = BUFFS[entry.spell].effect(entry.slotLevel) || {};
    if (effect.attackDice) totals.attackDice.push(effect.attackDice);
    if (effect.saveDice) totals.saveDice.push(effect.saveDice);
    if (effect.saves) totals.saves += effect.saves;
    if (effect.ac) totals.ac.push({ label: label(entry), value: effect.ac });
    if (effect.acFloor && (!totals.acFloor || effect.acFloor > totals.acFloor.value)) totals.acFloor = { label: label(entry), value: effect.acFloor };
    if (effect.acBase && (!totals.acBase || effect.acBase > totals.acBase.value)) totals.acBase = { label: label(entry), value: effect.acBase };
    if (effect.weaponAttack) totals.weaponAttack.push({ label: label(entry), value: effect.weaponAttack });
    if (effect.weaponDamage) totals.weaponDamage.push({ label: label(entry), value: effect.weaponDamage });
    if (effect.weaponDice) totals.weaponDice.push({ label: label(entry), dice: effect.weaponDice });
  }
  return totals;
}

// "+1d4+1d4" from a list of dice.
const diceText = list => list.map(dice => '+' + dice).join('');

module.exports = { BUFFS, TEMP_HP_SPELLS, spellTempHp, isBuff, buffTargeting, readSpellEffects, buffTotals, buffDiceText: diceText };
