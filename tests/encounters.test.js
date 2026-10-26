const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

function addCharacter(playerId, name, level) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Human', 'Fighter', 'Champion', ?, 0, 'alive', 0, '{}')
  `).run(playerId, name, level).lastInsertRowid);
}

test('2024 XP budget per character level, and where an encounter lands', () => {
  const budget = rules.encounterBudget([3, 3, 4, 5]);
  assert.deepEqual(budget, { low: 150 + 150 + 250 + 500, moderate: 225 + 225 + 375 + 750, high: 400 + 400 + 500 + 1100 });
  assert.equal(rules.encounterDifficulty(0, budget), 'None');
  assert.equal(rules.encounterDifficulty(1050, budget), 'Low');
  assert.equal(rules.encounterDifficulty(1500, budget), 'Moderate');
  assert.equal(rules.encounterDifficulty(2400, budget), 'High');
  assert.equal(rules.encounterDifficulty(2401, budget), 'Beyond High');
  assert.equal(rules.encounterDifficulty(100, rules.encounterBudget([])), null, 'no party, no budget');
});

test('statblock dice: initiative, saves, skills, attacks and damage in the text', () => {
  const options = rules.creatureRollOptions(rules.getMonster('Practice Gazer'));
  assert.equal(options.get('initiative').formula, '1d20+6');
  assert.equal(options.get('save:con').formula, '1d20+6');
  assert.equal(options.get('check:cha').formula, '1d20-1');
  assert.equal(options.get('skill:Perception').formula, '1d20+9');
  assert.equal(options.get('actions:0:hit').formula, '1d20+5');
  assert.deepEqual([options.get('actions:0:damage:0').formula, options.get('actions:0:damage:0').label], ['2d6+1', 'Bite damage (Piercing)']);
  assert.equal(options.get('actions:2:damage:0').formula, '2d8', 'save-based ray damage');
  assert.equal(options.has('actions:3:damage:0'), false, 'no damage, no roll');
  assert.equal(rules.creatureRollOptions({ abilities: { dex: 14 } }).get('initiative').formula, '1d20+2', 'an NPC without a statblock');
});

test('encounters: the DM plans them in secret, runs them, tracks HP and rolls', () => {
  const dm = createPlayer();
  const otherDm = createPlayer('admin');
  const playerId = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('enc-dm', dm);
  const { adventure } = db.createAdventureFromThread({ threadId: 'enc-thread', title: 'The Eye Below', ownerDiscordId: 'enc-dm' });
  const asDm = { adventureId: adventure.id, user: { id: dm, role: 'player' } };
  const asOtherDm = { adventureId: adventure.id, user: { id: otherDm, role: 'admin' } };
  const asPlayer = { adventureId: adventure.id, user: { id: playerId, role: 'player' } };
  const asRoot = { adventureId: adventure.id, user: { id: 0, role: 'admin' } };
  db.setPartyMember({ ...asDm, characterId: addCharacter(playerId, 'Kael', 3), inParty: true });
  db.setPartyMember({ ...asDm, characterId: addCharacter(dm, 'Ysolde', 5), inParty: true });

  assert.throws(() => db.createEncounter({ ...asOtherDm, name: 'Peek' }), /Only this adventure's DM/);
  assert.throws(() => db.createEncounter({ ...asDm, name: ' ' }), /Give the encounter a name/);
  let table = db.createEncounter({ ...asDm, name: 'Gazer lair' });
  const encounterId = table.encounters.list[0].id;
  assert.deepEqual(table.encounters.budget, { low: 650, moderate: 975, high: 1500 });

  assert.throws(() => db.addEncounterMonster({ ...asDm, encounterId, monster: 'Practice Spirit' }), /summoned creature/);
  assert.throws(() => db.addEncounterMonster({ ...asDm, encounterId, monster: 'Nope' }), /no monster called/);
  db.addEncounterMonster({ ...asDm, encounterId, monster: 'Practice Footpad', count: 3 });
  const vex = db.saveNpc({ name: 'Vex', base_monster: 'Practice Gazer' });
  db.setAdventureNpc({ ...asDm, npcId: vex, inAdventure: true, hidden: true });
  table = db.addEncounterNpc({ ...asDm, encounterId, npcId: vex });
  assert.throws(() => db.addEncounterNpc({ ...asDm, encounterId, npcId: vex }), /already in this encounter/);

  let encounter = table.encounters.list[0];
  assert.deepEqual(encounter.combatants.map(c => c.label), ['Practice Footpad 1', 'Practice Footpad 2', 'Practice Footpad 3', 'Vex']);
  assert.equal(encounter.xp, 3 * 25 + 3900);
  assert.equal(encounter.difficulty, 'Beyond High');
  assert.equal(encounter.combatants[0].hpMax, 9);
  assert.equal(encounter.combatants[3].hpMax, 90, "the NPC's HP from its statblock");

  // Before it runs: the party sees nothing; another DM only that something is prepared.
  assert.deepEqual(db.getAdventureTable(asPlayer).encounters, { running: null, prepared: 0 });
  assert.deepEqual(db.getAdventureTable(asOtherDm).encounters, { running: null, prepared: 1 });
  assert.equal(db.getAdventureTable(asRoot).encounters.list.length, 1, 'the Root DM sees it all');

  table = db.runEncounter({ ...asDm, encounterId });
  assert.throws(() => db.runEncounter({ ...asDm, encounterId }), /already been run/);
  assert.equal(table.npcs.find(npc => npc.id === vex).hidden, false, 'running reveals its NPCs');
  assert.ok(table.encounters.statblocks['Practice Footpad'].rolls.some(roll => roll.id === 'actions:0:hit'));
  assert.ok(table.encounters.statblocks['Practice Gazer'], "the NPC's base statblock too");

  const [first, second] = table.encounters.list[0].combatants;
  db.setCombatantInitiative({ ...asDm, combatantId: second.id, initiative: 50 }); // above any roll (d20 + 6)
  assert.throws(() => db.setCombatantInitiative({ ...asDm, combatantId: second.id, initiative: 'x' }), /whole number/);
  table = db.rollEncounterInitiative({ ...asDm, encounterId });
  encounter = table.encounters.list[0];
  assert.equal(encounter.combatants[0].id, second.id, 'highest initiative first');
  assert.ok(encounter.combatants.every(c => Number.isInteger(c.initiative)));

  db.changeCombatantHp({ ...asDm, combatantId: first.id, action: 'damage', amount: 5 });
  table = db.changeCombatantHp({ ...asDm, combatantId: encounter.combatants.find(c => c.kind === 'npc').id, action: 'damage', amount: 50 });
  encounter = table.encounters.list[0];
  assert.equal(encounter.combatants.find(c => c.id === first.id).hpCurrent, 4);
  assert.equal(db.getNpc(vex, { showStats: true }).stats.hpCurrent, 40, "an NPC's HP is the NPC's own");

  // The party: names, turn order and a word for their state; no numbers.
  const seen = db.getAdventureTable(asPlayer).encounters.running;
  assert.equal(seen.name, 'Gazer lair');
  assert.deepEqual(seen.combatants.map(c => c.label), encounter.combatants.map(c => c.label));
  assert.equal(seen.combatants.find(c => c.id === first.id).condition, 'Bloodied');
  assert.deepEqual(Object.keys(seen.combatants[0]).sort(), ['characterId', 'condition', 'id', 'kind', 'label', 'npcId']);
  assert.equal(db.getAdventureTable(asPlayer).encounters.list, undefined);

  const roll = db.rollForCombatant({ ...asDm, combatantId: first.id, request: { roll: 'actions:0:damage:0', critical: true } });
  assert.equal(roll.roll.formula, '2d4+2');
  assert.equal(roll.roll.combatant, 'Practice Footpad 1');
  assert.ok(roll.roll.total >= 4 && roll.roll.total <= 10);
  assert.throws(() => db.rollForCombatant({ ...asDm, combatantId: first.id, request: { roll: 'actions:9:hit' } }), /not on this statblock/);
  assert.throws(() => db.rollForCombatant({ ...asPlayer, combatantId: first.id, request: { roll: 'initiative' } }), /Forbidden/);

  db.createEncounter({ ...asDm, name: 'Second wave' });
  const secondId = db.getAdventureTable(asDm).encounters.list.find(e => e.name === 'Second wave').id;
  db.addEncounterMonster({ ...asDm, encounterId: secondId, monster: 'Practice Footpad' });
  assert.throws(() => db.runEncounter({ ...asDm, encounterId: secondId }), /End "Gazer lair" first/);
  table = db.endEncounter({ ...asDm, encounterId });
  assert.equal(table.encounters.list.find(e => e.id === encounterId).status, 'done');
  assert.throws(() => db.addEncounterMonster({ ...asDm, encounterId, monster: 'Practice Footpad' }), /is over/);
  assert.equal(db.getAdventureTable(asPlayer).encounters.running, null);
  table = db.deleteEncounter({ ...asDm, encounterId });
  assert.deepEqual(table.encounters.list.map(e => e.name), ['Second wave']);
});

test('Owlbear: the DM key reads the running encounter; tokens are matched by name', async () => {
  const dm = createPlayer();
  const other = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('vtt-dm', dm);
  const { adventure } = db.createAdventureFromThread({ threadId: 'vtt-thread', title: 'Owlbear night', ownerDiscordId: 'vtt-dm' });
  const asDm = { adventureId: adventure.id, user: { id: dm, role: 'player' } };
  const dmKey = db.getVttKey({ playerId: dm });
  const otherKey = db.getVttKey({ playerId: other });
  assert.deepEqual(db.getVttEncounters({ key: dmKey }).encounters, [], 'nothing running yet');
  assert.throws(() => db.getVttEncounters({ key: 'not-a-real-key-at-all' }), /Unknown key/);

  const encounterId = db.createEncounter({ ...asDm, name: 'Bridge' }).encounters.list[0].id;
  db.addEncounterMonster({ ...asDm, encounterId, monster: 'Practice Footpad', count: 2 });
  db.runEncounter({ ...asDm, encounterId });
  const first = db.getAdventureTable(asDm).encounters.list[0].combatants[0];
  db.setCombatantInitiative({ ...asDm, combatantId: first.id, initiative: 14 });

  const feed = db.getVttEncounters({ key: dmKey });
  assert.equal(feed.encounters[0].name, 'Bridge');
  assert.deepEqual(feed.encounters[0].combatants.map(c => [c.label, c.baseName, c.initiative]),
    [['Practice Footpad 1', 'Practice Footpad', 14], ['Practice Footpad 2', 'Practice Footpad', null]]);
  assert.deepEqual(db.getVttEncounters({ key: otherKey }).encounters, [], "another player's key sees nothing");

  const { matchTokens, TRACKER_KEY } = await import('../vtt/shared.js');
  assert.equal(TRACKER_KEY, 'rodeo.owlbear.initiative-tracker/metadata');
  const items = [
    { id: 'map', type: 'IMAGE', layer: 'MAP', name: 'Practice Footpad' },
    { id: 'a', type: 'IMAGE', layer: 'CHARACTER', name: 'Practice Footpad', text: { plainText: '' } },
    { id: 'b', type: 'IMAGE', layer: 'CHARACTER', name: 'x', text: { plainText: 'practice footpad 2' } },
    { id: 'c', type: 'IMAGE', layer: 'CHARACTER', name: 'Thorin' }
  ];
  const matches = matchTokens(items, feed.encounters[0].combatants);
  assert.deepEqual(matches.map(m => m.token && m.token.id), ['a', 'b'], 'exact label first, then the monster name; never the map');
  assert.equal(matchTokens(items, [{ label: 'Thorin Ironfist', baseName: 'Thorin' }])[0].token.id, 'c', 'a character by first name');
  assert.equal(matchTokens(items, [{ label: 'Nobody', baseName: 'Nobody' }])[0].token, null);
});

test('the DM renames creatures (to match tokens) and changes their AC and HP', () => {
  const dm = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('edit-dm', dm);
  const { adventure } = db.createAdventureFromThread({ threadId: 'edit-thread', title: 'Edits', ownerDiscordId: 'edit-dm' });
  const asDm = { adventureId: adventure.id, user: { id: dm, role: 'player' } };
  const encounterId = db.createEncounter({ ...asDm, name: 'Camp' }).encounters.list[0].id;
  db.addEncounterMonster({ ...asDm, encounterId, monster: 'Practice Footpad', count: 2 });
  const npc = db.saveNpc({ name: 'Sela', hp_max: 20, armor_class: 12 });
  let table = db.addEncounterNpc({ ...asDm, encounterId, npcId: npc });
  const [first, second, sela] = table.encounters.list[0].combatants;

  table = db.updateCombatant({ ...asDm, combatantId: first.id, name: '  Red   Bandana ', armorClass: '14', hpMax: '15' });
  let edited = table.encounters.list[0].combatants.find(c => c.id === first.id);
  assert.deepEqual([edited.label, edited.customName, edited.defaultLabel], ['Red Bandana', 'Red Bandana', 'Practice Footpad 1']);
  assert.deepEqual([edited.armorClass, edited.hpMax, edited.hpCurrent], [14, 15, 15], 'full HP stays full');

  db.changeCombatantHp({ ...asDm, combatantId: second.id, action: 'damage', amount: 4 });
  table = db.updateCombatant({ ...asDm, combatantId: second.id, hpMax: '12' });
  assert.equal(table.encounters.list[0].combatants.find(c => c.id === second.id).hpCurrent, 5, 'a hurt creature keeps its HP');
  table = db.updateCombatant({ ...asDm, combatantId: second.id, hpCurrent: '30' });
  assert.equal(table.encounters.list[0].combatants.find(c => c.id === second.id).hpCurrent, 12, 'never above the maximum');
  assert.throws(() => db.updateCombatant({ ...asDm, combatantId: second.id, armorClass: '99' }), /AC must be/);
  assert.throws(() => db.updateCombatant({ ...asDm, combatantId: second.id, hpMax: '' }), /Max HP/);

  table = db.updateCombatant({ ...asDm, combatantId: first.id, name: '', armorClass: '' });
  edited = table.encounters.list[0].combatants.find(c => c.id === first.id);
  assert.deepEqual([edited.label, edited.armorClass], ['Practice Footpad 1', 12], 'empty: back to the statblock');

  // An NPC: the name is the encounter's, AC and HP the NPC's own.
  db.updateCombatant({ ...asDm, combatantId: sela.id, name: 'Hooded figure', armorClass: '15', hpMax: '25' });
  assert.deepEqual([db.getNpc(npc, { showStats: true }).name, db.getNpc(npc, { showStats: true }).stats.armorClass, db.getNpc(npc, { showStats: true }).stats.hpMax], ['Sela', 15, 25]);

  // The party and Owlbear see the new name.
  db.updateCombatant({ ...asDm, combatantId: second.id, name: 'Lookout' });
  db.runEncounter({ ...asDm, encounterId });
  const seen = db.getAdventureTable({ adventureId: adventure.id, user: { id: createPlayer(), role: 'admin' } });
  assert.ok(seen.encounters.running.combatants.some(c => c.label === 'Lookout'));
  const feed = db.getVttEncounters({ key: db.getVttKey({ playerId: dm }) });
  const lookout = feed.encounters[0].combatants.find(c => c.label === 'Lookout');
  assert.equal(lookout.baseName, 'Lookout', 'a renamed creature matches only its own name');
  const roll = db.rollForCombatant({ ...asDm, combatantId: second.id, request: { roll: 'initiative' } });
  assert.equal(roll.roll.combatant, 'Lookout');
});

test('party members join encounters; their initiative rolls land in the running fight', () => {
  const dm = createPlayer();
  const playerId = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('pc-dm', dm);
  const { adventure } = db.createAdventureFromThread({ threadId: 'pc-thread', title: 'Party night', ownerDiscordId: 'pc-dm' });
  const asDm = { adventureId: adventure.id, user: { id: dm, role: 'player' } };
  const asPlayer = { id: playerId, role: 'player' };
  const kael = addCharacter(playerId, 'Kael Stormborn', 4);
  const brin = addCharacter(playerId, 'Brin', 4);
  const outsider = addCharacter(playerId, 'Outsider', 4);
  db.setPartyMember({ ...asDm, characterId: kael, inParty: true });
  db.setPartyMember({ ...asDm, characterId: brin, inParty: true });

  const encounterId = db.createEncounter({ ...asDm, name: 'Wolves' }).encounters.list[0].id;
  db.addEncounterMonster({ ...asDm, encounterId, monster: 'Practice Footpad' });
  assert.throws(() => db.addEncounterCharacters({ ...asDm, encounterId, characterId: outsider }), /Only party members/);
  let table = db.addEncounterCharacters({ ...asDm, encounterId, characterId: kael });
  assert.throws(() => db.addEncounterCharacters({ ...asDm, encounterId, characterId: kael }), /already in this encounter/);
  let encounter = table.encounters.list[0];
  const pc = encounter.combatants.find(c => c.kind === 'pc');
  assert.deepEqual([pc.label, pc.characterId, pc.xp, pc.hpMax], ['Kael Stormborn', kael, 0, null]);
  assert.equal(encounter.xp, 25, 'party members add no XP');
  assert.throws(() => db.changeCombatantHp({ ...asDm, combatantId: pc.id, action: 'damage', amount: 1 }), /on their card/);
  assert.throws(() => db.updateCombatant({ ...asDm, combatantId: pc.id, name: 'X' }), /character sheet/);
  assert.throws(() => db.rollForCombatant({ ...asDm, combatantId: pc.id, request: { roll: 'initiative' } }), /own sheet/);

  // A roll before the fight starts changes nothing.
  db.rollForCharacter({ characterId: kael, user: asPlayer, request: { roll: 'initiative' } });
  assert.equal(db.getAdventureTable(asDm).encounters.list[0].combatants.find(c => c.id === pc.id).initiative, null);

  db.runEncounter({ ...asDm, encounterId });
  table = db.rollEncounterInitiative({ ...asDm, encounterId });
  assert.equal(table.encounters.list[0].combatants.find(c => c.id === pc.id).initiative, null, '"Roll initiative" leaves the party to roll their own');

  const kaelRoll = db.rollForCharacter({ characterId: kael, user: asPlayer, request: { roll: 'initiative' } });
  assert.equal(kaelRoll.kind, 'initiative');
  const brinRoll = db.rollForCharacter({ characterId: brin, user: asPlayer, request: { roll: 'initiative' } });
  db.rollForCharacter({ characterId: outsider, user: asPlayer, request: { roll: 'initiative' } });
  encounter = db.getAdventureTable(asDm).encounters.list[0];
  assert.equal(encounter.combatants.find(c => c.characterId === kael).initiative, kaelRoll.total);
  assert.equal(encounter.combatants.find(c => c.characterId === brin).initiative, brinRoll.total, 'rolling adds a party member the DM had not');
  assert.ok(!encounter.combatants.some(c => c.characterId === outsider), 'not someone outside the party');
  db.rollForCharacter({ characterId: kael, user: asPlayer, request: { roll: 'check:str' } });
  assert.equal(db.getAdventureTable(asDm).encounters.list[0].combatants.find(c => c.characterId === kael).initiative, kaelRoll.total, 'only initiative rolls');

  // The party sees themselves in the order; Owlbear gets their first names to match tokens.
  const seen = db.getAdventureTable({ adventureId: adventure.id, user: asPlayer });
  assert.ok(seen.encounters.running.combatants.some(c => c.kind === 'pc' && c.label === 'Kael Stormborn'));
  assert.equal(seen.viewerId, playerId);
  const feed = db.getVttEncounters({ key: db.getVttKey({ playerId: dm }) }).encounters[0].combatants;
  const kaelFeed = feed.find(c => c.label === 'Kael Stormborn');
  assert.deepEqual([kaelFeed.baseName, kaelFeed.kind, kaelFeed.initiative], ['Kael', 'pc', kaelRoll.total]);

  // The whole party at once (whoever is missing).
  const second = db.createEncounter({ ...asDm, name: 'Later' }).encounters.list.find(e => e.name === 'Later').id;
  table = db.addEncounterCharacters({ ...asDm, encounterId: second });
  assert.equal(table.encounters.list.find(e => e.id === second).combatants.filter(c => c.kind === 'pc').length, 2);
  assert.throws(() => db.addEncounterCharacters({ ...asDm, encounterId: second }), /whole party is already/);
});

test('encounters pause and resume as they were; players leave the fight and roll back in', () => {
  const dm = createPlayer();
  const playerId = createPlayer();
  const stranger = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('pause-dm', dm);
  const { adventure } = db.createAdventureFromThread({ threadId: 'pause-thread', title: 'Long night', ownerDiscordId: 'pause-dm' });
  const asDm = { adventureId: adventure.id, user: { id: dm, role: 'player' } };
  const asPlayer = { id: playerId, role: 'player' };
  const kael = addCharacter(playerId, 'Kael', 4);
  db.setPartyMember({ ...asDm, characterId: kael, inParty: true });

  const first = db.createEncounter({ ...asDm, name: 'Ambush' }).encounters.list[0].id;
  db.addEncounterMonster({ ...asDm, encounterId: first, monster: 'Practice Footpad' });
  db.runEncounter({ ...asDm, encounterId: first });
  db.rollForCharacter({ characterId: kael, user: asPlayer, request: { roll: 'initiative' } });
  let combatants = db.getAdventureTable(asDm).encounters.list[0].combatants;
  const footpad = combatants.find(c => c.kind === 'monster');
  db.changeCombatantHp({ ...asDm, combatantId: footpad.id, action: 'damage', amount: 4 });
  db.setCombatantInitiative({ ...asDm, combatantId: footpad.id, initiative: 12 });

  // Leaving: the player (or the DM), not strangers; the character stays in the party.
  assert.throws(() => db.leaveEncounter({ adventureId: adventure.id, user: { id: stranger, role: 'player' }, characterId: kael }), /Forbidden/);
  let table = db.leaveEncounter({ adventureId: adventure.id, user: asPlayer, characterId: kael });
  assert.ok(!table.encounters.running.combatants.some(c => c.characterId === kael));
  assert.ok(table.party.some(member => member.id === kael), 'still in the party');
  assert.throws(() => db.leaveEncounter({ adventureId: adventure.id, user: asPlayer, characterId: kael }), /not in the fight/);
  db.rollForCharacter({ characterId: kael, user: asPlayer, request: { roll: 'initiative' } });
  assert.ok(db.getAdventureTable(asDm).encounters.list[0].combatants.some(c => c.characterId === kael), 'rolling again brings them back');

  // Pause: the party stops seeing it, it keeps its state, another can run.
  assert.throws(() => db.resumeEncounter({ ...asDm, encounterId: first }), /not paused/);
  table = db.pauseEncounter({ ...asDm, encounterId: first });
  assert.equal(table.encounters.list.find(e => e.id === first).status, 'paused');
  assert.equal(db.getAdventureTable({ adventureId: adventure.id, user: asPlayer }).encounters.running, null);
  const kaelRollWhilePaused = db.rollForCharacter({ characterId: kael, user: asPlayer, request: { roll: 'initiative' } });
  const second = db.createEncounter({ ...asDm, name: 'Interlude' }).encounters.list.find(e => e.name === 'Interlude').id;
  db.addEncounterMonster({ ...asDm, encounterId: second, monster: 'Practice Footpad' });
  db.runEncounter({ ...asDm, encounterId: second });
  assert.throws(() => db.resumeEncounter({ ...asDm, encounterId: first }), /Pause or end "Interlude" first/);
  db.endEncounter({ ...asDm, encounterId: second });

  table = db.resumeEncounter({ ...asDm, encounterId: first });
  const resumed = table.encounters.list.find(e => e.id === first);
  assert.equal(resumed.status, 'running');
  const again = resumed.combatants.find(c => c.id === footpad.id);
  assert.deepEqual([again.hpCurrent, again.initiative], [5, 12], 'HP and initiative kept');
  assert.notEqual(resumed.combatants.find(c => c.characterId === kael).initiative, null);
  assert.ok(kaelRollWhilePaused.total >= 1, 'a roll while paused is just a roll');

  // A paused encounter can also be ended for good.
  db.pauseEncounter({ ...asDm, encounterId: first });
  table = db.endEncounter({ ...asDm, encounterId: first });
  assert.equal(table.encounters.list.find(e => e.id === first).status, 'done');
});
