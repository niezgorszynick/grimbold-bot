// rules/weapons.js — Weapon table (2024 PHB): damage, properties, mastery.

// [category, kind, damage, damage type, properties, mastery, extra]
// extra: { versatile, range: 'normal/long', ammunition }
const TABLE = [
  ['Club', 'Simple', 'Melee', '1d4', 'Bludgeoning', ['Light'], 'Slow'],
  ['Dagger', 'Simple', 'Melee', '1d4', 'Piercing', ['Finesse', 'Light', 'Thrown'], 'Nick', { range: '20/60' }],
  ['Greatclub', 'Simple', 'Melee', '1d8', 'Bludgeoning', ['Two-Handed'], 'Push'],
  ['Handaxe', 'Simple', 'Melee', '1d6', 'Slashing', ['Light', 'Thrown'], 'Vex', { range: '20/60' }],
  ['Javelin', 'Simple', 'Melee', '1d6', 'Piercing', ['Thrown'], 'Slow', { range: '30/120' }],
  ['Light Hammer', 'Simple', 'Melee', '1d4', 'Bludgeoning', ['Light', 'Thrown'], 'Nick', { range: '20/60' }],
  ['Mace', 'Simple', 'Melee', '1d6', 'Bludgeoning', [], 'Sap'],
  ['Quarterstaff', 'Simple', 'Melee', '1d6', 'Bludgeoning', ['Versatile'], 'Topple', { versatile: '1d8' }],
  ['Sickle', 'Simple', 'Melee', '1d4', 'Slashing', ['Light'], 'Nick'],
  ['Spear', 'Simple', 'Melee', '1d6', 'Piercing', ['Thrown', 'Versatile'], 'Sap', { range: '20/60', versatile: '1d8' }],
  ['Dart', 'Simple', 'Ranged', '1d4', 'Piercing', ['Finesse', 'Thrown'], 'Vex', { range: '20/60' }],
  ['Light Crossbow', 'Simple', 'Ranged', '1d8', 'Piercing', ['Ammunition', 'Loading', 'Two-Handed'], 'Slow', { range: '80/320', ammunition: 'Bolt' }],
  ['Shortbow', 'Simple', 'Ranged', '1d6', 'Piercing', ['Ammunition', 'Two-Handed'], 'Vex', { range: '80/320', ammunition: 'Arrow' }],
  ['Sling', 'Simple', 'Ranged', '1d4', 'Bludgeoning', ['Ammunition'], 'Slow', { range: '30/120', ammunition: 'Bullet' }],
  ['Battleaxe', 'Martial', 'Melee', '1d8', 'Slashing', ['Versatile'], 'Topple', { versatile: '1d10' }],
  ['Flail', 'Martial', 'Melee', '1d8', 'Bludgeoning', [], 'Sap'],
  ['Glaive', 'Martial', 'Melee', '1d10', 'Slashing', ['Heavy', 'Reach', 'Two-Handed'], 'Graze'],
  ['Greataxe', 'Martial', 'Melee', '1d12', 'Slashing', ['Heavy', 'Two-Handed'], 'Cleave'],
  ['Greatsword', 'Martial', 'Melee', '2d6', 'Slashing', ['Heavy', 'Two-Handed'], 'Graze'],
  ['Halberd', 'Martial', 'Melee', '1d10', 'Slashing', ['Heavy', 'Reach', 'Two-Handed'], 'Cleave'],
  ['Lance', 'Martial', 'Melee', '1d10', 'Piercing', ['Heavy', 'Reach', 'Two-Handed'], 'Topple'],
  ['Longsword', 'Martial', 'Melee', '1d8', 'Slashing', ['Versatile'], 'Sap', { versatile: '1d10' }],
  ['Maul', 'Martial', 'Melee', '2d6', 'Bludgeoning', ['Heavy', 'Two-Handed'], 'Topple'],
  ['Morningstar', 'Martial', 'Melee', '1d8', 'Piercing', [], 'Sap'],
  ['Pike', 'Martial', 'Melee', '1d10', 'Piercing', ['Heavy', 'Reach', 'Two-Handed'], 'Push'],
  ['Rapier', 'Martial', 'Melee', '1d8', 'Piercing', ['Finesse'], 'Vex'],
  ['Scimitar', 'Martial', 'Melee', '1d6', 'Slashing', ['Finesse', 'Light'], 'Nick'],
  ['Shortsword', 'Martial', 'Melee', '1d6', 'Piercing', ['Finesse', 'Light'], 'Vex'],
  ['Trident', 'Martial', 'Melee', '1d8', 'Piercing', ['Thrown', 'Versatile'], 'Topple', { range: '20/60', versatile: '1d10' }],
  ['Warhammer', 'Martial', 'Melee', '1d8', 'Bludgeoning', ['Versatile'], 'Push', { versatile: '1d10' }],
  ['War Pick', 'Martial', 'Melee', '1d8', 'Piercing', ['Versatile'], 'Sap', { versatile: '1d10' }],
  ['Whip', 'Martial', 'Melee', '1d4', 'Slashing', ['Finesse', 'Reach'], 'Slow'],
  ['Blowgun', 'Martial', 'Ranged', '1', 'Piercing', ['Ammunition', 'Loading'], 'Vex', { range: '25/100', ammunition: 'Needle' }],
  ['Hand Crossbow', 'Martial', 'Ranged', '1d6', 'Piercing', ['Ammunition', 'Light', 'Loading'], 'Vex', { range: '30/120', ammunition: 'Bolt' }],
  ['Heavy Crossbow', 'Martial', 'Ranged', '1d10', 'Piercing', ['Ammunition', 'Heavy', 'Loading', 'Two-Handed'], 'Push', { range: '100/400', ammunition: 'Bolt' }],
  ['Longbow', 'Martial', 'Ranged', '1d8', 'Piercing', ['Ammunition', 'Heavy', 'Two-Handed'], 'Slow', { range: '150/600', ammunition: 'Arrow' }],
  ['Musket', 'Martial', 'Ranged', '1d12', 'Piercing', ['Ammunition', 'Loading', 'Two-Handed'], 'Slow', { range: '40/120', ammunition: 'Bullet' }],
  ['Pistol', 'Martial', 'Ranged', '1d10', 'Piercing', ['Ammunition', 'Loading'], 'Vex', { range: '30/90', ammunition: 'Bullet' }]
];

const WEAPONS = Object.fromEntries(TABLE.map(([name, category, kind, damage, damageType, properties, mastery, extra = {}]) => [
  name, { name, category, kind, damage, damageType, properties, mastery, versatile: extra.versatile || null, range: extra.range || null, ammunition: extra.ammunition || null }
]));

module.exports = { WEAPONS };
