const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const abilities = scores => Object.fromEntries(Object.entries({ str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10, ...scores })
  .map(([key, score]) => [key, { score }]));
const attack = (result, name) => result.attacks.find(entry => entry.name === name);

test('Sneak Attack: a second damage roll for Finesse and ranged weapons', () => {
  const sheetData = {
    abilities: abilities({ dex: 16 }), weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    inventory: [{ name: 'Rapier', quantity: 1 }, { name: 'Shortbow', quantity: 1 }, { name: 'Club', quantity: 1 }]
  };
  const result = rules.calculateCombat({ classes: [{ className: 'Rogue', level: 5 }], species: 'Human', sheetData });
  assert.deepEqual(attack(result, 'Rapier').sneakAttack, { dice: '3d6', damage: '1d8+3+3d6 Piercing' });
  assert.deepEqual(attack(result, 'Shortbow').sneakAttack, { dice: '3d6', damage: '1d6+3+3d6 Piercing' });
  assert.equal(attack(result, 'Club').sneakAttack, null);
  const fighter = rules.calculateCombat({ classes: [{ className: 'Fighter', level: 5 }], species: 'Human', sheetData });
  assert.equal(attack(fighter, 'Rapier').sneakAttack, null);
});

test('what buff spells add: AC, attack and damage, dice', () => {
  const base = { abilities: abilities({ str: 16, dex: 14 }), weaponProficiencies: ['Simple weapons', 'Martial weapons'], inventory: [{ name: 'Longsword', quantity: 1 }] };
  const withSpells = (...spells) => rules.calculateCombat({
    classes: [{ className: 'Fighter', level: 1 }], species: 'Human',
    sheetData: { ...base, spellEffects: spells.map(([spell, slotLevel = 1]) => ({ id: spell, spell, slotLevel, casterId: 1, casterName: 'Mira' })) }
  });
  assert.equal(withSpells().armorClass.value, 12);
  assert.equal(withSpells(['Shield of Faith']).armorClass.value, 14);
  assert.equal(withSpells(['Mage Armor']).armorClass.value, 15, '13 + DEX');
  assert.equal(withSpells(['Barkskin', 2]).armorClass.value, 17);
  assert.equal(withSpells(['Barkskin', 2], ['Shield of Faith']).armorClass.value, 17, 'Barkskin is a floor');
  assert.equal(attack(withSpells(['Magic Weapon', 3]), 'Longsword').attackBonus, '+7', 'STR +3, PB +2, Magic Weapon +2');
  assert.equal(attack(withSpells(['Magic Weapon', 3]), 'Longsword').damage, '1d8+5 Slashing (1d10+5 two-handed)');
  assert.equal(attack(withSpells(['Divine Favor']), 'Longsword').damage, '1d8+3+1d4 Slashing (1d10+3+1d4 two-handed)');
  assert.equal(attack(withSpells(['Bless']), 'Longsword').hitDice, '+1d4');
  assert.equal(attack(withSpells(['Bless'], ['Bless', 2]), 'Longsword').hitDice, '+1d4', 'the same spell twice does not stack');
});

test('a buff cast on a party member: rolls follow it, and it ends with the Concentration', () => {
  const dm = createPlayer('admin');
  const ola = createPlayer();
  const tom = createPlayer();
  const add = (owner, name, cls, sub, sheet) => {
    const id = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
      VALUES (?, ?, 'Human', ?, ?, 3, 900, 'alive', 0, ?)`).run(owner, name, cls, sub, JSON.stringify(sheet)).lastInsertRowid);
    db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level) VALUES (?, ?, ?, 3)').run(id, cls, sub);
    return id;
  };
  const mira = add(ola, 'Mira', 'Cleric', 'Life Domain', { abilities: abilities({}), savingProficiencies: ['wis', 'cha'] });
  const kael = add(tom, 'Kael', 'Fighter', 'Champion', {
    abilities: abilities({ str: 16 }), savingProficiencies: ['str', 'con'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'], inventory: [{ name: 'Longsword', quantity: 1 }]
  });
  const stranger = add(tom, 'Brin', 'Rogue', '', { abilities: abilities({}) });
  const asMira = { id: mira, player_id: ola, is_admin: false };
  db.chooseCharacterSpells({ ...asMira, source: 'Cleric', request: { cantrips: ['Guidance', 'Light', 'Thaumaturgy'], prepared: ['Shield of Faith', 'Guiding Bolt', 'Healing Word', 'Command'] } });
  const adventureId = db.startAdventure({ title: 'Wolves', dmPlayerId: dm });
  db.setPartyMember({ adventureId, user: { id: dm, role: 'admin' }, characterId: mira, inParty: true });
  db.setPartyMember({ adventureId, user: { id: dm, role: 'admin' }, characterId: kael, inParty: true });

  assert.deepEqual(db.getCharacterSpells(asMira).buffTargets.map(target => target.name), ['Mira', 'Kael']);
  const roll = (id, key) => db.rollOptions(db.getCharacterById(id)).get(key).formula;
  const longsword = () => [...db.rollOptions(db.getCharacterById(kael)).values()].find(option => option.label === 'Longsword attack').formula;
  assert.equal(longsword(), '1d20+5');

  assert.throws(() => db.castCharacterSpell({ ...asMira, request: { source: 'Cleric', spell: 'Bless', slotLevel: 1, targets: [stranger] } }), /running adventure with you/);
  assert.throws(() => db.castCharacterSpell({ ...asMira, request: { source: 'Cleric', spell: 'Shield of Faith', slotLevel: 1, targets: [mira, kael] } }), /can target 1 creature/);

  const cast = db.castCharacterSpell({ ...asMira, request: { source: 'Cleric', spell: 'Bless', slotLevel: 1, targets: [mira, kael] } });
  assert.deepEqual(cast.targets, ['Mira', 'Kael']);
  assert.equal(longsword(), '1d20+5+1d4');
  assert.equal(roll(kael, 'save:str'), '1d20+5+1d4');
  assert.equal(roll(mira, 'save:wis'), '1d20+5+1d4');
  const kaelSheet = () => JSON.parse(db.getCharacterById(kael).sheet_data);
  assert.deepEqual(db.spellEffectsView(kaelSheet()).map(effect => [effect.spell, effect.casterName, effect.concentration]), [['Bless', 'Mira', true]]);

  // A new Concentration spell ends Bless on everyone.
  db.castCharacterSpell({ ...asMira, request: { source: 'Cleric', spell: 'Shield of Faith', slotLevel: 1, targets: [kael] } });
  db.pruneSpellEffects();
  assert.equal(longsword(), '1d20+5');
  assert.deepEqual(kaelSheet().spellEffects.map(entry => entry.spell), ['Shield of Faith']);
  assert.equal(db.buildCharacterCombat(db.getCharacterById(kael), kaelSheet()).armorClass.value, 10 + 2);

  // Ending Concentration ends it too (even before the tidy-up runs).
  db.endCharacterConcentration(asMira);
  assert.equal(db.buildCharacterCombat(db.getCharacterById(kael), kaelSheet()).armorClass.value, 10);
  db.pruneSpellEffects();
  assert.deepEqual(kaelSheet().spellEffects, []);

  // The target (or the caster) can end one; a stranger can't.
  db.castCharacterSpell({ ...asMira, request: { source: 'Cleric', spell: 'Bless', slotLevel: 1, targets: [kael] } });
  const effectId = kaelSheet().spellEffects[0].id;
  assert.throws(() => db.endSpellEffect({ characterId: kael, effectId, user: { id: createPlayer() } }), /Forbidden/);
  assert.equal(db.endSpellEffect({ characterId: kael, effectId, user: { id: tom } }).spell, 'Bless');
  assert.equal(longsword(), '1d20+5');

  // Rests: a Short Rest ends the 1-hour spells, a Long Rest all of them.
  const sheet = { spellEffects: [
    { id: 'a', spell: 'Mage Armor', ends: 'long', casterId: mira },
    { id: 'b', spell: 'Longstrider', ends: 'short', casterId: mira }
  ] };
  assert.deepEqual(db.spellEffectsAfterRest(sheet, 'shortRest').spellEffects.map(entry => entry.spell), ['Mage Armor']);
  assert.deepEqual(db.spellEffectsAfterRest(sheet, 'longRest').spellEffects, []);
});
