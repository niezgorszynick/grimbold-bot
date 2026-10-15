// rules/customWeapons.js — Custom weapons a player adds to their equipment
// ("Grandpa's Cleaver"): based on a real weapon (its dice, properties, range
// and proficiency) or fully homebrew, plus their own extras. Attack and damage
// bonuses are added on top of what the sheet works out (ability modifier,
// Proficiency Bonus), so they stay right when the character changes.
//
// Stored on the equipment row as `weapon`:
//   { base: 'Longsword' | null, damage: '1d8', damageType, kind: 'Melee'|'Ranged',
//     ability: 'str'|'dex'|'finesse', proficient, action, attackBonus, damageBonus }
// base set: damage, kind and ability come from the base weapon; damageType may override it.

const { WEAPONS } = require('./weapons');

const DAMAGE_TYPES = ['Acid', 'Bludgeoning', 'Cold', 'Fire', 'Force', 'Lightning', 'Necrotic', 'Piercing', 'Poison', 'Psychic', 'Radiant', 'Slashing', 'Thunder'];
const WEAPON_ACTIONS = ['Action', 'Bonus Action', 'Reaction'];
const DICE = /^(\d{1,2}d(4|6|8|10|12|20)|\d{1,2})$/;

function bonus(value, label) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isInteger(number) || number < -10 || number > 20) throw new Error(`${label} must be a whole number from -10 to 20.`);
  return number;
}

// Checks what the player entered. Returns the stored form, or throws.
function validateCustomWeapon(input) {
  const body = input && typeof input === 'object' ? input : {};
  const base = body.base ? Object.keys(WEAPONS).find(name => name.toLowerCase() === String(body.base).toLowerCase()) : null;
  if (body.base && !base) throw new Error(`"${body.base}" is not a weapon in the rules; leave it empty for a homebrew weapon.`);
  const action = WEAPON_ACTIONS.includes(body.action) ? body.action : 'Action';
  if (body.damageType && !DAMAGE_TYPES.includes(body.damageType)) throw new Error(`Damage type must be one of: ${DAMAGE_TYPES.join(', ')}.`);
  const weapon = {
    base,
    action,
    attackBonus: bonus(body.attackBonus, 'Attack bonus'),
    damageBonus: bonus(body.damageBonus, 'Damage bonus'),
    damageType: body.damageType || (base ? WEAPONS[base].damageType : null)
  };
  if (base) return weapon;
  const damage = String(body.damage || '').replace(/\s+/g, '').toLowerCase();
  if (!DICE.test(damage)) throw new Error('Damage dice must look like 1d8 or 2d6 (or a flat number).');
  if (!weapon.damageType) throw new Error('Choose a damage type.');
  return {
    ...weapon,
    damage,
    kind: body.kind === 'Ranged' ? 'Ranged' : 'Melee',
    ability: ['str', 'dex', 'finesse'].includes(body.ability) ? body.ability : 'str',
    proficient: body.proficient !== false && body.proficient !== 'false'
  };
}

// The weapon the attack list uses for a custom row (null when it isn't one).
function customWeaponGear(row) {
  const weapon = row && row.weapon;
  if (!weapon || typeof weapon !== 'object') return null;
  const custom = { action: weapon.action || 'Action', attackBonus: weapon.attackBonus || 0, damageBonus: weapon.damageBonus || 0 };
  if (weapon.base && WEAPONS[weapon.base]) {
    const real = WEAPONS[weapon.base];
    return { type: 'weapon', ...real, damageType: weapon.damageType || real.damageType, custom };
  }
  return {
    type: 'weapon',
    name: row.name,
    category: 'Homebrew',
    kind: weapon.kind === 'Ranged' ? 'Ranged' : 'Melee',
    damage: weapon.damage || '1d4',
    damageType: weapon.damageType || 'Bludgeoning',
    properties: weapon.ability === 'finesse' ? ['Finesse'] : [],
    mastery: null,
    versatile: null,
    range: null,
    ammunition: null,
    custom: { ...custom, ability: weapon.ability || 'str', proficient: weapon.proficient !== false }
  };
}

module.exports = { DAMAGE_TYPES, WEAPON_ACTIONS, validateCustomWeapon, customWeaponGear };
