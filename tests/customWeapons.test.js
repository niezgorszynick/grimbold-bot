const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

test('custom weapon stats are checked', () => {
  assert.deepEqual(rules.validateCustomWeapon({ base: 'longsword', attackBonus: '1' }),
    { base: 'Longsword', action: 'Action', attackBonus: 1, damageBonus: 0, damageType: 'Slashing' });
  assert.throws(() => rules.validateCustomWeapon({ base: 'Lightsaber' }), /not a weapon in the rules/);
  assert.throws(() => rules.validateCustomWeapon({ damage: '1d7', damageType: 'Fire' }), /Damage dice must look like 1d8/);
  assert.throws(() => rules.validateCustomWeapon({ damage: '1d8' }), /Choose a damage type/);
  assert.throws(() => rules.validateCustomWeapon({ base: 'Dagger', attackBonus: 50 }), /from -10 to 20/);
});

test('custom weapons attack and roll like any weapon, with their extras', () => {
  const owner = createPlayer();
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Brakka', 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, ?)
  `).run(owner, JSON.stringify({ abilities: { str: { score: 16 }, dex: { score: 14 } }, weaponProficiencies: ['Simple weapons', 'Martial weapons'] })).lastInsertRowid);
  const asOwner = { id, player_id: owner, is_admin: false };
  const add = params => db.changeCharacterInventory({ ...asOwner, action: 'add', params });

  // Based on a Longsword: STR +3, proficiency +2, its own +1 to hit and +2 damage, Fire, a Bonus Action.
  add({ name: "Grandpa's Cleaver", description: 'Glows when orcs are near.', weapon: { base: 'Longsword', attackBonus: 1, damageBonus: 2, damageType: 'Fire', action: 'Bonus Action' } });
  // Homebrew: 1d10 Necrotic with DEX, not proficient.
  add({ name: 'Grave Lash', weapon: { damage: '1d10', damageType: 'Necrotic', ability: 'dex', proficient: false } });

  const attacks = db.getCharacterCombat(asOwner).attacks;
  const cleaver = attacks.find(attack => attack.name === "Grandpa's Cleaver");
  assert.equal(cleaver.attackBonus, '+6');
  assert.equal(cleaver.damage, '1d8+5 Fire (1d10+5 two-handed)', 'Longsword dice, Versatile kept, Fire');
  assert.equal(cleaver.notes[0], 'Bonus Action');
  const whip = attacks.find(attack => attack.name === 'Grave Lash');
  assert.equal(whip.attackBonus, '+2', 'DEX only, no proficiency');
  assert.equal(whip.damage, '1d10+2 Necrotic');
  assert.ok(whip.notes.includes('Homebrew'));

  const options = [...db.rollOptions(db.getCharacterById(id)).values()];
  assert.equal(options.find(option => option.label === "Grandpa's Cleaver attack").formula, '1d20+6');
  assert.equal(options.find(option => option.label === "Grandpa's Cleaver damage (Fire)").formula, '1d8+5');

  // Two of the same custom weapon stay separate rows; stats can be changed or removed.
  add({ name: 'Grave Lash', weapon: { damage: '1d10', damageType: 'Necrotic', ability: 'dex' } });
  const rows = JSON.parse(db.getCharacterById(id).sheet_data).inventory;
  assert.equal(rows.filter(row => row.name === 'Grave Lash').length, 2);
  db.changeCharacterInventory({ ...asOwner, action: 'setWeapon', params: { index: 1, name: 'Grave Lash', weapon: null } });
  assert.equal(db.getCharacterCombat(asOwner).attacks.filter(attack => attack.name === 'Grave Lash').length, 1);

  // Catalog items keep their real stats (a nickname is the way to rename them).
  db.changeCharacterInventory({ ...asOwner, action: 'add', params: { name: 'Dagger' } });
  const daggerRow = JSON.parse(db.getCharacterById(id).sheet_data).inventory.findIndex(row => row.name === 'Dagger');
  const withCatalogDagger = JSON.parse(db.getCharacterById(id).sheet_data);
  withCatalogDagger.inventory[daggerRow].source = 'catalog';
  db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(withCatalogDagger), id);
  assert.throws(() => db.changeCharacterInventory({ ...asOwner, action: 'setWeapon', params: { index: daggerRow, name: 'Dagger', weapon: { base: 'Dagger', attackBonus: 3 } } }),
    /Only custom items/);
});

test('the weapon editor shows how the sheet adds it up', () => {
  const owner = createPlayer();
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Odo', 'Human', 'Fighter', 'Champion', 5, 0, 'alive', 0, ?)
  `).run(owner, JSON.stringify({ abilities: { str: { score: 14 } }, weaponProficiencies: ['Simple weapons'] })).lastInsertRowid);
  const { attack } = db.previewCustomWeapon({ id, player_id: owner, is_admin: false, name: 'Ember Staff', weapon: { base: 'Quarterstaff', damageType: 'Fire', attackBonus: 4, damageBonus: 4 } });
  assert.deepEqual(attack.hitParts, [{ label: 'STR', value: 2 }, { label: 'Proficiency', value: 3 }, { label: 'Weapon', value: 4 }]);
  assert.equal(attack.attackBonus, '+9');
  assert.deepEqual(attack.damageParts, [{ label: 'STR', value: 2 }, { label: 'Weapon', value: 4 }]);
  assert.equal(attack.damage, '1d6+6 Fire (1d8+6 two-handed)');
  assert.equal(JSON.parse(db.getCharacterById(id).sheet_data).inventory, undefined, 'nothing is saved');
  assert.throws(() => db.previewCustomWeapon({ id, player_id: createPlayer(), is_admin: false, weapon: { base: 'Dagger' } }), /Forbidden/);
});

test('custom weapons can deal damage of other types too', () => {
  assert.deepEqual(rules.validateCustomWeapon({ damage: '1d6', damageType: 'Piercing', extraDamage: [{ dice: '1D4 ', type: 'Fire' }, { dice: '', type: '' }] }).extraDamage,
    [{ dice: '1d4', type: 'Fire' }], 'empty rows are skipped');
  assert.throws(() => rules.validateCustomWeapon({ base: 'Dagger', extraDamage: [{ dice: '1d4', type: 'Fluffy' }] }), /Choose a damage type for the extra 1d4/);
  assert.throws(() => rules.validateCustomWeapon({ base: 'Dagger', extraDamage: [{ dice: '1d5', type: 'Fire' }] }), /Extra damage dice must look like/);
  assert.throws(() => rules.validateCustomWeapon({ base: 'Dagger', extraDamage: [1, 2, 3, 4].map(() => ({ dice: '1d4', type: 'Fire' })) }), /up to 3/);

  const owner = createPlayer();
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Iskra', 'Human', 'Rogue', '', 1, 0, 'alive', 0, ?)
  `).run(owner, JSON.stringify({ abilities: { str: { score: 10 }, dex: { score: 16 } }, weaponProficiencies: ['Simple weapons', 'Martial weapons'] })).lastInsertRowid);
  const asOwner = { id, player_id: owner, is_admin: false };
  const add = params => db.changeCharacterInventory({ ...asOwner, action: 'add', params });
  add({ name: 'Ember Fang', weapon: { damage: '1d6', damageType: 'Piercing', ability: 'finesse', extraDamage: [{ dice: '1d4', type: 'Fire' }] } });
  add({ name: 'Storm Blade', weapon: { base: 'Longsword', extraDamage: [{ dice: '1d6', type: 'Lightning' }, { dice: '2', type: 'Thunder' }] } });

  const attacks = db.getCharacterCombat(asOwner).attacks;
  const fang = attacks.find(attack => attack.name === 'Ember Fang');
  assert.equal(fang.damage, '1d6+3 Piercing + 1d4 Fire');
  assert.equal(fang.sneakAttack.damage, '1d6+3+1d6 Piercing + 1d4 Fire', 'Sneak Attack keeps the fire');
  const blade = attacks.find(attack => attack.name === 'Storm Blade');
  assert.equal(blade.damage, '1d8 Slashing + 1d6 Lightning + 2 Thunder (1d10+1d6+2 two-handed)');

  const options = [...db.rollOptions(db.getCharacterById(id)).values()];
  const fangRoll = options.find(option => option.label === 'Ember Fang damage (Piercing + Fire)');
  assert.equal(fangRoll.formula, '1d6+3+1d4');
  assert.ok(fangRoll.parts.some(part => part.label === '1d4 Fire'));
  assert.equal(options.find(option => option.label === 'Ember Fang damage + Sneak Attack (Piercing + Fire)').formula, '1d6+3+1d6+1d4');
  assert.equal(options.find(option => option.label === 'Storm Blade damage (Slashing + Lightning + Thunder)').formula, '1d8+1d6+2');
  assert.equal(options.find(option => option.label === 'Storm Blade damage, two-handed (Slashing + Lightning + Thunder)').formula, '1d10+1d6+2');
  assert.equal(rules.validateCustomWeapon({ base: 'Dagger' }).extraDamage, undefined, 'none stored when there is none');
});
