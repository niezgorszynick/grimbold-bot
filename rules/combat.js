// rules/combat.js — Armor Class and attacks from what a character wears and
// wields: equipment rows (sheetData.inventory, `equipped`) and magic items
// (sheetData.magicItems), plus class features, fighting styles and feats.

const { ARMOR, SHIELD_BONUS } = require('./armor');
const { WEAPONS } = require('./weapons');
const { customWeaponGear } = require('./customWeapons');
const { abilityModifier, proficiencyBonus, atLevel } = require('./util');
const { getClass } = require('./classes');
const { collectCharacterFeats, featName } = require('./feats');
const { readMagicItems, magicItemEntryInfo, effectiveAbilityScore, magicItemEffects } = require('./magicItems');
const { itemBonusTotals, itemBonusFor } = require('./itemBonuses');
const { EFFECTS, activeEffectsOf } = require('./effects');
const { buffTotals, buffDiceText } = require('./buffs');

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

// The armor, shield or weapon an equipment row is: a custom weapon's own
// stats, or the item its name names.
function inventoryGear(row) {
  return customWeaponGear(row) || identifyGear(row && row.name);
}

// The armor, shield or weapon a magic item is: from the name it was given
// ("+1 Chain Mail"), its own name ("Dragon Scale Mail"), its base item
// ("Weapon (Longsword)") or its text ("wielded as a magic Quarterstaff").
function gearOfMagicItem(entry, info) {
  const { item } = info;
  if (!item) return null;
  if (item.kind === 'Armor' && /\bshield\b/i.test(`${item.baseItem} ${item.name}`)) return gearOf.shield();
  // The type the DM chose for an item that can be several things.
  const chosen = entry.base ? identifyGear(entry.base) : null;
  if (chosen) return chosen;
  // A base item counts only when it names exactly one thing: "Any Medium or
  // Heavy, Except Hide Armor" or "Glaive, Greatsword, Longsword, ..." need the
  // DM to choose (or a name such as "Frost Brand (Longsword)").
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

// The armor or weapon types a magic item can be, when it isn't fixed:
// "Glaive, Greatsword, Longsword, ..." → those; "Any Simple or Martial" → all
// weapons; "Any Melee Weapon" → melee weapons; "Any Medium or Heavy, Except
// Hide Armor" → those armors. Empty when the type is fixed (or a shield).
function magicItemBaseOptions(entry) {
  const info = magicItemEntryInfo(entry);
  const { item } = info;
  if (!item || !['Armor', 'Weapon'].includes(item.kind)) return [];
  const text = String(item.baseItem || '');
  if (item.kind === 'Armor' && /\bshield\b/i.test(`${text} ${item.name}`)) return [];
  const type = item.kind.toLowerCase();
  if (/^any\b/i.test(text)) {
    if (type === 'armor') {
      const categories = ['Light', 'Medium', 'Heavy'].filter(category => new RegExp(`\\b${category}\\b`, 'i').test(text));
      const except = text.match(/except (.+)$/i);
      const excluded = except ? identifyGear(except[1]) : null;
      return Object.keys(ARMOR).filter(name => categories.some(category => ARMOR[name].category.startsWith(category)) &&
        !(excluded && excluded.name === name));
    }
    const melee = /melee/i.test(text);
    if (!melee && /ammunition/i.test(text)) return [];
    return Object.values(WEAPONS).filter(weapon => !melee || weapon.kind === 'Melee').map(weapon => weapon.name);
  }
  const pieces = text.split(/,\s*(?:or\s+)?|\s+or\s+/).map(identifyGear).filter(gear => gear && gear.type === type);
  return pieces.length > 1 ? [...new Set(pieces.map(gear => gear.name))] : [];
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
    const gear = inventoryGear(row);
    if (gear && isWorn(row, gear, sheetData)) {
      worn.push({ from: 'inventory', index, name: row.nickname || row.name, realName: row.name, nickname: row.nickname || null, gear, magic: null, quantity: Math.max(1, Number(row.quantity) || 1) });
    }
  });
  readMagicItems(sheetData).forEach(entry => {
    if (!entry.equipped) return;
    const info = magicItemEntryInfo(entry);
    const gear = gearOfMagicItem(entry, info);
    if (gear) worn.push({ from: 'magic', uid: entry.uid, name: info.name, realName: info.realName, nickname: info.nickname, gear, magic: info, quantity: Math.max(1, Number(entry.quantity) || 1) });
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
    ? inventoryGear(targetRow)
    : gearOfMagicItem(targetRow, magicItemEntryInfo(targetRow));

  // Make the defaults explicit first, so taking one thing off doesn't change others.
  inventory.forEach(row => { row.equipped = isWorn(row, inventoryGear(row), sheetData); });
  if (worn && gear && (gear.type === 'armor' || gear.type === 'shield')) {
    inventory.forEach(row => {
      const other = inventoryGear(row);
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
    worn: wornGear(sheetData),
    // Rage, Sacred Weapon while they are on (rules/effects.js).
    active: new Set(activeEffectsOf(sheetData, classes)),
    // Spells on the character (Bless, Shield of Faith, ...): rules/buffs.js.
    buffs: buffTotals(sheetData)
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
    notes.push(`${armor.name}: its armor type isn't set yet, so it doesn't count. The DM chooses it under Magic Items.`);
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
    // College of Dance (Dazzling Footwork): no armor and no Shield.
    if (!shield && classes.some(row => row.className === 'Bard' && row.subclassName === 'College of Dance' && row.level >= 3)) {
      options.push({ label: 'Dazzling Footwork', value: 10, extra: [['DEX', mods.dex], ['CHA', mods.cha]] });
    }
    const robe = readMagicItems(sheetData).map(entry => magicItemEntryInfo(entry))
      .find(info => info.active && info.item && info.item.name === 'Robe of the Archmagi');
    if (robe) options.push({ label: 'Robe of the Archmagi', value: 15, extra: [['DEX', mods.dex]] });
    if (ctx.buffs.acBase) options.push({ label: ctx.buffs.acBase.label, value: ctx.buffs.acBase.value, extra: [['DEX', mods.dex]] });
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

  // Shield of Faith, Haste, Warding Bond.
  for (const part of ctx.buffs.ac) {
    parts.push(part);
    total += part.value;
  }
  const adjustment = Number.isInteger(sheetData.acAdjustment) ? sheetData.acAdjustment : 0;
  if (adjustment) {
    parts.push({ label: 'Other', value: adjustment });
    total += adjustment;
  }
  // Barkskin: AC 17 if it is lower.
  if (ctx.buffs.acFloor && total < ctx.buffs.acFloor.value) {
    parts.push({ label: `${ctx.buffs.acFloor.label} (AC ${ctx.buffs.acFloor.value})`, value: ctx.buffs.acFloor.value - total });
    total = ctx.buffs.acFloor.value;
  }
  return { value: total, parts, notes, armor: armor ? armor.name : null, shield: shield ? shield.name : null, adjustment };
}

// ─── Attacks ────────────────────────────────────────────────────────────────

// options.offHand: the extra attack of the Light property (or Dual Wielder),
// which adds no ability modifier to damage unless it is negative or the
// character has Two-Weapon Fighting.
function weaponAttack(piece, ctx, armorState, options = {}) {
  const { mods, scores, pb, feats, features, training, levelOf } = ctx;
  const weapon = piece.gear;
  const notes = [];
  const monkLevel = levelOf('Monk');
  const monkWeapon = weapon.kind === 'Melee' && (weapon.category === 'Simple' || weapon.properties.includes('Light'));
  const martialArts = monkLevel >= 1 && monkWeapon && !armorState.armor && !armorState.shield;

  // A custom weapon's extras; a homebrew one also sets its ability and proficiency.
  const custom = weapon.custom || null;
  const pact = options.pact || null;
  let abilities = weapon.kind === 'Ranged' ? ['dex'] : ['str'];
  if (weapon.properties.includes('Finesse') || martialArts) abilities.push(weapon.kind === 'Ranged' ? 'str' : 'dex');
  if (custom && (custom.ability === 'str' || custom.ability === 'dex')) abilities = martialArts ? [custom.ability, 'dex'] : [custom.ability];
  // Pact of the Blade: Charisma instead of Strength or Dexterity.
  if (pact) abilities.push('cha');
  const ability = abilities.reduce((best, key) => (mods[key] > mods[best] ? key : best), abilities[0]);
  const mod = mods[ability];

  const proficient = pact ? true : (custom && custom.proficient !== undefined ? custom.proficient : isProficient(weapon, training.weapons));
  let magicBonus = 0;
  if (piece.magic) {
    const bonus = magicWeaponBonus(piece.magic);
    if (bonus && piece.magic.active) magicBonus = bonus;
    else if (bonus) notes.push(`Attune to ${piece.name} for its +${bonus} bonus.`);
    else notes.push(`${piece.name}: see the item for its magic.`);
  }
  const archery = feats.has('Archery') && weapon.kind === 'Ranged' ? 2 : 0;
  // Sacred Weapon: CHA modifier (min. +1) to hit with a melee weapon.
  const sacred = ctx.active.has('sacredWeapon') && weapon.kind === 'Melee' ? EFFECTS.sacredWeapon.attackBonus(scores) : 0;
  // Magic Weapon, Elemental Weapon.
  const spellHit = ctx.buffs.weaponAttack.reduce((sum, part) => sum + part.value, 0);
  const attackBonus = mod + (proficient ? pb : 0) + magicBonus + archery + sacred + spellHit + (custom ? custom.attackBonus : 0);

  let die = weapon.damage;
  if (martialArts && averageOf(martialArtsDie(monkLevel)) > averageOf(die)) die = martialArtsDie(monkLevel);
  const offHand = Boolean(options.offHand);
  const abilityDamage = offHand && mod > 0 && !feats.has('Two-Weapon Fighting') ? 0 : mod;
  // Rage: a bonus on Strength attacks.
  const rage = ctx.active.has('rage') && ability === 'str' ? EFFECTS.rage.damageBonus(ctx.classes) : 0;
  // Dueling: +2 with a one-handed melee weapon and no other weapon (so not the
  // off-hand attack, nor a Versatile weapon held in two hands).
  const dueling = feats.has('Dueling') && weapon.kind === 'Melee' && !weapon.properties.includes('Two-Handed') && !offHand ? 2 : 0;
  const spellDamage = ctx.buffs.weaponDamage.reduce((sum, part) => sum + part.value, 0);
  const twoHandedMod = abilityDamage + magicBonus + rage + spellDamage + (custom ? custom.damageBonus : 0);
  // Divine Favor, Enlarge, Elemental Weapon: extra dice on every weapon hit.
  const extraDice = buffDiceText(ctx.buffs.weaponDice.map(part => part.dice));
  const damageMod = twoHandedMod + dueling;
  // What adds up to the to-hit and damage bonuses, for the sheet to explain.
  const hitParts = [
    { label: ABILITY_LABELS[ability], value: mod },
    proficient ? { label: 'Proficiency', value: pb } : null,
    magicBonus ? { label: 'Magic', value: magicBonus } : null,
    archery ? { label: 'Archery', value: archery } : null,
    sacred ? { label: 'Sacred Weapon', value: sacred } : null,
    ...ctx.buffs.weaponAttack,
    custom && custom.attackBonus ? { label: 'Weapon', value: custom.attackBonus } : null
  ].filter(Boolean);
  const damageParts = [
    abilityDamage || !offHand ? { label: ABILITY_LABELS[ability], value: abilityDamage } : null,
    magicBonus ? { label: 'Magic', value: magicBonus } : null,
    rage ? { label: 'Rage', value: rage } : null,
    ...ctx.buffs.weaponDamage,
    dueling ? { label: 'Dueling', value: dueling } : null,
    custom && custom.damageBonus ? { label: 'Weapon', value: custom.damageBonus } : null
  ].filter(Boolean);
  let damage = damageText(die + '', damageMod, '').trim() + extraDice + ' ' + ((pact && pact.damageType) || weapon.damageType);
  // The off-hand attack is made one-handed.
  if (weapon.versatile && !offHand) damage += ` (${damageText(weapon.versatile, twoHandedMod, '').trim()}${extraDice} two-handed)`;
  // Sneak Attack: once per turn with a Finesse or ranged weapon, with Advantage
  // or an ally next to the target. A roll of its own: the weapon plus the dice.
  const rogueLevel = levelOf('Rogue');
  const sneakAttack = rogueLevel >= 1 && !offHand && (weapon.properties.includes('Finesse') || weapon.kind === 'Ranged')
    ? (() => {
      const dice = `${atLevel(getClass('Rogue').resources.sneakAttackDice, rogueLevel)}d6`;
      return { dice, damage: `${damageText(die, damageMod, '').trim()}${extraDice}+${dice} ${(pact && pact.damageType) || weapon.damageType}` };
    })()
    : null;

  const props = weapon.properties.map(property => {
    if (property === 'Thrown') return `Thrown ${weapon.range}`;
    if (property === 'Ammunition') return `Ammunition ${weapon.range} (${weapon.ammunition})`;
    if (property === 'Versatile') return null;
    return property;
  }).filter(Boolean);
  notes.unshift(`${ABILITY_LABELS[ability]}${props.length ? ` · ${props.join(', ')}` : ''}`);
  // "Dawnbringer": say what it really is, when that's more than the base weapon
  // the attack list already shows ("+1 Longsword", not just "Longsword").
  if (piece.nickname && piece.realName !== weapon.name) notes.unshift(piece.realName);
  if (pact) notes.push(`Pact weapon${pact.damageType ? ` (${weapon.damageType} or ${pact.damageType})` : ': Necrotic, Psychic or Radiant if you like'}`);
  if (features.has('Weapon Mastery') && weapon.mastery) notes.push(`Mastery: ${weapon.mastery}`);
  if (custom) {
    if (custom.action !== 'Action') notes.unshift(custom.action);
    if (weapon.category === 'Homebrew') notes.push('Homebrew');
    else if (custom.attackBonus || custom.damageBonus) notes.push(`Custom: ${signed(custom.attackBonus)} to hit, ${signed(custom.damageBonus)} damage`);
  }
  if (!proficient) notes.push('Not proficient: no Proficiency Bonus');
  if (weapon.properties.includes('Heavy') && (weapon.kind === 'Melee' ? scores.str : scores.dex) < 13) {
    notes.push(`Heavy: Disadvantage (needs ${weapon.kind === 'Melee' ? 'Strength' : 'Dexterity'} 13)`);
  }
  if (archery) notes.push('Archery +2');
  if (martialArts) notes.push('Martial Arts');
  if (dueling) notes.push('Dueling +2 (one-handed, no other weapon)');
  if (sneakAttack) notes.push(`Sneak Attack +${sneakAttack.dice} (once per turn)`);
  ctx.buffs.weaponAttack.forEach(part => notes.push(`${part.label} +${part.value}${ctx.buffs.weaponDamage.some(d => d.label === part.label) ? ' to hit and damage' : ' to hit'} (one weapon)`));
  ctx.buffs.weaponDice.forEach(part => notes.push(`${part.label} +${part.dice}`));
  if (rage) notes.push(`Rage +${rage}`);
  if (sacred) notes.push(`Sacred Weapon +${sacred} to hit; Radiant if you like`);
  if (feats.has('Great Weapon Fighting') && weapon.kind === 'Melee' && (weapon.properties.includes('Two-Handed') || weapon.versatile)) {
    notes.push('Great Weapon Fighting: 1s and 2s on damage dice count as 3 (two-handed)');
  }
  if (feats.has('Thrown Weapon Fighting') && weapon.properties.includes('Thrown')) notes.push('Thrown Weapon Fighting: +2 damage when thrown');
  if (feats.has('Two-Weapon Fighting') && weapon.properties.includes('Light') && !offHand) notes.push('Two-Weapon Fighting: add your modifier to the extra Light attack');
  // How the off-hand attack works, for the damage link's tooltip.
  const offHandRule = offHand
    ? (features.has('Weapon Mastery') && weapon.mastery === 'Nick'
      ? 'Off-hand attack after attacking with a different Light weapon; Nick makes it part of the Attack action (once per turn).'
      : 'Off-hand attack: a Bonus Action after taking the Attack action with a different Light weapon.') +
      (abilityDamage ? (mod < 0 ? ' A negative modifier still applies to damage.' : ' Two-Weapon Fighting adds your modifier.') : ' No ability modifier to damage.')
    : null;
  return {
    name: piece.name,
    offHandRule,
    from: piece.from,
    index: piece.index,
    uid: piece.uid,
    weapon: weapon.name,
    attackBonus: signed(attackBonus),
    hitParts,
    damageParts,
    damageDie: die,
    damage,
    sneakAttack,
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
  const rage = ctx.active.has('rage') && ability === 'str' ? EFFECTS.rage.damageBonus(ctx.classes) : 0;
  const damage = best.die === '1' ? `${Math.max(0, 1 + mod) + rage} Bludgeoning` : damageText(best.die, mod + rage, 'Bludgeoning');
  const notes = [ABILITY_LABELS[ability]];
  if (rage) notes.push(`Rage +${rage}`);
  if (best.label) notes.push(best.label);
  if (feats.has('Unarmed Fighting') && (holdsWeapon || armorState.shield)) notes.push('1d8 with no weapon or Shield in hand');
  notes.push('Or Grapple / Shove (DC ' + (8 + mods.str + pb) + ')');
  return { name: 'Unarmed Strike', from: 'unarmed', weapon: null, attackBonus: signed(mod + pb), damage, notes };
}

// character: { classes: [{ className, subclassName, level }], species, sheetData }
// Initiative (2024): a Dexterity check — DEX modifier, plus Proficiency Bonus
// with Alert, plus magic items that add to ability checks. Jack of All Trades
// doesn't apply (it's for skill checks only). Some features give Advantage.
// character: { classes, sheetData }. Returns { total, parts, advantage }.
function initiativeOf(character) {
  const ctx = context(character);
  const parts = [{ label: 'DEX', value: ctx.mods.dex }];
  if (ctx.feats.has('Alert')) parts.push({ label: 'Alert', value: ctx.pb });
  const items = magicItemEffects(ctx.sheetData).checks || 0;
  if (items) parts.push({ label: 'Magic items', value: items });
  // Custom item bonuses (rules/itemBonuses.js).
  const itemBonus = itemBonusFor(itemBonusTotals(ctx.sheetData), { type: 'initiative' });
  if (itemBonus.value) parts.push({ label: 'Items', value: itemBonus.value });
  const advantage = [];
  if (ctx.classes.some(row => row.className === 'Fighter' && row.subclassName === 'Champion' && row.level >= 3)) advantage.push('Remarkable Athlete');
  if (ctx.levelOf('Barbarian') >= 7) advantage.push('Feral Instinct');
  return { total: parts.reduce((sum, part) => sum + part.value, 0), parts, advantage };
}

function calculateCombat(character) {
  const ctx = context(character);
  const armorClass = calculateArmor(ctx);
  const weapons = ctx.worn.filter(piece => piece.gear.type === 'weapon');
  const known = weapons.filter(piece => !piece.gear.unknown);
  const attacks = [];
  // Two-weapon fighting (Light property): the extra attack needs a Light weapon
  // for the first attack and a different weapon for the second, which must be
  // Light, or with Dual Wielder any one-handed melee weapon. Two daggers in one
  // inventory line count as two.
  const isLight = piece => piece.gear.properties.includes('Light');
  const canOffHand = piece => isLight(piece) ||
    (ctx.feats.has('Dual Wielder') && piece.gear.kind === 'Melee' && !piece.gear.properties.includes('Two-Handed'));
  const lightUnits = known.filter(isLight).reduce((sum, piece) => sum + (piece.quantity || 1), 0);
  known.forEach(piece => {
    attacks.push(weaponAttack(piece, ctx, armorClass));
    const otherLight = lightUnits - (isLight(piece) ? 1 : 0);
    // In the same row: a second damage link ("off-hand 1d4"), not a row of its own.
    if (canOffHand(piece) && otherLight >= 1) {
      const off = weaponAttack(piece, ctx, armorClass, { offHand: true });
      attacks[attacks.length - 1].offHand = { damage: off.damage, rule: off.offHandRule };
    }
  });
  // Listed anyway, so a worn magic weapon never just disappears.
  weapons.filter(piece => piece.gear.unknown).forEach(piece => {
    attacks.push({
      name: piece.name, from: 'magic', uid: piece.uid, weapon: null, needsType: true, attackBonus: '—', damage: '—',
      notes: ['Weapon type not set yet (e.g. Longsword): the DM chooses it under Magic Items.']
    });
  });
  attacks.push(unarmedStrike(ctx, armorClass, weapons.length > 0));
  // Warlocks: the conjured pact weapon first, Eldritch Blast after the weapons.
  const pact = pactWeaponPiece(ctx.sheetData);
  if (pact) attacks.unshift(weaponAttack(pact.piece, ctx, armorClass, { pact: { damageType: pact.damageType } }));
  const blast = eldritchBlast(ctx);
  if (blast) attacks.splice(attacks.length - 1, 0, blast);
  // Bless: dice on every attack roll.
  const hitDice = buffDiceText(ctx.buffs.attackDice);
  if (hitDice) attacks.forEach(entry => { if (!entry.needsType) entry.hitDice = hitDice; });
  return { armorClass, attacks };
}

// ─── Warlock ──────────────────────────────────────────────────────────────

const hasInvocation = (sheetData, name) => Array.isArray(sheetData.invocations) && sheetData.invocations.some(entry => entry && entry.name === name);
const PACT_DAMAGE_TYPES = ['Necrotic', 'Psychic', 'Radiant'];
const PACT_WEAPONS = Object.values(WEAPONS).filter(weapon => weapon.kind === 'Melee' && ['Simple', 'Martial'].includes(weapon.category)).map(weapon => weapon.name).sort();

// sheetData.pactWeapon = { weapon: 'Rapier', name: 'Fog blade', damageType: 'Radiant' | null }.
function validatePactWeapon(value) {
  const input = value && typeof value === 'object' ? value : {};
  if (!PACT_WEAPONS.includes(input.weapon)) throw new Error('Choose a Simple or Martial melee weapon for your pact weapon.');
  const damageType = input.damageType || null;
  if (damageType && !PACT_DAMAGE_TYPES.includes(damageType)) throw new Error('A pact weapon deals its own damage type, or Necrotic, Psychic or Radiant.');
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return { weapon: input.weapon, name: name || input.weapon, damageType };
}

// The conjured pact weapon as a worn piece, with Pact of the Blade and one set.
function pactWeaponPiece(sheetData) {
  if (!hasInvocation(sheetData, 'Pact of the Blade') || !sheetData.pactWeapon) return null;
  let pact;
  try {
    pact = validatePactWeapon(sheetData.pactWeapon);
  } catch {
    return null;
  }
  return { piece: { gear: { type: 'weapon', ...WEAPONS[pact.weapon] }, name: pact.name, from: 'pact' }, damageType: pact.damageType };
}

// Eldritch Blast, for a character who knows it: one attack roll per beam,
// with Agonizing Blast's Charisma on the damage.
function eldritchBlast(ctx) {
  const lists = (((ctx.sheetData || {}).spellcasting || {}).classes) || {};
  const known = Object.values(lists).some(list => Array.isArray(list && list.cantrips) && list.cantrips.includes('Eldritch Blast'));
  if (!known) return null;
  const invocations = Array.isArray(ctx.sheetData.invocations) ? ctx.sheetData.invocations : [];
  const on = name => invocations.some(entry => entry && entry.name === name && (!entry.cantrip || entry.cantrip === 'Eldritch Blast'));
  const cha = ctx.mods.cha;
  const level = ctx.classes.reduce((sum, row) => sum + row.level, 0) || 1;
  const beams = level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  const agonizing = on('Agonizing Blast');
  const warlockLevel = ctx.levelOf('Warlock');
  return {
    name: 'Eldritch Blast',
    from: 'cantrip',
    weapon: 'Cantrip',
    attackBonus: signed(cha + ctx.pb),
    hitParts: [{ label: 'CHA', value: cha }, { label: 'Proficiency', value: ctx.pb }],
    damageParts: agonizing ? [{ label: 'Agonizing Blast (CHA)', value: cha }] : [],
    damageDie: '1d10',
    damage: damageText('1d10', agonizing ? cha : 0, 'Force'),
    notes: [
      `${beams} beam${beams > 1 ? 's' : ''}, an attack roll each`,
      on('Eldritch Spear') && warlockLevel ? `range ${30 * warlockLevel} ft. (Eldritch Spear)` : 'range 120 ft.',
      agonizing ? 'Agonizing Blast' : null,
      on('Repelling Blast') ? 'Repelling Blast: push 10 ft. (Large or smaller)' : null
    ].filter(Boolean)
  };
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
  const custom = gear.custom;
  const extras = custom ? [
    custom.action && custom.action !== 'Action' ? custom.action : null,
    custom.attackBonus ? `${signed(custom.attackBonus)} to hit` : null,
    custom.damageBonus ? `${signed(custom.damageBonus)} damage` : null
  ] : [];
  return [`${gear.category} ${gear.kind} weapon · ${gear.damage} ${gear.damageType}`, props.join(', ') || null,
    gear.mastery ? `Mastery: ${gear.mastery}` : null, ...extras]
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
  PACT_WEAPONS,
  PACT_DAMAGE_TYPES,
  validatePactWeapon,
  identifyGear,
  gearOfMagicItem,
  magicItemBaseOptions,
  wornGear,
  setWorn,
  isWornByDefault: isWorn,
  calculateCombat,
  // Weapon and armor training (stored lists, or the starting class for older sheets).
  characterTraining: trainingLists,
  inventoryGear,
  initiativeOf,
  describeGear,
  validateAcAdjustment
};
