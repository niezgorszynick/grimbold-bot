const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const spell = fields => ({ level: 1, description: '', higherLevels: '', cantripUpgrade: '', ...fields });
const formulas = (data, options) => rules.spellDice(spell(data), options).map(entry => entry.formula);

test('cantrip dice grow at levels 5, 11 and 17 when the upgrade adds dice', () => {
  const toll = { level: 0, description: 'take 1d8 Necrotic damage. ... it instead takes 1d12 Necrotic damage.', cantripUpgrade: 'The damage increases by one die when you reach levels 5 (2d8 or 2d12), 11 and 17.' };
  assert.deepEqual(formulas(toll, { characterLevel: 4 }), ['1d8', '1d12']);
  assert.deepEqual(formulas(toll, { characterLevel: 5 }), ['2d8', '2d12']);
  assert.deepEqual(formulas(toll, { characterLevel: 17 }), ['4d8', '4d12']);
  const blast = { level: 0, description: 'the target takes 1d10 Force damage.', cantripUpgrade: 'The spell creates two beams at level 5.' };
  assert.deepEqual(formulas(blast, { characterLevel: 11 }), ['1d10'], 'more beams, not more dice');
});

test('leveled spells add dice per slot level above, of the size and type named', () => {
  const fireball = { level: 3, description: 'taking 8d6 Fire damage on a failed save', higherLevels: 'The damage increases by 1d6 for each spell slot level above 3.' };
  assert.deepEqual(formulas(fireball, { slotLevel: 3 }), ['8d6']);
  assert.deepEqual(formulas(fireball, { slotLevel: 5 }), ['10d6']);
  const iceStorm = { level: 4, description: 'takes 2d10 Bludgeoning damage and 4d6 Cold damage', higherLevels: 'The Bludgeoning damage increases by 1d10 for each spell slot level above 4.' };
  assert.deepEqual(formulas(iceStorm, { slotLevel: 6 }), ['4d10', '4d6']);
  const flameStrike = { level: 5, description: 'takes 5d6 Fire damage and 5d6 Radiant damage', higherLevels: 'The Fire damage and the Radiant damage increase by 1d6 for each spell slot level above 5.' };
  assert.deepEqual(formulas(flameStrike, { slotLevel: 6 }), ['6d6', '6d6']);
  const cure = { level: 1, description: 'regains Hit Points equal to 2d8 plus your spellcasting ability modifier.', higherLevels: 'The healing increases by 2d8 for each spell slot level above 1.' };
  assert.deepEqual(formulas(cure, { slotLevel: 2, modifier: 3 }), ['4d8+3']);
  const missile = { level: 1, description: 'A dart deals 1d4 + 1 Force damage', higherLevels: 'The spell creates one more dart for each spell slot level above 1.' };
  assert.deepEqual(formulas(missile, { slotLevel: 3 }), ['1d4+1']);
});

test('a spell dice roll from the sheet: scaled on the server and logged', () => {
  const owner = createPlayer();
  const sheet = {
    abilities: { str: { score: 8 }, dex: { score: 14 }, con: { score: 12 }, int: { score: 10 }, wis: { score: 16 }, cha: { score: 10 } },
    spellcasting: { classes: { Druid: { cantrips: ['Druidcraft', 'Guidance'], prepared: ['Moonbeam', 'Cure Wounds'] } } }
  };
  const id = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Ivy', 'Human', 'Druid', 'Circle of the Moon', 5, 6500, 'alive', 0, ?)`).run(owner, JSON.stringify(sheet)).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level) VALUES (?, ?, ?, 5)').run(id, 'Druid', 'Circle of the Moon');
  const asOwner = { characterId: id, user: { id: owner, role: 'player' } };
  const view = db.getCharacterSpells({ id, player_id: owner, is_admin: false });
  const druid = view.sources.find(source => source.kind === 'class');
  assert.deepEqual(view.spellDice[druid.key].Moonbeam[3], ['3d10']);
  assert.deepEqual(view.spellDice[druid.key]['Cure Wounds'][1], ['2d8+3'], 'WIS 16');

  const moonbeam = db.rollForCharacter({ ...asOwner, request: { roll: `spelldice:${druid.key}|Moonbeam|3|0` } });
  assert.equal(moonbeam.formula, '3d10');
  assert.equal(moonbeam.label, 'Moonbeam (level 3) — Radiant');
  assert.equal(moonbeam.kind, 'damage');
  assert.throws(() => db.rollForCharacter({ ...asOwner, request: { roll: `spelldice:${druid.key}|Moonbeam|3|5` } }), /not on this character sheet/);

  // Concentration remembers the slot level for the damage it deals later.
  db.castCharacterSpell({ id, player_id: owner, is_admin: false, request: { source: druid.key, spell: 'Moonbeam', slotLevel: 3 } });
  assert.equal(db.getCharacterSpells({ id, player_id: owner, is_admin: false }).concentration.slotLevel, 3);
});
