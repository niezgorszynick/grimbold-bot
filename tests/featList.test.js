const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

// A Sage Druid: Magic Initiate (Wizard) from the background.
function createSageDruid(playerId) {
  const character = rules.buildStartingCharacter({
    name: 'Anya', species: 'Dwarf', size: 'Medium', className: 'Druid', subclass: 'Circle of the Stars', background: 'Sage', generationMethod: 'Standard Array',
    baseScores: { str: 8, dex: 13, con: 14, int: 12, wis: 15, cha: 10 }, backgroundBonuses: { wis: 2, con: 1 },
    originFeatChoices: { spellAbility: 'int' }, classSkills: ['Medicine', 'Nature'],
    languages: ['Elvish', 'Giant'], classEquipment: 'A', backgroundEquipment: 'A', featureChoices: { 'Druid:1:Primal Order': 'Warden' }
  });
  return db.insertStartingCharacter(playerId, character);
}
const stored = id => JSON.parse(db.getCharacterById(id).sheet_data);
const keys = view => view.sources.map(source => source.key);

test('a DM moves Magic Initiate to another spell list; the old spells go, the class keeps its own', () => {
  const player = createPlayer();
  const id = createSageDruid(player);
  const asPlayer = { id, player_id: player, is_admin: false };
  const asDm = { id, player_id: 0, is_admin: true };

  // The druid's own spells, and the Wizard feat's, with its free cast used.
  db.chooseCharacterSpells({ ...asPlayer, source: 'Druid', request: { cantrips: ['Druidcraft', 'Produce Flame'], prepared: ['Cure Wounds', 'Faerie Fire', 'Thunderwave', 'Entangle'] } });
  db.chooseCharacterSpells({ ...asPlayer, source: 'Magic Initiate (Wizard)', request: { cantrips: ['Fire Bolt', 'Light'], prepared: ['Shield'] } });
  db.castCharacterSpell({ ...asPlayer, request: { source: 'Magic Initiate (Wizard)', spell: 'Shield', free: true } });
  assert.deepEqual(keys(db.getCharacterSpells(asPlayer)), ['Druid', 'Magic Initiate (Wizard)']);

  assert.throws(() => db.changeMagicInitiateList({ ...asPlayer, from: 'Wizard', spellList: 'Cleric' }), /Only a DM/);
  assert.throws(() => db.changeMagicInitiateList({ ...asDm, from: 'Wizard', spellList: 'Bard' }), /Cleric, Druid, Wizard/);
  assert.throws(() => db.changeMagicInitiateList({ ...asDm, from: 'Cleric', spellList: 'Druid' }), /no Magic Initiate \(Cleric\)/);

  const { spells } = db.changeMagicInitiateList({ ...asDm, from: 'Wizard', spellList: 'Cleric', spellAbility: 'wis' });
  assert.deepEqual(keys(spells), ['Druid', 'Magic Initiate (Cleric)']);
  const feat = spells.sources.find(source => source.key === 'Magic Initiate (Cleric)');
  assert.deepEqual([feat.ability, feat.chosenCantrips, feat.chosenPrepared], ['wis', [], []], 'Wisdom now, and nothing chosen yet');
  const sheet = stored(id);
  assert.deepEqual(sheet.originFeats[0], { ...sheet.originFeats[0], name: 'Magic Initiate', spellList: 'Cleric', spellAbility: 'wis' });
  assert.equal(sheet.spellcasting.feats['Magic Initiate (Wizard)'], undefined, 'the Wizard picks are gone');
  assert.equal(sheet.spellcasting.freeCastsUsed['Magic Initiate (Wizard)'], undefined);
  assert.deepEqual(sheet.spellcasting.classes.Druid.prepared, ['Cure Wounds', 'Faerie Fire', 'Thunderwave', 'Entangle'], 'the Druid spells stay');

  // The player chooses from the Cleric list now (Wizard spells are refused).
  assert.throws(() => db.chooseCharacterSpells({ ...asPlayer, source: 'Magic Initiate (Cleric)', request: { cantrips: ['Fire Bolt', 'Light'], prepared: ['Bless'] } }), /Fire Bolt/);
  const chosen = db.chooseCharacterSpells({ ...asPlayer, source: 'Magic Initiate (Cleric)', request: { cantrips: ['Sacred Flame', 'Light'], prepared: ['Bless'] } });
  assert.deepEqual(chosen.spells.sources.find(source => source.key === 'Magic Initiate (Cleric)').chosenPrepared, ['Bless']);
  assert.doesNotThrow(() => db.castCharacterSpell({ ...asPlayer, request: { source: 'Magic Initiate (Cleric)', spell: 'Bless', free: true } }), 'a fresh free cast');

  // Only the ability: the spells stay.
  db.changeMagicInitiateList({ ...asDm, from: 'Cleric', spellList: 'Cleric', spellAbility: 'cha' });
  const again = db.getCharacterSpells(asPlayer).sources.find(source => source.key === 'Magic Initiate (Cleric)');
  assert.deepEqual([again.ability, again.chosenPrepared], ['cha', ['Bless']]);
});
