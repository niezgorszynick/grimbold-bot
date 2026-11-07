// A High Elf Archfey Warlock with Pact of the Blade, Agonizing Blast and Lucky
// (built like Ev): what the sheet shows matches D&D Beyond.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

function buildEv() {
  const built = rules.buildStartingCharacter({
    name: 'Ev', species: 'Elf', size: 'Medium', speciesOption: 'High Elf', speciesSpellAbility: 'cha',
    className: 'Warlock', subclass: 'Archfey Patron', background: 'Wayfarer', generationMethod: 'Point Buy',
    baseScores: { str: 8, dex: 13, con: 14, int: 10, wis: 12, cha: 15 }, backgroundBonuses: { cha: 2, dex: 1 },
    speciesSkills: ['Perception'], classSkills: ['Deception', 'Intimidation'],
    languages: ['Common Sign Language', 'Gnomish'], classEquipment: 'A', backgroundEquipment: 'B', backgroundTool: "Thieves' Tools"
  });
  built.sheetData.invocations = [{ name: 'Agonizing Blast', cantrip: 'Eldritch Blast' }, { name: 'Fiendish Vigor' }, { name: 'Pact of the Blade' }];
  built.sheetData.spellcasting = { classes: { Warlock: { cantrips: ['Eldritch Blast', 'True Strike'], prepared: ['Hex', 'Armor of Agathys'], spellbook: [] } } };
  return built;
}
const classes = [{ className: 'Warlock', subclassName: 'Archfey Patron', level: 3 }];

test('Eldritch Blast with Agonizing Blast, Luck Points, and Trance', () => {
  const { sheetData } = buildEv();
  const combat = rules.calculateCombat({ classes, species: 'Elf', sheetData });
  const blast = combat.attacks.find(attack => attack.name === 'Eldritch Blast');
  assert.deepEqual([blast.attackBonus, blast.damage], ['+5', '1d10+3 Force']);
  assert.match(blast.notes.join(' '), /1 beam/);
  const noAgony = rules.calculateCombat({ classes, species: 'Elf', sheetData: { ...sheetData, invocations: [] } }).attacks.find(attack => attack.name === 'Eldritch Blast');
  assert.equal(noAgony.damage, '1d10 Force');
  const atEleven = rules.calculateCombat({ classes: [{ ...classes[0], level: 11 }], species: 'Elf', sheetData }).attacks.find(attack => attack.name === 'Eldritch Blast');
  assert.match(atEleven.notes[0], /3 beams/);
  assert.equal(rules.calculateCombat({ classes, species: 'Elf', sheetData: { ...sheetData, spellcasting: {} } }).attacks.some(attack => attack.name === 'Eldritch Blast'), false);

  const context = rules.deriveVitalsContext({ species: 'Elf', sheetData, classRows: classes });
  const luck = context.resources.find(resource => resource.key === 'luckPoints');
  assert.deepEqual([luck.max, luck.recovery], [2, 'long']);
  assert.ok(context.defenses.some(item => item.kind === 'immunity' && item.text === 'Magical sleep'));
});

test('Pact of the Blade: the conjured weapon attacks with Charisma, proficient, in the damage type chosen', () => {
  const player = createPlayer();
  const id = db.insertStartingCharacter(player, buildEv());
  const who = { id, player_id: player, is_admin: false };
  assert.equal(db.getCharacterCombat(who).pactWeapon.current, null);
  assert.throws(() => db.setCharacterPactWeapon({ ...who, pactWeapon: { weapon: 'Longbow' } }), /melee weapon/);
  assert.throws(() => db.setCharacterPactWeapon({ ...who, pactWeapon: { weapon: 'Rapier', damageType: 'Fire' } }), /Necrotic, Psychic or Radiant/);
  const view = db.setCharacterPactWeapon({ ...who, pactWeapon: { weapon: 'Rapier', name: 'Fog blade', damageType: 'Radiant' } });
  const blade = view.attacks[0];
  assert.deepEqual([blade.name, blade.weapon, blade.attackBonus, blade.damage], ['Fog blade', 'Rapier', '+5', '1d8+3 Radiant']);
  assert.match(blade.notes[0], /^CHA/);
  const greataxe = db.setCharacterPactWeapon({ ...who, pactWeapon: { weapon: 'Greataxe', name: '' } }).attacks[0];
  assert.deepEqual([greataxe.name, greataxe.attackBonus, greataxe.damage], ['Greataxe', '+5', '1d12+3 Slashing'], 'proficient although Warlocks have no Martial weapons');

  // Rolled from the sheet.
  const roll = db.rollForCharacter({ characterId: id, user: { id: player, role: 'player' }, request: { roll: 'attack:0:damage' } });
  assert.match(roll.label, /Greataxe damage \(Slashing\)/);
  db.setCharacterPactWeapon({ ...who, pactWeapon: null });
  assert.equal(db.getCharacterCombat(who).attacks.some(attack => attack.name === 'Greataxe'), false);

  const sheet = JSON.parse(db.getCharacterById(id).sheet_data);
  db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify({ ...sheet, invocations: [] }), id);
  assert.equal(db.getCharacterCombat(who).pactWeapon, null);
  assert.throws(() => db.setCharacterPactWeapon({ ...who, pactWeapon: { weapon: 'Rapier' } }), /Pact of the Blade/);
});

test('Temporary Hit Points from spells: Armor of Agathys, and False Life maximized by Fiendish Vigor', () => {
  const player = createPlayer();
  const id = db.insertStartingCharacter(player, buildEv());
  const who = { id, player_id: player, is_admin: false };
  const temp = () => JSON.parse(db.getCharacterById(id).sheet_data).hpTemp;

  // A level 2 Pact slot at Warlock 3: 10 Temporary HP.
  let cast = db.castCharacterSpell({ ...who, request: { source: 'Warlock', spell: 'Armor of Agathys', pact: true } });
  assert.equal(cast.tempHp.rolled, 10);
  assert.equal(temp(), 10);

  // Fiendish Vigor: no slot, and the dice roll their highest (2d4+4 = 12).
  cast = db.castCharacterSpell({ ...who, request: { source: 'Invocation Spells', spell: 'False Life', free: true } });
  assert.deepEqual([cast.tempHp.rolled, cast.tempHp.maximized, cast.tempHp.kept], [12, true, 12]);
  assert.equal(temp(), 12);

  // They don't stack: a smaller amount leaves the higher one.
  cast = db.castCharacterSpell({ ...who, request: { source: 'Warlock', spell: 'Armor of Agathys', pact: true } });
  assert.deepEqual([cast.tempHp.rolled, cast.tempHp.hadMore, temp()], [10, true, 12]);
  assert.equal(rules.spellTempHp('False Life', 3).formula, '2d4+14', '+5 per slot level above 1');
});
