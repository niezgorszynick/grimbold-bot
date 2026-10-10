const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const abilities = scores => Object.fromEntries(Object.entries({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...scores })
  .map(([key, score]) => [key, { score }]));
const row = (name, extra = {}) => ({ name, quantity: 1, ...extra });
const combat = (classes, sheetData) => rules.calculateCombat({ classes, species: 'Human', sheetData });
const attack = (result, name) => result.attacks.find(entry => entry.name === name);
const fighter = level => [{ className: 'Fighter', subclassName: 'Champion', level }];

test('gear is recognised by name, however the shop or a book writes it', () => {
  const kind = name => {
    const gear = rules.identifyGear(name);
    return gear && `${gear.type}:${gear.name}`;
  };
  assert.equal(kind('Chain Mail'), 'armor:Chain Mail');
  assert.equal(kind('Leather'), 'armor:Leather Armor');
  assert.equal(kind('Leather Pouch'), null);
  assert.equal(kind('Javelins'), 'weapon:Javelin');
  assert.equal(kind('Crossbow, Light'), 'weapon:Light Crossbow');
  assert.equal(kind('Arcane Focus (Quarterstaff)'), 'weapon:Quarterstaff');
  assert.equal(kind('+1 Morningstar'), 'weapon:Morningstar');
  assert.equal(kind('Mithral Splint'), 'armor:Splint Armor');
  assert.equal(kind('Shield'), 'shield:Shield');
  assert.equal(kind("Explorer's Pack"), null);
});

test('worn armor, shield and Defense set Armor Class; the creation armor is worn by default', () => {
  const sheet = {
    abilities: abilities({ str: 16, dex: 14 }),
    armorTraining: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    armorClassSource: 'Chain Mail + Shield',
    inventory: [row('Chain Mail'), row('Shield'), row('Leather Armor'), row('Longsword')],
    fightingStyles: [{ name: 'Defense', source: 'Fighter' }]
  };
  const result = combat(fighter(3), sheet);
  assert.equal(result.armorClass.value, 16 + 2 + 1);
  assert.deepEqual(result.armorClass.parts.map(part => part.label), ['Chain Mail', 'Defense', 'Shield']);
  assert.ok(result.armorClass.notes.some(note => /Stealth/.test(note)));

  // Wearing the leather takes off the chain mail.
  const leather = rules.setWorn(sheet, { from: 'inventory', index: 2 }, true);
  assert.deepEqual(leather.inventory.map(item => item.equipped), [false, true, true, true]);
  assert.equal(combat(fighter(3), leather).armorClass.value, 11 + 2 + 1 + 2);

  // No armor and no Shield: 10 + DEX.
  const bare = rules.setWorn(rules.setWorn(leather, { from: 'inventory', index: 2 }, false), { from: 'inventory', index: 1 }, false);
  assert.equal(combat(fighter(3), bare).armorClass.value, 12);
});

test('medium armor caps DEX; untrained armor still counts but untrained shields do not', () => {
  const sheet = {
    abilities: abilities({ dex: 18, str: 8 }),
    armorTraining: ['Light armor'],
    inventory: [row('Half Plate Armor', { equipped: true }), row('Shield', { equipped: true })]
  };
  const result = combat([{ className: 'Rogue', level: 3 }], sheet);
  assert.equal(result.armorClass.value, 15 + 2);
  assert.ok(result.armorClass.notes.some(note => /Not trained with medium armor/.test(note)));
  assert.ok(result.armorClass.notes.some(note => /No Shield training/.test(note)));

  const plate = combat(fighter(1), { abilities: abilities({ str: 13 }), armorTraining: ['Heavy armor'], inventory: [row('Plate Armor', { equipped: true })] });
  assert.equal(plate.armorClass.value, 18);
  assert.ok(plate.armorClass.notes.some(note => /needs Strength 15: Speed −10 ft/.test(note)));
});

test('Unarmored Defense for Barbarians and Monks', () => {
  const scores = abilities({ dex: 14, con: 16, wis: 16 });
  const barbarian = combat([{ className: 'Barbarian', level: 3 }], { abilities: scores, armorTraining: ['Shields'], inventory: [row('Shield', { equipped: true })] });
  assert.equal(barbarian.armorClass.value, 10 + 2 + 3 + 2);
  assert.equal(barbarian.armorClass.parts[0].label, 'Unarmored Defense');

  const monk = combat([{ className: 'Monk', level: 3 }], { abilities: scores, inventory: [] });
  assert.equal(monk.armorClass.value, 10 + 2 + 3);
  const shielded = combat([{ className: 'Monk', level: 3 }], { abilities: scores, armorTraining: ['Shields'], inventory: [row('Shield', { equipped: true })] });
  assert.equal(shielded.armorClass.value, 10 + 2 + 2, 'a Shield ends Monk Unarmored Defense');
});

test('weapon attacks use the right ability, proficiency and properties', () => {
  const sheet = {
    abilities: abilities({ str: 16, dex: 18 }),
    weaponProficiencies: ['Simple weapons', 'Martial weapons with the Finesse or Light property'],
    inventory: [row('Rapier'), row('Longsword'), row('Shortbow'), row('Javelin', { quantity: 4 }), row('Dagger', { equipped: false })]
  };
  const result = combat([{ className: 'Rogue', subclassName: 'Thief', level: 3 }], sheet);
  assert.deepEqual(result.attacks.map(entry => entry.name), ['Rapier', 'Longsword', 'Shortbow', 'Javelin', 'Unarmed Strike']);
  const rapier = attack(result, 'Rapier');
  assert.equal(rapier.attackBonus, '+6', 'Finesse uses DEX +4, plus proficiency +2');
  assert.equal(rapier.damage, '1d8+4 Piercing');
  assert.match(rapier.notes[0], /^DEX · Finesse/);
  assert.ok(rapier.notes.includes('Mastery: Vex'), 'Rogues have Weapon Mastery');
  const longsword = attack(result, 'Longsword');
  assert.equal(longsword.attackBonus, '+3', 'not proficient: STR only');
  assert.equal(longsword.damage, '1d8+3 Slashing (1d10+3 two-handed)');
  assert.ok(longsword.notes.includes('Not proficient: no Proficiency Bonus'));
  assert.equal(attack(result, 'Shortbow').attackBonus, '+6');
  assert.match(attack(result, 'Javelin').notes[0], /Thrown 30\/120/);
  assert.equal(attack(result, 'Unarmed Strike').damage, '4 Bludgeoning');
  assert.equal(attack(result, 'Unarmed Strike').attackBonus, '+5');
});

test('fighting styles: Archery adds to hit; Dueling and Great Weapon Fighting are noted', () => {
  const sheet = {
    abilities: abilities({ str: 16, dex: 14 }),
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    inventory: [row('Longbow'), row('Greatsword'), row('Longsword')],
    fightingStyles: [{ name: 'Archery', source: 'Fighter' }],
    levelHistory: [{ level: 4, fightingStyle: { name: 'Dueling' } }, { level: 5, feat: { name: 'Great Weapon Fighting' } }]
  };
  const result = combat(fighter(5), sheet);
  assert.equal(attack(result, 'Longbow').attackBonus, '+7', 'DEX +2, proficiency +3, Archery +2');
  assert.ok(attack(result, 'Longbow').notes.includes('Archery +2'));
  assert.ok(attack(result, 'Greatsword').notes.some(note => /Great Weapon Fighting/.test(note)));
  assert.ok(attack(result, 'Longsword').notes.some(note => /Dueling/.test(note)));
  assert.ok(!attack(result, 'Greatsword').notes.some(note => /Dueling/.test(note)));
});

test('Monks use Martial Arts for monk weapons and unarmed strikes', () => {
  const sheet = { abilities: abilities({ str: 10, dex: 16, wis: 14 }), weaponProficiencies: ['Simple weapons', 'Martial weapons with the Light property'], inventory: [row('Club'), row('Shortsword')] };
  const result = combat([{ className: 'Monk', level: 5 }], sheet);
  assert.equal(attack(result, 'Club').damage, '1d8+3 Bludgeoning', 'Martial Arts die d8 at level 5, DEX');
  assert.equal(attack(result, 'Unarmed Strike').damage, '1d8+3 Bludgeoning');
  assert.equal(attack(result, 'Unarmed Strike').attackBonus, '+6');
  assert.ok(attack(result, 'Unarmed Strike').notes.includes('Martial Arts'));
});

test('Unarmed Fighting and Tavern Brawler improve unarmed strikes', () => {
  const base = { abilities: abilities({ str: 14 }), weaponProficiencies: ['Simple weapons'], fightingStyles: [{ name: 'Unarmed Fighting', source: 'Fighter' }] };
  assert.equal(attack(combat(fighter(1), { ...base, inventory: [] }), 'Unarmed Strike').damage, '1d8+2 Bludgeoning');
  assert.equal(attack(combat(fighter(1), { ...base, inventory: [row('Club')] }), 'Unarmed Strike').damage, '1d6+2 Bludgeoning');
  const brawler = combat(fighter(1), { abilities: abilities({ str: 14 }), originFeats: [{ name: 'Tavern Brawler' }], inventory: [] });
  assert.equal(attack(brawler, 'Unarmed Strike').damage, '1d4+2 Bludgeoning');
});

test('magic armor, shields, weapons and protection items', () => {
  let sheet = {
    abilities: abilities({ str: 16, dex: 12 }),
    armorTraining: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    inventory: [row('Chain Mail', { equipped: true }), row('Longsword', { equipped: false })]
  };
  for (const name of ['+1 Chain Mail', 'Shield +2', '+2 Longsword', 'Cloak of Protection', 'Bracers of Defense', 'Frost Brand (Longsword)']) {
    sheet = { ...sheet, magicItems: rules.grantMagicItem(sheet, { name }) };
  }
  const uid = name => sheet.magicItems.find(entry => rules.magicItemDisplayName(entry) === name).uid;
  const owner = () => ({ classes: fighter(5), species: 'Human', sheetData: sheet, spellcaster: false });
  const change = (action, name) => { sheet = { ...sheet, magicItems: rules.changeMagicItem(owner(), action, { uid: uid(name) }).magicItems }; };
  const wear = name => { sheet = rules.setWorn(sheet, { from: 'magic', uid: uid(name) }, true); };

  wear('+1 Chain Mail');
  assert.equal(sheet.inventory[0].equipped, false, 'the plain chain mail comes off');
  wear('Shield +2');
  wear('+2 Longsword');
  change('attune', 'Cloak of Protection');
  change('attune', 'Bracers of Defense');
  let result = combat(fighter(5), sheet);
  assert.equal(result.armorClass.value, 16 + 1 + 2 + 2 + 1);
  assert.ok(result.armorClass.notes.some(note => /Bracers of Defense work only/.test(note)));
  const sword = attack(result, '+2 Longsword');
  assert.equal(sword.attackBonus, '+8', 'STR +3, proficiency +3, magic +2');
  assert.equal(sword.damage, '1d8+5 Slashing (1d10+5 two-handed)');

  // Frost Brand needs attunement; it is listed as a longsword either way.
  wear('Frost Brand (Longsword)');
  assert.equal(attack(combat(fighter(5), sheet), 'Frost Brand (Longsword)').weapon, 'Longsword');

  // Without armor or shield the Bracers count.
  sheet = rules.setWorn(rules.setWorn(sheet, { from: 'magic', uid: uid('+1 Chain Mail') }, false), { from: 'magic', uid: uid('Shield +2') }, false);
  result = combat(fighter(5), sheet);
  assert.equal(result.armorClass.value, 10 + 1 + 1 + 2);
  assert.ok(sheet.magicItems.find(entry => entry.uid === uid('Cloak of Protection')).attuned, 'taking things off keeps attunement');
});

function addCharacter(playerId, sheetData, columns = {}) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Hal', 'Human', ?, '', 3, 0, 'alive', 0, ?)
  `).run(playerId, columns.className || 'Fighter', JSON.stringify(sheetData)).lastInsertRowid);
}

test('older characters keep a typed-in AC until they wear armor', () => {
  const player = createPlayer();
  const id = addCharacter(player, { armorClass: 17, abilities: abilities({ dex: 12 }), inventory: [row('Breastplate', { equipped: false })] });
  const who = { id, player_id: player, is_admin: false };
  let view = db.getCharacterCombat(who);
  assert.equal(view.armorClass.manual, true);
  assert.equal(view.armorClass.value, 17);

  db.changeCharacterInventory({ ...who, action: 'wear', params: { index: 0, name: 'Breastplate', worn: true } });
  view = db.getCharacterCombat(who);
  assert.equal(view.armorClass.manual, false);
  assert.equal(view.armorClass.value, 14 + 1);
  assert.equal(JSON.parse(db.getCharacterById(id).sheet_data).armorClass, 15, 'the stored AC follows');

  view = db.setCharacterAcAdjustment({ ...who, value: 2 });
  assert.equal(view.armorClass.value, 17);
  assert.throws(() => db.setCharacterAcAdjustment({ ...who, value: 50 }), /from -10 to 10/);
  assert.throws(() => db.changeCharacterInventory({ ...who, action: 'wear', params: { index: 0, name: 'Shield', worn: true } }), /list changed/);
});
