const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStartingCharacter } = require('../rules');

const dwarfFighter = overrides => ({
  name: 'Thorin',
  species: 'Dwarf',
  className: 'Fighter',
  fightingStyle: 'Great Weapon Fighting',
  subclass: 'Champion',
  background: 'Soldier',
  generationMethod: 'Standard Array',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonuses: { str: 2, con: 1 },
  classSkills: ['Perception', 'Survival'],
  backgroundTool: 'Dice',
  languages: ['Dwarvish', 'Giant'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  ...overrides
});

const humanWizard = overrides => ({
  name: 'Elara',
  species: 'Human',
  size: 'Small',
  className: 'Wizard',
  subclass: 'Evoker',
  background: 'Sage',
  generationMethod: 'Point Buy',
  baseScores: { str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 8 },
  backgroundBonuses: { int: 2, con: 1 },
  originFeatChoices: { spellAbility: 'int' },
  versatileFeat: { name: 'Skilled', picks: ['Stealth', 'Perception', "Thieves' Tools"] },
  speciesSkills: ['Insight'],
  classSkills: ['Investigation', 'Medicine'],
  languages: ['Elvish', 'Draconic'],
  classEquipment: 'B',
  backgroundEquipment: 'B',
  ...overrides
});

test('builds a complete level 3 Dwarf Fighter', () => {
  const character = buildStartingCharacter(dwarfFighter());
  const sheet = character.sheetData;
  assert.equal(character.level, 3);
  assert.equal(character.goldGp, 18); // 4 (Fighter A) + 14 (Soldier A)
  assert.equal(sheet.abilities.str.score, 17);
  assert.equal(sheet.abilities.con.score, 15);
  assert.equal(sheet.hpMax, 31); // 10+2 + 2×(6+2) + 3 Dwarven Toughness
  assert.equal(sheet.hitDice, '3d10');
  assert.equal(sheet.armorClass, 16);
  assert.equal(sheet.armorClassSource, 'Chain Mail');
  assert.equal(sheet.size, 'Medium');
  assert.deepEqual(sheet.skillProficiencies.sort(), ['Athletics', 'Intimidation', 'Perception', 'Survival']);
  assert.deepEqual(sheet.toolProficiencies, ['Dice']);
  assert.deepEqual(sheet.languages, ['Common', 'Dwarvish', 'Giant']);
  assert.deepEqual(sheet.originFeats, [{ name: 'Savage Attacker', source: 'Soldier background' }]);
  assert.ok(sheet.inventory.some(item => item.name === 'Dice' && item.source === 'background'));
  assert.ok(sheet.inventory.some(item => item.name === 'Javelin' && item.quantity === 8));
  assert.ok(sheet.classFeatures.some(feature => feature.name === 'Action Surge' && feature.level === 2));
  assert.deepEqual(sheet.spellSlots.slots, []);
});

test('builds a Human Wizard with Versatile feat, gold-only equipment and pending spells', () => {
  const character = buildStartingCharacter(humanWizard());
  const sheet = character.sheetData;
  assert.equal(character.goldGp, 105); // 55 + 50
  assert.deepEqual(sheet.inventory, []);
  assert.equal(sheet.abilities.int.score, 17);
  assert.equal(sheet.hpMax, 6 + 2 + 2 * (4 + 2)); // CON 15
  assert.equal(sheet.armorClass, 12);
  assert.deepEqual(sheet.originFeats.map(feat => feat.name), ['Magic Initiate', 'Skilled']);
  assert.equal(sheet.originFeats[0].spellList, 'Wizard');
  assert.ok(sheet.skillProficiencies.includes('Stealth'));
  assert.ok(sheet.toolProficiencies.includes("Thieves' Tools"));
  assert.deepEqual(sheet.spellSlots.slots, [4, 2]);
  assert.deepEqual(sheet.pendingChoices, { cantrips: 3, preparedSpells: 6 });
});

test('Alert adds proficiency bonus to initiative', () => {
  const character = buildStartingCharacter(dwarfFighter({ background: 'Criminal', backgroundBonuses: { dex: 2, con: 1 } }));
  assert.equal(character.sheetData.initiative, '+4'); // DEX 15 (+2) + proficiency bonus 2
});

test('rejects skills already granted by background', () => {
  assert.throws(
    () => buildStartingCharacter(dwarfFighter({ classSkills: ['Athletics', 'Survival'] })),
    /already have Athletics from your Soldier background/
  );
});

test('requires a subclass at the starting level', () => {
  assert.throws(() => buildStartingCharacter(dwarfFighter({ subclass: '' })), /choose a Fighter subclass/);
});

test('requires species choices', () => {
  assert.throws(
    () => buildStartingCharacter(dwarfFighter({ species: 'Elf', speciesSkills: ['Insight'] })),
    /Elven Lineage/
  );
  assert.throws(
    () => buildStartingCharacter(humanWizard({ size: undefined })),
    /Choose a size/
  );
  const elf = buildStartingCharacter(dwarfFighter({
    species: 'Elf',
    speciesOption: 'Wood Elf',
    speciesSpellAbility: 'wis',
    speciesSkills: ['Insight']
  }));
  assert.equal(elf.sheetData.speciesOption, 'Wood Elf');
  assert.ok(elf.sheetData.skillProficiencies.includes('Insight'));
});

test('human Versatile cannot duplicate a non-repeatable background feat', () => {
  assert.throws(
    () => buildStartingCharacter(humanWizard({
      background: 'Criminal',
      backgroundBonuses: { int: 2, con: 1 },
      originFeatChoices: {},
      versatileFeat: { name: 'Alert' },
      classSkills: ['Arcana', 'History']
    })),
    /already have Alert/
  );
  assert.throws(
    () => buildStartingCharacter(humanWizard({
      versatileFeat: { name: 'Magic Initiate', spellList: 'Wizard', spellAbility: 'int' }
    })),
    /different spell list/
  );
});

test('equipment choices are validated', () => {
  assert.throws(
    () => buildStartingCharacter(dwarfFighter({ classEquipment: 'D' })),
    /starting equipment: A, B, C/
  );
  const bard = buildStartingCharacter(dwarfFighter({
    className: 'Bard',
    subclass: 'College of Lore',
    classSkills: ['Performance', 'Persuasion', 'History'],
    classTools: ['Lute', 'Flute', 'Drum'],
    equipmentChoices: { instrument: 'Lute' }
  }));
  assert.ok(bard.sheetData.inventory.some(item => item.name === 'Lute'));
  assert.throws(
    () => buildStartingCharacter(dwarfFighter({
      className: 'Bard',
      subclass: 'College of Lore',
      classSkills: ['Performance', 'Persuasion', 'History'],
      classTools: ['Lute', 'Flute', 'Drum']
    })),
    /Choose which Musical Instrument/
  );
});

test('languages must be two distinct standard languages', () => {
  assert.throws(() => buildStartingCharacter(dwarfFighter({ languages: ['Dwarvish'] })), /exactly 2 languages/);
  assert.throws(() => buildStartingCharacter(dwarfFighter({ languages: ['Dwarvish', 'Abyssal'] })), /Abyssal/);
});
