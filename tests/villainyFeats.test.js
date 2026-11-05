// The Paths of Villainy feats (Unearthed Arcana 2026: Villainous Options).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const feat = (name, extra = {}) => ({ feat: { name, ...extra } });
const scoresOf = values => Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => [a, { score: values[a] ?? 10 }]));
const featsAt = (classes, earnedLevel, sheetData) => {
  const options = rules.getLevelUpOptions({ classes, earnedLevel, species: 'Human', sheetData });
  const option = options.options.find(entry => entry.className === classes[0].className);
  return Object.fromEntries(option.feats.map(entry => [entry.name, entry]));
};

test('prerequisites: Weapon Mastery or Spellcasting, the Initiate first, levels 8 and 12, two path feats for Ascension', () => {
  const fighter = featsAt([{ className: 'Fighter', subclassName: 'Champion', level: 3 }], 4, { abilities: scoresOf({ str: 16 }) });
  assert.equal(fighter['Death Knight Initiate'].unavailable, null);
  assert.equal(fighter['Death Knight Initiate'].path, 'Death Knight');
  assert.equal(fighter['Death Knight Initiate'].kind, 'path');
  assert.equal(fighter['Dread Authority'].unavailable, 'Requires the Death Knight Initiate feat.');
  assert.equal(fighter['Lich Initiate'].unavailable, 'Requires the Spellcasting or Pact Magic feature.');

  const wizard = featsAt([{ className: 'Wizard', subclassName: 'Evoker', level: 3 }], 4, { abilities: scoresOf({ int: 16 }) });
  assert.equal(wizard['Death Knight Initiate'].unavailable, 'Requires the Weapon Mastery feature.');
  assert.equal(wizard['Lich Initiate'].unavailable, null);
  assert.equal(wizard['Undead Grasp'].spellAbilityChoice, true);

  const knight = { abilities: scoresOf({ str: 16 }), levelHistory: [feat('Death Knight Initiate', { ability: 'str' })] };
  const atFour = featsAt([{ className: 'Fighter', subclassName: 'Champion', level: 5 }], 6, knight);
  assert.equal(atFour['Dread Authority'].unavailable, null);
  assert.equal(atFour['Deathly Presence'].unavailable, 'Requires level 8.');
  const atTwelve = featsAt([{ className: 'Fighter', subclassName: 'Champion', level: 11 }], 12, knight);
  assert.equal(atTwelve['Death Knight Ascension'].unavailable, 'Requires 2 Path of the Death Knight feats.');
  const twoFeats = { ...knight, levelHistory: [...knight.levelHistory, feat('Harbinger of Doom', { ability: 'cha' })] };
  assert.equal(featsAt([{ className: 'Fighter', subclassName: 'Champion', level: 11 }], 12, twoFeats)['Death Knight Ascension'].unavailable, null);
  assert.equal(featsAt([{ className: 'Fighter', subclassName: 'Champion', level: 11 }], 12, twoFeats)['Death Knight Initiate'].unavailable, 'Already taken.');
});

test('Death Knight: Death Points equal to the Proficiency Bonus pay for the feat spells, cast with Charisma', () => {
  const player = createPlayer();
  const built = rules.buildStartingCharacter({
    name: 'Soth', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Defense',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }, backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  });
  const id = db.insertStartingCharacter(player, built);
  db.recordAdventure({ title: 'Fall', description: '', xp_awarded: 3, dm_player_id: null, dm_character_id: null, character_ids: [id] });
  const who = { id, player_id: player, is_admin: false };
  assert.throws(() => db.levelUpCharacter({ ...who, request: { className: 'Fighter', improvement: { type: 'feat', name: 'Dread Authority', ability: 'cha' } } }), /Requires the Death Knight Initiate feat/);
  db.levelUpCharacter({ ...who, request: { className: 'Fighter', improvement: { type: 'feat', name: 'Death Knight Initiate', ability: 'cha' } } });

  const sheet = JSON.parse(db.getCharacterById(id).sheet_data);
  assert.equal(sheet.abilities.cha.score, 13, '+1 Charisma');
  const view = db.getCharacterSpells(who);
  const source = view.sources.find(entry => entry.key === 'Death Knight Initiate');
  assert.deepEqual([source.ability, source.saveDc, source.prepared], ['cha', 8 + 2 + 1, ['Wrathful Smite']]);

  const classes = [{ className: 'Fighter', subclassName: 'Champion', level: 4 }];
  const points = rules.deriveVitalsContext({ species: 'Human', sheetData: sheet, classRows: classes }).resources.find(entry => entry.key === 'deathPoints');
  assert.deepEqual([points.max, points.recovery, points.pool], [2, 'long', true]);

  const cast = () => db.castCharacterSpell({ ...who, request: { source: 'Death Knight Initiate', spell: 'Wrathful Smite', free: true } });
  cast();
  cast();
  assert.equal(JSON.parse(db.getCharacterById(id).sheet_data).resourcesUsed.deathPoints, 2, 'one Death Point each');
  assert.throws(cast, /Death Points/, 'none left');
});

test('Lich: Undead Grasp gives Chill Touch, Lich Ascension free Fear casts by the chosen ability', () => {
  const sheetData = {
    abilities: scoresOf({ int: 18, cha: 16 }),
    levelHistory: [feat('Lich Initiate', { ability: 'int' }), feat('Undead Grasp', { ability: 'int', spellAbility: 'cha' }), feat('Lich Ascension', { ability: 'int', spellAbility: 'cha' })]
  };
  const classes = [{ className: 'Wizard', subclassName: 'Evoker', level: 12 }];
  const sources = rules.getSpellSources({ classes, species: 'Human', sheetData });
  const grasp = sources.find(entry => entry.key === 'Undead Grasp');
  assert.deepEqual([grasp.alwaysPrepared, grasp.ability], [['Chill Touch'], 'cha']);
  const ascension = sources.find(entry => entry.key === 'Lich Ascension');
  assert.deepEqual([ascension.alwaysPrepared, ascension.freeEach], [['Fear'], 3], 'CHA 16: three free casts');
  assert.equal(sources.some(entry => entry.key === 'Lich Initiate'), false, 'no spells of its own');
  const resources = rules.deriveVitalsContext({ species: 'Human', sheetData, classRows: classes }).resources;
  assert.equal(resources.some(entry => entry.key === 'deathPoints'), false);

  const restoring = { ...sheetData, levelHistory: [...sheetData.levelHistory, feat('Arcane Restoration', { ability: 'int' })] };
  const essence = rules.deriveVitalsContext({ species: 'Human', sheetData: restoring, classRows: classes }).resources.find(entry => entry.key === 'essenceRejuvenation');
  assert.deepEqual([essence.max, essence.recovery], [1, 'short']);

  // The level-up asks for the spells' ability.
  const options = rules.getLevelUpOptions({ classes: [{ className: 'Wizard', subclassName: 'Evoker', level: 7 }], earnedLevel: 8, species: 'Human', sheetData: { abilities: scoresOf({ int: 16 }), levelHistory: [feat('Lich Initiate', { ability: 'int' })] } });
  assert.ok(options.options.find(entry => entry.className === 'Wizard').feats.find(entry => entry.name === 'Undead Grasp').spellAbilityChoice);
});

test('feature dice: Infernal Wound, Hellfire Orb, Awful Presence, Soul Siphon; the Death Point rider after a cast', () => {
  const rollsOf = (classRows, sheetData, key) => {
    const resource = rules.deriveVitalsContext({ species: 'Human', sheetData, classRows }).resources.find(entry => entry.key === key);
    return resource ? Object.fromEntries(resource.rolls.map(roll => [roll.key, roll.formula])) : null;
  };
  assert.deepEqual(rollsOf([{ className: 'Fighter', subclassName: 'Hell Knight', level: 7 }], { abilities: scoresOf({ con: 14 }) }, 'infernalWound'), { die: '1d6' });
  assert.deepEqual(rollsOf([{ className: 'Fighter', subclassName: 'Hell Knight', level: 15 }], { abilities: scoresOf({ con: 14 }) }, 'infernalWound'), { die: '1d6', blister: '1d6' });
  assert.deepEqual(rollsOf([{ className: 'Cleric', subclassName: 'Pestilence Domain', level: 6 }], { abilities: scoresOf({ wis: 16 }) }, 'virulentBurst'), { toxic: '3d6' });

  const knight = { abilities: scoresOf({ str: 16, cha: 14 }), levelHistory: [feat('Death Knight Initiate', { ability: 'str' }), feat('Deathly Presence', { ability: 'cha' }), feat('Death Knight Ascension', { ability: 'str' })] };
  const points = rollsOf([{ className: 'Fighter', subclassName: 'Champion', level: 12 }], knight, 'deathPoints');
  assert.deepEqual([points.awful, points.orb1, points.orb5], ['2d6', '2d6+2d6', '10d6+10d6']);
  assert.deepEqual(rollsOf([{ className: 'Fighter', subclassName: 'Champion', level: 4 }], { abilities: scoresOf({}), levelHistory: [feat('Death Knight Initiate', { ability: 'str' })] }, 'deathPoints'), {});

  const lich = { abilities: scoresOf({ int: 18, wis: 12 }), levelHistory: [feat('Lich Initiate', { ability: 'int' }), feat('Transfer Life', { ability: 'int' })] };
  const siphon = rules.deriveVitalsContext({ species: 'Human', sheetData: lich, classRows: [{ className: 'Wizard', subclassName: 'Evoker', level: 8 }] }).resources.find(entry => entry.key === 'soulSiphon');
  assert.deepEqual([siphon.max, siphon.rolls[0].formula], [0, '1d6+4'], 'no uses; INT is the Wizard spellcasting ability');
  assert.match(siphon.text, /7 temporary HP/, 'Transfer Life: PB 3 + INT 4');

  // Rolled on the server from the sheet, and the rider comes back with the cast.
  const player = createPlayer();
  const id = db.insertStartingCharacter(player, rules.buildStartingCharacter({
    name: 'Varr', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Hell Knight', fightingStyle: 'Defense',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }, backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  }));
  const rolled = db.rollForCharacter({ characterId: id, user: { id: player, role: 'player' }, request: { roll: 'resource:infernalWound:die' } });
  assert.ok(rolled.total >= 1 && rolled.total <= 6);
  assert.equal(rolled.label, 'Infernal Wound die (Fire)');
  db.recordAdventure({ title: 'Oath', description: '', xp_awarded: 3, dm_player_id: null, dm_character_id: null, character_ids: [id] });
  const who = { id, player_id: player, is_admin: false };
  db.levelUpCharacter({ ...who, request: { className: 'Fighter', improvement: { type: 'feat', name: 'Death Knight Initiate', ability: 'cha' } } });
  const cast = db.castCharacterSpell({ ...who, request: { source: 'Death Knight Initiate', spell: 'Wrathful Smite', free: true } });
  assert.match(cast.note, /Disadvantage on Wisdom saves/);
});

test('"if you already have it": a Hell Knight who speaks Infernal picks another language; Undead Grasp another cantrip', () => {
  const [tongue] = rules.featuresAtLevel('Fighter', 'Hell Knight', 3);
  assert.ok(tongue.orLanguage.includes('Abyssal') && !tongue.orLanguage.includes('Infernal'));
  const apply = (languages, pick) => rules.applyFeatureChoices({ languages }, [tongue], pick ? { [tongue.id]: pick } : {}).sheetData.languages;
  assert.deepEqual(apply(['Common'], 'Abyssal'), ['Common', 'Infernal'], 'Infernal when new; the pick is ignored');
  assert.throws(() => apply(['Common', 'Infernal']), /already know Infernal; choose another language/);
  assert.throws(() => apply(['Common', 'Infernal'], 'Common'), /choose another language/);
  assert.deepEqual(apply(['Common', 'Infernal'], 'Abyssal'), ['Common', 'Infernal', 'Abyssal']);

  const classes = [{ className: 'Wizard', subclassName: 'Evoker', level: 7 }];
  const sheetData = {
    abilities: scoresOf({ int: 16 }),
    levelHistory: [feat('Lich Initiate', { ability: 'int' })],
    spellcasting: { classes: { Wizard: { cantrips: ['Chill Touch', 'Fire Bolt', 'Light', 'Mage Hand'], prepared: [], spellbook: [] } } }
  };
  const grasp = rules.getLevelUpOptions({ classes, earnedLevel: 8, species: 'Human', sheetData })
    .options.find(entry => entry.className === 'Wizard').feats.find(entry => entry.name === 'Undead Grasp');
  assert.ok(grasp.cantripChoice.includes('Ray of Frost'));
  assert.ok(!grasp.cantripChoice.includes('Chill Touch') && !grasp.cantripChoice.includes('Fire Bolt'), 'only cantrips not known yet');
  const fresh = rules.getLevelUpOptions({ classes, earnedLevel: 8, species: 'Human', sheetData: { ...sheetData, spellcasting: { classes: { Wizard: { cantrips: ['Fire Bolt'], prepared: [], spellbook: [] } } } } })
    .options.find(entry => entry.className === 'Wizard').feats.find(entry => entry.name === 'Undead Grasp');
  assert.equal(fresh.cantripChoice, null, 'Chill Touch not known: nothing to pick');

  const state = { classes, earnedLevel: 8, species: 'Human', sheetData };
  const improvement = { type: 'feat', name: 'Undead Grasp', ability: 'int', spellAbility: 'int' };
  assert.throws(() => rules.applyLevelUp(state, { className: 'Wizard', improvement }), /choose another cantrip/);
  const leveled = rules.applyLevelUp(state, { className: 'Wizard', improvement: { ...improvement, cantrip: 'Ray of Frost' } });
  const source = rules.getSpellSources({ classes: leveled.classes, species: 'Human', sheetData: leveled.sheetData }).find(entry => entry.key === 'Undead Grasp');
  assert.deepEqual(source.alwaysPrepared, ['Ray of Frost']);
});
