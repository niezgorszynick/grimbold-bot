// rules/combat.js — Armor Class and attacks from what a character wears and
// wields: equipment rows (sheetData.inventory, `equipped`) and magic items
// (sheetData.magicItems), plus class features, fighting styles and feats.

const { ARMOR, SHIELD_BONUS } = require('./armor');
const { WEAPONS } = require('./weapons');
const { abilityModifier, proficiencyBonus } = require('./util');
const { getClass } = require('./classes');
const { collectCharacterFeats, featName } = require('./feats');
const { readMagicItems, magicItemEntryInfo, effectiveAbilityScore } = require('./magicItems');

const ABILITY_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
const MAX_AC_ADJUSTMENT = 10;

// ─── Recognising armor, shields and weapons by name ─────────────────────────

const lower = text => String(text || '').toLowerCase().trim();
const gearOf = {
  armor: name => ({ type: 'armor', name, ...ARMOR[name] }),
  shield: () => ({ type: 'shield', name: 'Shield' }),
  weapon: name => ({ type: 'weapon', ...WEAPONS[name] })
};

// Whole-name matches ("Leather" on its own means Leather Armor).
const EXACT = new Map();
// Names safe to find inside longer names ("Dragon Scale Mail", "+1 Morningstar").
const INSIDE = [];
for (const name of Object.keys(ARMOR)) {
  EXACT.set(lower(name), gearOf.armor(name));
  INSIDE.push([lower(name), gearOf.armor(name)]);
  const short = lower(name.replace(/ Armor$/, ''));
  if (short !== lower(name)) EXACT.set(short, gearOf.armor(name));
}
for (const [alias, name] of [['half plate', 'Half Plate Armor'], ['half-plate', 'Half Plate Armor'], ['splint', 'Splint Armor'], ['plate', 'Plate Armor'], ['studded leather', 'Studded Leather Armor']]) {
  INSIDE.push([alias, gearOf.armor(name)]);
}
EXACT.set('shield', gearOf.shield());
INSIDE.push(['shield', gearOf.shield()]);
for (const name of Object.keys(WEAPONS)) {
  EXACT.set(lower(name), gearOf.weapon(name));
  EXACT.set(`${lower(name)}s`, gearOf.weapon(name));
  INSIDE.push([lower(name), gearOf.weapon(name)]);
}
for (const [alias, name] of [['crossbow, light', 'Light Crossbow'], ['crossbow, hand', 'Hand Crossbow'], ['crossbow, heavy', 'Heavy Crossbow'], ['warpick', 'War Pick']]) {
  EXACT.set(alias, gearOf.weapon(name));
  INSIDE.push([alias, gearOf.weapon(name)]);
}
INSIDE.sort((a, b) => b[0].length - a[0].length);
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INSIDE_PATTERNS = INSIDE.map(([alias, gear]) => [new RegExp(`\\b${escapeRegex(alias)}s?\\b`, 'i'), gear]);

// "Chain Mail", "+1 Longsword", "Arcane Focus (Quarterstaff)", "Crossbow, Light",
// "Dragon Scale Mail" → the armor, shield or weapon it is (or null).
function identifyGear(rawName) {
  const name = lower(rawName).replace(/^\+\d\s+/, '').replace(/,?\s+\+\d$/, '');
  if (!name) return null;
  if (EXACT.has(name)) return EXACT.get(name);
  const inner = name.match(/\(([^)]+)\)/);
  if (inner && EXACT.has(lower(inner[1]))) return EXACT.get(lower(inner[1]));
  // The earliest mention wins ("Chain Mail or Chain Shirt" → Chain Mail).
  let best = null;
  for (const [pattern, gear] of INSIDE_PATTERNS) {
    const match = name.match(pattern);
    if (match && (!best || match.index < best.index)) best = { index: match.index, gear };
  }
  return best ? best.gear : null;
}

// The armor, shield or weapon a magic item is: from the name it was given
// ("+1 Chain Mail"), its own name ("Dragon Scale Mail"), its base item
// ("Weapon (Longsword)") or its text ("wielded as a magic Quarterstaff").
function gearOfMagicItem(entry, info) {
  const { item } = info;
  if (!item) return null;
  if (item.kind === 'Armor' && /\bshield\b/i.test(`${item.baseItem} ${item.name}`)) return gearOf.shield();
  // A base item counts only when it names exactly one thing: "Any Medium or
  // Heavy, Except Hide Armor" or "Glaive, Greatsword, Longsword, ..." need the
  // DM to name the item ("Frost Brand (Longsword)").
  const baseItem = /^any\b/i.test(item.baseItem) || /,| or /.test(item.baseItem) ? '' : item.baseItem;
  const fromText = [entry.label, item.name !== 'Armor' && item.name !== 'Weapon' ? item.name : '', baseItem]
    .map(identifyGear).find(Boolean);
  if (fromText && (item.kind === 'Armor' ? fromText.type === 'armor' : item.kind === 'Weapon' ? fromText.type === 'weapon' : true)) {
    return fromText;
  }
  const wielded = String(item.description || '').match(/(?:wielded as|functions as) a magic ([A-Za-z ]+?)(?: that| which|[.,])/i);
  if (wielded) {
    const gear = identifyGear(wielded[1]);
    if (gear && gear.type === 'weapon') return gear;
  }
  if (item.kind === 'Armor') return { type: 'armor', unknown: true };
  if (item.kind === 'Weapon') return { type: 'weapon', unknown: true };
  return null;
}

// "+1 bonus to attack rolls and damage rolls" for magic weapons.
function magicWeaponBonus(info) {
  const label = info.variant && info.variant.label.match(/^\+(\d)$/);
  if (label) return Number(label[1]);
  const text = String(info.item.description || '').match(/\+(\d) bonus to attack rolls and damage rolls/i);
  return text ? Number(text[1]) : 0;
}

// ─── What the character wears and wields ────────────────────────────────────

function readInventory(sheetData) {
  const list = (sheetData || {}).inventory;
  return Array.isArray(list) ? list.filter(row => row && typeof row.name === 'string' && row.name.trim()) : [];
}

// Rows without an explicit choice: weapons are at hand, and the armor and
// shield chosen at character creation are worn.
function isWorn(row, gear, sheetData) {
  if (typeof row.equipped === 'boolean') return row.equipped;
  if (!gear) return false;
  if (gear.type === 'weapon') return true;
  const source = String((sheetData || {}).armorClassSource || '');
  if (gear.type === 'shield') return /\bShield\b/.test(source);
  return source.split(' + ')[0] === gear.name;
}

// Everything worn or wielded: [{ from: 'inventory'|'magic', index|uid, name, gear, magic }].
function wornGear(sheetData) {
  const worn = [];
  readInventory(sheetData).forEach((row, index) => {
    const gear = identifyGear(row.name);
    if (gear && isWorn(row, gear, sheetData)) worn.push({ from: 'inventory', index, name: row.name, gear, magic: null });
  });
  readMagicItems(sheetData).forEach(entry => {
    if (!entry.equipped) return;
    const info = magicItemEntryInfo(entry);
    const gear = gearOfMagicItem(entry, info);
    if (gear) worn.push({ from: 'magic', uid: entry.uid, name: info.name, gear, magic: info });
  });
  return worn;
}

// Wearing armor takes off other armor; the same for shields. Returns the
// next sheetData. target: { from: 'inventory', index } | { from: 'magic', uid }.
function setWorn(sheetData, target, worn) {
  const inventory = readInventory(sheetData).map(row => ({ ...row }));
  const magicItems = readMagicItems(sheetData).map(entry => ({ ...entry }));
  const targetRow = target.from === 'inventory' ? inventory[target.index] : magicItems.find(entry => entry.uid === target.uid);
  if (!targetRow) throw new Error('That item is not on this character.');
  const gear = target.from === 'inventory'
    ? identifyGear(targetRow.name)
    : gearOfMagicItem(targetRow, magicItemEntryInfo(targetRow));

  // Make the defaults explicit first, so taking one thing off doesn't change others.
  inventory.forEach(row => { row.equipped = isWorn(row, identifyGear(row.name), sheetData); });
  if (worn && gear && (gear.type === 'armor' || gear.type === 'shield')) {
    inventory.forEach(row => {
      const other = identifyGear(row.name);
      if (row !== targetRow && other && other.type === gear.type) row.equipped = false;
    });
    magicItems.forEach(entry => {
      if (entry === targetRow || !entry.equipped) return;
      const other = gearOfMagicItem(entry, magicItemEntryInfo(entry));
      // Taking an item off doesn't end attunement; it just stops working.
      if (other && other.type === gear.type) entry.equipped = false;
    });
  }
  targetRow.equipped = Boolean(worn);
  return { ...sheetData, inventory, magicItems };
}

// ─── Proficiencies and features ─────────────────────────────────────────────

function classFeatureNames(classes) {
  const names = new Set();
  for (const row of classes) {
    const data = getClass(row.className);
    if (!data) continue;
    for (const [level, features] of Object.entries(data.featuresByLevel || {})) {
      if (Number(level) <= row.level) features.forEach(name => names.add(name));
    }
  }
  return names;
}

// Characters made before the rules engine have no stored lists: use their classes.
function trainingLists(classes, sheetData) {
  const fromClasses = key => {
    const set = new Set();
    classes.forEach((row, index) => {
      const data = getClass(row.className);
      if (data && index === 0) (data[key] || []).forEach(value => set.add(value));
    });
    return [...set];
  };
  return {
    weapons: Array.isArray(sheetData.weaponProficiencies) ? sheetData.weaponProficiencies : fromClasses('weaponProficiencies'),
    armor: Array.isArray(sheetData.armorTraining) ? sheetData.armorTraining : fromClasses('armorTraining')
  };
}

function isProficient(weapon, proficiencies) {
  return proficiencies.some(entry => {
    const text = lower(entry);
    if (text === `${lower(weapon.category)} weapons`) return true;
    if (text === lower(weapon.name) || text === `${lower(weapon.name)}s`) return true;
    if (weapon.category === 'Martial' && text.startsWith('martial weapons with the')) {
      return (/finesse/.test(text) && weapon.properties.includes('Finesse')) || (/light/.test(text) && weapon.properties.includes('Light'));
    }
    return false;
  });
}

function martialArtsDie(monkLevel) {
  if (monkLevel >= 17) return '1d12';
  if (monkLevel >= 11) return '1d10';
  if (monkLevel >= 5) return '1d8';
  return '1d6';
}

const averageOf = die => {
  const match = String(die).match(/^(\d+)d(\d+)$/);
  return match ? Number(match[1]) * (Number(match[2]) + 1) / 2 : Number(die) || 0;
};
const signed = n => (n >= 0 ? `+${n}` : String(n));
const damageText = (die, modifier, type) => `${die}${modifier ? signed(modifier) : ''} ${type}`;

// ─── Armor Class ────────────────────────────────────────────────────────────

function context(character) {
  const sheetData = character.sheetData || {};
  const classes = character.classes || [];
  const scores = Object.fromEntries(Object.keys(ABILITY_LABELS).map(ability => [ability, effectiveAbilityScore(sheetData, ability)]));
  const mods = Object.fromEntries(Object.entries(scores).map(([ability, score]) => [ability, abilityModifier(score)]));
  const totalLevel = classes.reduce((sum, row) => sum + row.level, 0) || 1;
  const levelOf = className => classes.filter(row => row.className === className).reduce((sum, row) => sum + row.level, 0);
  const feats = new Set(collectCharacterFeats(sheetData).map(featName));
  return {
    sheetData, classes, scores, mods, levelOf, feats,
    pb: proficiencyBonus(totalLevel),
    features: classFeatureNames(classes),
    training: trainingLists(classes, sheetData),
    worn: wornGear(sheetData)
  };
}

function calculateArmor(ctx) {
  const { sheetData, classes, mods, scores, levelOf, feats, training, worn } = ctx;
  const notes = [];
  const parts = [];
  const armors = worn.filter(piece => piece.gear.type === 'armor');
  const shields = worn.filter(piece => piece.gear.type === 'shield');
  if (armors.length > 1) notes.push(`Only one armor counts; wearing ${armors.map(piece => piece.name).join(' and ')}.`);
  if (shields.length > 1) notes.push('Only one Shield counts.');
  const armor = armors[0] || null;
  const shield = shields[0] || null;
  let total;

  if (armor && armor.gear.unknown) {
    notes.push(`${armor.name}: name the armor type (e.g. "+1 Chain Mail") to count it.`);
  }
  if (armor && !armor.gear.unknown) {
    const data = armor.gear;
    const dex = data.dexCap === null ? mods.dex : Math.min(mods.dex, data.dexCap);
    total = data.base + dex;
    parts.push({ label: armor.name === data.name ? data.name : `${armor.name} (${data.name})`, value: data.base });
    if (data.dexCap !== 0) parts.push({ label: `DEX${data.dexCap !== null ? ` (max ${data.dexCap})` : ''}`, value: dex });
    const mithral = armor.magic && armor.magic.item && armor.magic.item.name === 'Mithral Armor';
    if (!training.armor.includes(data.category)) {
      notes.push(`Not trained with ${data.category.toLowerCase()}: Disadvantage on Strength and Dexterity D20 Tests, and no spellcasting.`);
    }
    if (data.strength && scores.str < data.strength && !mithral) notes.push(`${data.name} needs Strength ${data.strength}: Speed −10 ft.`);
    if (data.stealthDisadvantage && !mithral) notes.push(`${data.name}: Disadvantage on Dexterity (Stealth) checks.`);
    if (armor.magic) {
      const bonus = (armor.magic.effects && armor.magic.effects.ac) || 0;
      if (bonus && armor.magic.active) {
        parts.push({ label: 'Magic armor', value: bonus });
        total += bonus;
      } else if (bonus) {
        notes.push(`${armor.name}: attune to it for its +${bonus} bonus.`);
      }
    }
    if (feats.has('Defense')) {
      parts.push({ label: 'Defense', value: 1 });
      total += 1;
    }
  } else {
    // Unarmored: the best base the character has.
    const options = [{ label: 'Unarmored', value: 10, extra: [['DEX', mods.dex]] }];
    if (levelOf('Barbarian') >= 1) options.push({ label: 'Unarmored Defense', value: 10, extra: [['DEX', mods.dex], ['CON', mods.con]] });
    if (levelOf('Monk') >= 1 && !shield) options.push({ label: 'Unarmored Defense', value: 10, extra: [['DEX', mods.dex], ['WIS', mods.wis]] });
    if (classes.some(row => row.className === 'Sorcerer' && row.subclassName === 'Draconic Sorcery' && row.level >= 3)) {
      options.push({ label: 'Draconic Resilience', value: 10, extra: [['DEX', mods.dex], ['CHA', mods.cha]] });
    }
    const robe = readMagicItems(sheetData).map(entry => magicItemEntryInfo(entry))
      .find(info => info.active && info.item && info.item.name === 'Robe of the Archmagi');
    if (robe) options.push({ label: 'Robe of the Archmagi', value: 15, extra: [['DEX', mods.dex]] });
    const best = options.reduce((top, option) => {
      const sum = option.value + option.extra.reduce((acc, [, value]) => acc + value, 0);
      return sum > top.sum ? { option, sum } : top;
    }, { option: options[0], sum: -Infinity });
    total = best.sum;
    parts.push({ label: best.option.label, value: best.option.value });
    best.option.extra.forEach(([label, value]) => parts.push({ label, value }));
  }

  if (shield) {
    if (training.armor.includes('Shields')) {
      let bonus = SHIELD_BONUS;
      parts.push({ label: 'Shield', value: SHIELD_BONUS });
      const magic = shield.magic && shield.magic.effects && shield.magic.effects.ac;
      if (magic && shield.magic.active) {
        parts.push({ label: shield.name, value: magic });
        bonus += magic;
      }
      total += bonus;
    } else {
      notes.push('No Shield training: the Shield gives no AC.');
    }
  }

  // Other magic items (Cloak or Ring of Protection, Bracers of Defense, ...).
  for (const entry of readMagicItems(sheetData)) {
    const info = magicItemEntryInfo(entry);
    if (!info.active || !info.effects || !info.effects.ac) continue;
    if (worn.some(piece => piece.from === 'magic' && piece.uid === entry.uid && ['armor', 'shield'].includes(piece.gear.type))) continue;
    if (info.item.name === 'Bracers of Defense' && (armor || shield)) {
      notes.push('Bracers of Defense work only with no armor and no Shield.');
      continue;
    }
    parts.push({ label: info.name, value: info.effects.ac });
    total += info.effects.ac;
  }

  const adjustment = Number.isInteger(sheetData.acAdjustment) ? sheetData.acAdjustment : 0;
  if (adjustment) {
    parts.push({ label: 'Other', value: adjustment });
    total += adjustment;
  }
  return { value: total, parts, notes, armor: armor ? armor.name : null, shield: shield ? shield.name : null, adjustment };
}

// ─── Attacks ────────────────────────────────────────────────────────────────

function weaponAttack(piece, ctx, armorState) {
  const { mods, scores, pb, feats, features, training, levelOf } = ctx;
  const weapon = piece.gear;
  const notes = [];
  const monkLevel = levelOf('Monk');
  const monkWeapon = weapon.kind === 'Melee' && (weapon.category === 'Simple' || weapon.properties.includes('Light'));
  const martialArts = monkLevel >= 1 && monkWeapon && !armorState.armor && !armorState.shield;

  const abilities = weapon.kind === 'Ranged' ? ['dex'] : ['str'];
  if (weapon.properties.includes('Finesse') || martialArts) abilities.push(weapon.kind === 'Ranged' ? 'str' : 'dex');
  const ability = abilities.reduce((best, key) => (mods[key] > mods[best] ? key : best), abilities[0]);
  const mod = mods[ability];

  const proficient = isProficient(weapon, training.weapons);
  let magicBonus = 0;
  if (piece.magic) {
    const bonus = magicWeaponBonus(piece.magic);
    if (bonus && piece.magic.active) magicBonus = bonus;
    else if (bonus) notes.push(`Attune to ${piece.name} for its +${bonus} bonus.`);
    else notes.push(`${piece.name}: see the item for its magic.`);
  }
  const archery = feats.has('Archery') && weapon.kind === 'Ranged' ? 2 : 0;
  const attackBonus = mod + (proficient ? pb : 0) + magicBonus + archery;

  let die = weapon.damage;
  if (martialArts && averageOf(martialArtsDie(monkLevel)) > averageOf(die)) die = martialArtsDie(monkLevel);
  const damageMod = mod + magicBonus;
  let damage = damageText(die, damageMod, weapon.damageType);
  if (weapon.versatile) damage += ` (${damageText(weapon.versatile, damageMod, '').trim()} two-handed)`;

  const props = weapon.properties.map(property => {
    if (property === 'Thrown') return `Thrown ${weapon.range}`;
    if (property === 'Ammunition') return `Ammunition ${weapon.range} (${weapon.ammunition})`;
    if (property === 'Versatile') return null;
    return property;
  }).filter(Boolean);
  notes.unshift(`${ABILITY_LABELS[ability]}${props.length ? ` · ${props.join(', ')}` : ''}`);
  if (features.has('Weapon Mastery')) notes.push(`Mastery: ${weapon.mastery}`);
  if (!proficient) notes.push('Not proficient: no Proficiency Bonus');
  if (weapon.properties.includes('Heavy') && (weapon.kind === 'Melee' ? scores.str : scores.dex) < 13) {
    notes.push(`Heavy: Disadvantage (needs ${weapon.kind === 'Melee' ? 'Strength' : 'Dexterity'} 13)`);
  }
  if (archery) notes.push('Archery +2');
  if (martialArts) notes.push('Martial Arts');
  if (feats.has('Dueling') && weapon.kind === 'Melee' && !weapon.properties.includes('Two-Handed')) {
    notes.push('Dueling: +2 damage when it is your only weapon in hand');
  }
  if (feats.has('Great Weapon Fighting') && weapon.kind === 'Melee' && (weapon.properties.includes('Two-Handed') || weapon.versatile)) {
    notes.push('Great Weapon Fighting: 1s and 2s on damage dice count as 3 (two-handed)');
  }
  if (feats.has('Thrown Weapon Fighting') && weapon.properties.includes('Thrown')) notes.push('Thrown Weapon Fighting: +2 damage when thrown');
  if (feats.has('Two-Weapon Fighting') && weapon.properties.includes('Light')) notes.push('Two-Weapon Fighting: add your modifier to the extra Light attack');
  return {
    name: piece.name,
    from: piece.from,
    weapon: weapon.name,
    attackBonus: signed(attackBonus),
    damage,
    notes
  };
}

function unarmedStrike(ctx, armorState, holdsWeapon) {
  const { mods, pb, feats, levelOf } = ctx;
  const monkLevel = levelOf('Monk');
  const martialArts = monkLevel >= 1 && !armorState.armor && !armorState.shield;
  const ability = martialArts && mods.dex > mods.str ? 'dex' : 'str';
  const mod = mods[ability];
  const options = [{ die: '1', label: null }];
  if (martialArts) options.push({ die: martialArtsDie(monkLevel), label: 'Martial Arts' });
  if (feats.has('Tavern Brawler')) options.push({ die: '1d4', label: 'Tavern Brawler' });
  if (feats.has('Unarmed Fighting')) {
    options.push({ die: holdsWeapon || armorState.shield ? '1d6' : '1d8', label: 'Unarmed Fighting' });
  }
  const best = options.reduce((top, option) => (averageOf(option.die) > averageOf(top.die) ? option : top));
  const damage = best.die === '1' ? `${Math.max(0, 1 + mod)} Bludgeoning` : damageText(best.die, mod, 'Bludgeoning');
  const notes = [ABILITY_LABELS[ability]];
  if (best.label) notes.push(best.label);
  if (feats.has('Unarmed Fighting') && (holdsWeapon || armorState.shield)) notes.push('1d8 with no weapon or Shield in hand');
  notes.push('Or Grapple / Shove (DC ' + (8 + mods.str + pb) + ')');
  return { name: 'Unarmed Strike', from: 'unarmed', weapon: null, attackBonus: signed(mod + pb), damage, notes };
}

// character: { classes: [{ className, subclassName, level }], species, sheetData }
function calculateCombat(character) {
  const ctx = context(character);
  const armorClass = calculateArmor(ctx);
  const weapons = ctx.worn.filter(piece => piece.gear.type === 'weapon');
  const attacks = weapons.filter(piece => !piece.gear.unknown).map(piece => weaponAttack(piece, ctx, armorClass));
  weapons.filter(piece => piece.gear.unknown).forEach(piece => {
    armorClass.notes.push(`${piece.name}: name the weapon (e.g. "+1 Longsword") to list its attack.`);
  });
  attacks.push(unarmedStrike(ctx, armorClass, weapons.length > 0));
  return { armorClass, attacks };
}

// One line of rules text for an armor, shield or weapon.
function describeGear(gear) {
  if (!gear || gear.unknown) return '';
  if (gear.type === 'shield') return 'Shield · +2 AC (needs Shield training)';
  if (gear.type === 'armor') {
    const dex = gear.dexCap === null ? ' + DEX' : gear.dexCap ? ` + DEX (max ${gear.dexCap})` : '';
    return [`${gear.category} · AC ${gear.base}${dex}`, gear.strength ? `Strength ${gear.strength}` : null,
      gear.stealthDisadvantage ? 'Stealth Disadvantage' : null].filter(Boolean).join(' · ');
  }
  const props = gear.properties.map(property => {
    if (property === 'Thrown') return `Thrown (${gear.range})`;
    if (property === 'Ammunition') return `Ammunition (${gear.range}, ${gear.ammunition})`;
    if (property === 'Versatile') return `Versatile (${gear.versatile})`;
    return property;
  });
  return [`${gear.category} ${gear.kind} weapon · ${gear.damage} ${gear.damageType}`, props.join(', ') || null, `Mastery: ${gear.mastery}`]
    .filter(Boolean).join(' · ');
}

function validateAcAdjustment(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || Math.abs(number) > MAX_AC_ADJUSTMENT) {
    throw new Error(`The AC adjustment must be a whole number from -${MAX_AC_ADJUSTMENT} to ${MAX_AC_ADJUSTMENT}.`);
  }
  return number;
}

module.exports = {
  identifyGear,
  gearOfMagicItem,
  wornGear,
  setWorn,
  isWornByDefault: isWorn,
  calculateCombat,
  describeGear,
  validateAcAdjustment
};
