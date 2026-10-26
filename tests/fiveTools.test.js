const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { db } = require('./helpers/tempDatabase');
const rules = require('../rules');

const homebrew = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fivetools', 'homebrew.json'), 'utf8'));

test('5etools tags become the printed text', () => {
  assert.equal(rules.fiveToolsUntag('{@atk mw} {@hit 5} to hit, reach 5 ft. {@h}7 ({@damage 1d8 + 3}) piercing damage.'),
    'Melee Weapon Attack: +5 to hit, reach 5 ft. Hit: 7 (1d8 + 3) piercing damage.');
  assert.equal(rules.fiveToolsUntag('{@actSave wis} {@dc 14}. {@actSaveFail} Psychic. {@actSaveSuccess} Half.'), 'Wisdom Saving Throw: DC 14. Failure: Psychic. Success: Half.');
  assert.equal(rules.fiveToolsUntag('Breath {@recharge 5}, {@recharge}'), 'Breath (Recharge 5–6), (Recharge 6)');
  assert.equal(rules.fiveToolsUntag('{@spell Fireball|XPHB} and {@creature goblin|MM|goblins}, {@condition prone}'), 'Fireball and goblins, prone');
});

test('a 5etools file becomes statblocks: fields, dice, spellcasting, legendary, _copy', () => {
  const { monsters, skipped } = rules.convertFiveToolsFiles([{ id: 1, data: homebrew }]);
  const byName = Object.fromEntries(monsters.map(entry => [entry.monster.name, entry.monster]));
  assert.deepEqual(Object.keys(byName), ['Bog Lurker', 'Mire Witch', 'Elder Bog Lurker', 'Swarm of Mire Gnats']);
  assert.deepEqual(skipped.map(entry => [entry.name, entry.reason]), [
    ['Lost Copy', "copies Goblin (MM), which isn't loaded"],
    ['Formless Thing', 'no ability scores']
  ]);

  const lurker = byName['Bog Lurker'];
  assert.equal(lurker.typeLine, 'Medium Monstrosity (Amphibious), Neutral Evil');
  assert.deepEqual([lurker.armorClass, lurker.armorClassText, lurker.hitPoints, lurker.hitDice], [14, '14 (natural armor)', 33, '6d8+6']);
  assert.equal(lurker.speed, '30 ft., Swim 40 ft.');
  assert.deepEqual([lurker.saves.con, lurker.saves.str, lurker.skills.Stealth], [3, 3, 5]);
  assert.equal(lurker.resistances, 'Cold, Bludgeoning, Piercing from nonmagical attacks');
  assert.equal(lurker.immunities, 'Frightened');
  assert.equal(lurker.senses, 'Darkvision 60 ft., Passive Perception 13');
  assert.deepEqual([lurker.cr, lurker.xp, lurker.pb, lurker.crText], [2, 450, 2, '2']);
  assert.equal(lurker.source, "Grimbold's Test Brew, p. 12");
  assert.equal(lurker.habitat, 'Swamp');
  assert.equal(lurker.actions[1].attack.bonus, 5);
  assert.equal(lurker.actions[2].name, 'Bog Breath (Recharge 5–6)');
  assert.deepEqual(lurker.actions[2].save, { ability: 'Constitution', dc: 12 });

  // The encounter dice read them like the Monster Manual's.
  const rolls = rules.creatureRollOptions(lurker);
  assert.equal(rolls.get('actions:1:hit').formula, '1d20+5');
  assert.deepEqual([rolls.get('actions:1:damage:0').formula, rolls.get('actions:1:damage:0').label], ['1d8+3', 'Bite damage (Piercing)']);
  assert.equal(rolls.get('actions:1:damage:1').formula, '1d6');
  assert.equal(rolls.get('actions:2:damage:0').formula, '3d6');

  const witch = byName['Mire Witch'];
  assert.equal(witch.size, 'Small or Medium');
  assert.equal(witch.speed, '30 ft., Fly 30 ft. (hover)');
  assert.equal(witch.initiative, 2 + 3, 'DEX + proficiency');
  assert.deepEqual([witch.xp, witch.lairXp, witch.pb], [1800, 2300, 3]);
  assert.equal(witch.actions[0].name, 'Thorned Lash', 'spellcasting shown as an action comes after the others');
  const spellcasting = witch.actions.find(entry => entry.name === 'Spellcasting');
  assert.equal(spellcasting.text, 'The witch casts one of the following spells, using Wisdom as the spellcasting ability (spell save DC 14):\nAt will: Mage Hand, Minor Illusion\n1/day each: Fog Cloud, Hold Person');
  assert.deepEqual(witch.actions[1].save, { ability: 'Wisdom', dc: 14 });
  assert.match(witch.legendaryIntro, /^Legendary Action Uses: 2\. Immediately after another creature's turn, the mire witch can expend a use/);
  assert.deepEqual(witch.legendaryActions.map(entry => entry.name), ['Lash']);

  const elder = byName['Elder Bog Lurker'];
  assert.deepEqual([elder.size, elder.hitPoints, elder.cr, elder.armorClass], ['Large', 85, 5, 14], 'its own fields over the original');
  assert.deepEqual(elder.actions.map(entry => entry.name), ['Multiattack', 'Bite', 'Drag Under']);
  assert.equal(elder.traits[0].text, 'The elder lurker can breathe air and water.');

  const gnats = byName['Swarm of Mire Gnats'];
  assert.deepEqual([gnats.typeText, gnats.type, gnats.swarm, gnats.alignment, gnats.crText], ['Swarm of Tiny Beasts', 'Beast', true, 'Unaligned', '1/2']);
});

test('importing in batches: the creatures join the catalog, clash names get their book, and can be removed', () => {
  const dm = { id: 0, role: 'admin' };
  assert.throws(() => db.startMonsterImport({ user: { id: 5, role: 'player' }, label: 'x' }), /Only a DM/);
  const { importId } = db.startMonsterImport({ user: dm, label: 'Test Brew', fileName: 'homebrew.json', meta: homebrew._meta });
  db.addImportedMonsters({ user: dm, importId, monsters: homebrew.monster.slice(0, 3) });
  db.addImportedMonsters({ user: dm, importId, monsters: homebrew.monster.slice(3) });
  const report = db.finishMonsterImport({ user: dm, importId });
  assert.equal(report.imported, 4);
  assert.deepEqual(report.skipped.map(entry => entry.name), ['Lost Copy', 'Formless Thing']);
  assert.deepEqual(report.import.sources, ["Grimbold's Test Brew"]);
  assert.throws(() => db.startMonsterImport({ user: dm, label: 'Again', fileName: 'homebrew.json' }), /already imported/);

  const lurker = rules.getMonster('Bog Lurker');
  assert.equal(lurker.sourceName, "Grimbold's Test Brew");
  assert.ok(rules.listMonsters().some(entry => entry.name === 'Mire Witch' && entry.sourceCode === 'GrimBrew'));

  // A creature named like one already in the catalog keeps both, the import labelled.
  const second = db.startMonsterImport({ user: dm, label: 'Clash', fileName: 'clash.json' }).importId;
  db.addImportedMonsters({ user: dm, importId: second, monsters: [{ ...homebrew.monster[0], name: 'Practice Gazer', source: 'XYZ' }] });
  db.finishMonsterImport({ user: dm, importId: second });
  assert.equal(rules.getMonster('Practice Gazer').sourceName, 'Monster Manual (2024)', 'monsters.md keeps its name');
  assert.equal(rules.getMonster('Practice Gazer (XYZ)').bookName, 'Practice Gazer');

  // It works in an encounter like any monster.
  const player = db.prepare('SELECT 1').get();
  assert.ok(player);
  assert.deepEqual(db.listMonsterImports().map(entry => [entry.label, entry.monsters]), [['Test Brew', 4], ['Clash', 1]]);
  db.deleteMonsterImport({ user: dm, importId });
  assert.equal(rules.getMonster('Bog Lurker'), null);
  assert.ok(rules.getMonster('Practice Gazer (XYZ)'), 'the other import stays');
});
