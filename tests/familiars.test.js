const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'familiars');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const abilities = scores => Object.fromEntries(Object.entries({ str: 8, dex: 14, con: 12, int: 10, wis: 12, cha: 16, ...scores })
  .map(([key, score]) => [key, { score }]));

function addCharacter(owner, name, className, level, sheet = {}) {
  const id = Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', ?, ?, 0, 'alive', 0, ?)
  `).run(owner, name, className, level, JSON.stringify({ abilities: abilities(), ...sheet })).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, class_level, is_primary) VALUES (?, ?, ?, 1)').run(id, className, level);
  return id;
}

const chain = { invocations: [{ name: 'Pact of the Chain' }] };

test('who has a familiar, and which forms they may choose', () => {
  assert.equal(rules.familiarRules({ classes: [{ className: 'Fighter', level: 3 }], sheetData: {} }), null);
  assert.deepEqual(rules.familiarRules({ classes: [{ className: 'Fighter', level: 3 }], sheetData: {} }, { dmGranted: true }).ways, ['granted by the DM']);

  const warlock = rules.familiarRules({ classes: [{ className: 'Warlock', level: 3 }], sheetData: chain });
  assert.ok(warlock.ways.includes('Pact of the Chain'));
  assert.equal(warlock.chain, true);
  assert.equal(rules.familiarFormProblem('Imp', warlock), null, 'a Chain form');
  assert.match(rules.familiarFormProblem('Practice Bear', warlock), /not a Beast of Challenge Rating 0/);

  const druid = rules.familiarRules({ classes: [{ className: 'Druid', level: 2 }], sheetData: {} });
  assert.equal(druid.wildCompanionOnly, true);
  assert.match(rules.familiarFormProblem('Imp', druid), /Pact of the Chain/);
  assert.equal(rules.familiarFormProblem('Practice Bear', druid, { anyForm: true }), null, 'the DM allows any statblock');
  assert.deepEqual(rules.familiarForms(druid).map(form => form.name), ['Practice Owlet']);
  assert.equal(rules.familiarBlock('Practice Owlet', druid, { creatureType: 'Fiend' }).creatureType, 'Fey', 'Wild Companion is Fey');

  // Familiar Friend's HP and the Arcana Unleashed feats.
  const friend = rules.familiarRules({
    classes: [{ className: 'Wizard', level: 4 }],
    sheetData: { originFeats: ['Familiar Friend'], levelHistory: [{ feat: 'Elemental Familiar' }, { feat: 'Warlike Familiar' }] }
  }, { dmGranted: true });
  const block = rules.familiarBlock('Practice Owlet', friend, { name: 'Hoot', creatureType: 'Celestial', options: { elementalType: 'Cold' } });
  assert.equal(block.hpMax, 1 + 2 * 4);
  assert.equal(block.resistances, 'Cold');
  assert.equal(block.typeLine, 'Tiny Celestial (Practice Owlet)');
  assert.ok(block.reactions.some(entry => entry.name.startsWith('Energy Pulse') && /2d4 Cold/.test(entry.text)));
  assert.ok(block.reactions.some(entry => entry.name.startsWith('Intercept Attack') && /\+2/.test(entry.text)));
  assert.equal(block.canAttack, false);

  const master = rules.familiarRules({ classes: [{ className: 'Warlock', level: 5 }], sheetData: { invocations: [...chain.invocations, { name: 'Investment of the Chain Master' }] } });
  assert.equal(rules.familiarBlock('Practice Owlet', master, { options: { chainMasterMove: 'swim' } }).speed, '5 ft., Fly 60 ft., Swim 40 ft.');
  assert.equal(rules.familiarBlock('Imp', master, { options: { chainMasterMove: 'fly' } }).speed, '20 ft., Fly 40 ft.', 'no slower than it was');
});

test('the familiar on the sheet: summon, HP, dismiss, dice, and the fight', () => {
  const dm = createPlayer();
  const playerId = createPlayer();
  const admin = { id: createPlayer('admin'), role: 'admin' };
  const player = { id: playerId, role: 'player' };
  const warlock = addCharacter(playerId, 'Vesper', 'Warlock', 3, chain);

  let view = db.getCharacterFamiliar({ id: warlock, user: player });
  assert.equal(view.available, true);
  assert.equal(view.status, 'gone');
  assert.throws(() => db.changeCharacterFamiliar({ id: warlock, user: player, change: { action: 'summon', form: 'Practice Bear' } }), /not a Beast/);
  assert.throws(() => db.changeCharacterFamiliar({ id: warlock, user: player, change: { action: 'grant', on: true } }), /Forbidden/);
  let result = db.changeCharacterFamiliar({ id: warlock, user: player, change: { action: 'summon', form: 'Imp', name: 'Pip', creatureType: 'Fiend' } });
  assert.deepEqual(result.events, ['summoned']);
  assert.deepEqual(result.familiar.hp, { current: 21, max: 21, temp: 0 });
  assert.equal(result.familiar.block.canAttack, true, 'Pact of the Chain');

  // Its rolls are on the owner's dice, its attacks too (Pact of the Chain).
  const roll = db.rollForCharacter({ characterId: warlock, user: player, request: { roll: 'familiar:save:dex' } });
  assert.match(roll.label, /^Pip: Dexterity save/);
  assert.ok(db.rollForCharacter({ characterId: warlock, user: player, request: { roll: 'familiar:actions:0:hit' } }));

  // The adventure table shows it under its owner; its initiative is its own row.
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('fam-dm', dm);
  const { adventure } = db.createAdventureFromThread({ threadId: 'fam-thread', title: 'Familiar ways', ownerDiscordId: 'fam-dm' });
  const asDm = { adventureId: adventure.id, user: { id: dm, role: 'player' } };
  db.setPartyMember({ ...asDm, characterId: warlock, inParty: true });
  let table = db.getAdventureTable(asDm);
  assert.equal(table.party[0].familiar.name, 'Pip');
  const encounterId = db.createEncounter({ ...asDm, name: 'Crypt' }).encounters.list[0].id;
  db.addEncounterMonster({ ...asDm, encounterId, monster: 'Practice Bear' });
  db.runEncounter({ ...asDm, encounterId });
  db.rollForCharacter({ characterId: warlock, user: player, request: { roll: 'familiar:initiative' } });
  table = db.getAdventureTable(asDm);
  let pip = table.encounters.list[0].combatants.find(combatant => combatant.kind === 'familiar');
  assert.equal(pip.label, 'Pip');
  assert.equal(pip.ownerId, warlock);
  assert.ok(Number.isInteger(pip.initiative));
  assert.equal(pip.xp, 0, 'an ally is worth no XP');
  assert.equal(table.encounters.list[0].combatants.some(combatant => combatant.kind === 'pc'), false, "the warlock's own roll is separate");
  assert.ok(table.encounters.statblocks[pip.monster], 'its statblock for the DM');

  // The DM damages it in the fight; its HP are the familiar's own.
  db.changeCombatantHp({ ...asDm, combatantId: pip.id, action: 'damage', amount: 5 });
  assert.equal(db.getCharacterFamiliar({ id: warlock, user: player }).hp.current, 16);
  assert.throws(() => db.changeCharacterFamiliar({ id: warlock, user: asDm.user, change: { action: 'summon', form: 'Imp' } }), /Forbidden/);
  result = db.changeCharacterFamiliar({ id: warlock, user: asDm.user, change: { action: 'damage', amount: 30 } });
  assert.deepEqual(result.events, ['vanished']);
  assert.equal(result.familiar.status, 'gone');
  table = db.getAdventureTable(asDm);
  assert.equal(table.encounters.list[0].combatants.some(combatant => combatant.kind === 'familiar'), false, 'at 0 HP it leaves the fight');
  assert.equal(table.party[0].familiar, null);
  assert.throws(() => db.rollForCharacter({ characterId: warlock, user: player, request: { roll: 'familiar:initiative' } }), /not on this character sheet/);

  // Back again, dismissed and recalled; the whole party joining brings it along.
  db.changeCharacterFamiliar({ id: warlock, user: player, change: { action: 'summon' } });
  assert.deepEqual(db.changeCharacterFamiliar({ id: warlock, user: player, change: { action: 'dismiss' } }).events, ['dismissed']);
  assert.throws(() => db.changeCharacterFamiliar({ id: warlock, user: player, change: { action: 'damage', amount: 1 } }), /not here/);
  db.changeCharacterFamiliar({ id: warlock, user: player, change: { action: 'recall' } });
  table = db.addEncounterCharacters({ ...asDm, encounterId });
  assert.deepEqual(table.encounters.list[0].combatants.map(combatant => combatant.kind).sort(), ['familiar', 'monster', 'pc']);

  // Someone without Find Familiar: only by the DM's grant.
  const fighter = addCharacter(playerId, 'Brann', 'Fighter', 2);
  assert.equal(db.getCharacterFamiliar({ id: fighter, user: player }).available, false);
  db.changeCharacterFamiliar({ id: fighter, user: admin, change: { action: 'grant', on: true } });
  view = db.getCharacterFamiliar({ id: fighter, user: player });
  assert.deepEqual(view.rules.ways, ['granted by the DM']);
  assert.equal(view.canGrant, false);
});

test('a Wild Companion familiar leaves at a Long Rest', () => {
  const playerId = createPlayer();
  const druid = addCharacter(playerId, 'Moss', 'Druid', 2);
  const user = { id: playerId, role: 'player' };
  const summoned = db.changeCharacterFamiliar({ id: druid, user, change: { action: 'summon', form: 'Practice Owlet', creatureType: 'Celestial' } });
  assert.equal(summoned.familiar.creatureType, 'Fey');
  assert.equal(db.familiarAfterLongRest(db.getCharacterById(druid)), true);
  assert.equal(db.getCharacterFamiliar({ id: druid, user }).status, 'gone');
});

test('a pet for show: an admin gives it, it has no stats and stays out of fights', () => {
  const playerId = createPlayer();
  const user = { id: playerId, role: 'player' };
  const admin = { id: createPlayer('admin'), role: 'admin' };
  const fighter = addCharacter(playerId, 'Dunstan', 'Fighter', 3);
  assert.throws(() => db.changeCharacterFamiliar({ id: fighter, user, change: { action: 'setPet', name: 'Gertrude', creature: 'Ostrich' } }), /Forbidden/);
  assert.throws(() => db.changeCharacterFamiliar({ id: fighter, user: admin, change: { action: 'setPet' } }), /name or say what creature/);
  db.changeCharacterFamiliar({ id: fighter, user: admin, change: { action: 'setPet', name: 'Gertrude', creature: 'Ostrich', description: 'Pecks at buttons.' } });
  const view = db.getCharacterFamiliar({ id: fighter, user });
  assert.equal(view.available, false, 'a pet is not a familiar');
  assert.deepEqual({ ...view.pet, id: undefined }, { id: undefined, name: 'Gertrude', creature: 'Ostrich', description: 'Pecks at buttons.' });
  assert.equal([...db.rollBreakdowns({ characterId: fighter, user })].some(option => option.id.startsWith('familiar:')), false, 'no dice');
  db.changeCharacterFamiliar({ id: fighter, user: admin, change: { action: 'removePet' } });
  assert.equal(db.getCharacterFamiliar({ id: fighter, user }).pet, null);
});
