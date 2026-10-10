// db/characters.js — Characters: creation, sheets, gold, class levels and level-ups.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');
const { validateCharacterOptions } = require('../dndData');
const { parseGpToCp } = require('../currency');

// Sheet fields owned by the vitals API (see rules/vitals.js).
const VITALS_KEYS = [
  'hpCurrent', 'hpTemp', 'hpMaxBonus', 'hitDiceSpent', 'deathSaves',
  'stable', 'exhaustion', 'spellSlotsSpent', 'pactSlotsSpent'
];

// Sheet fields set by character creation, level-ups and the shop.
const RULES_KEYS = [
  'background', 'size', 'speciesOption', 'speciesSpellAbility', 'originFeats',
  'levelHistory', 'classFeatures', 'pendingChoices', 'inventory', 'languages',
  'toolProficiencies', 'weaponProficiencies', 'armorTraining', 'startingEquipment',
  'generationMethod', 'baseScores', 'backgroundBonuses', 'hpMax', 'hpBreakdown',
  'hitDice', 'spellSlots', 'spellcasting', 'magicItems', 'acAdjustment'
];

// For characters built by the rules engine these come from creation and
// level-ups; only a DM may edit them directly.
const RULES_MANAGED_KEYS = [
  'abilities', 'skillProficiencies', 'savingProficiencies', 'classSkillChoices', 'speciesSkillChoices'
];

function isRulesManaged(sheetData) {
  return Array.isArray(sheetData.originFeats) || Array.isArray(sheetData.levelHistory);
}

// Keeps the stored value of each key (or leaves it unset when there is none).
function keepStored(nextSheetData, storedSheetData, keys) {
  for (const key of keys) {
    if (Object.hasOwn(storedSheetData, key)) nextSheetData[key] = storedSheetData[key];
    else delete nextSheetData[key];
  }
}

// Character level from adventure points (campaign rule: start at 3, +1 per 4 points)
function calculateLevelFromXp(xp) {
  const points = Math.max(0, parseInt(xp, 10) || 0);
  if (points < 3) return 3;
  return Math.min(20, 4 + Math.floor((points - 3) / 4));
}

function getCharacterClassRows(characterId) {
  return db.prepare(`
    SELECT id, character_id, class_name, subclass_name, class_level, is_primary
    FROM character_classes
    WHERE character_id = ?
    ORDER BY is_primary DESC, id ASC
  `).all(characterId);
}

function validateCharacterLevels(characterId, classAllocations, xp = null) {
  const character = db.prepare('SELECT xp FROM characters WHERE id = ?').get(characterId);
  if (!character) throw new Error(`Character #${characterId} not found.`);
  if (!Array.isArray(classAllocations) || classAllocations.length === 0) {
    throw new Error('At least one class allocation is required.');
  }

  const seenClasses = new Set();
  let primaryCount = 0;
  const allocations = classAllocations.map(item => {
    if (!item || typeof item !== 'object') {
      throw new Error('Each class allocation must be an object.');
    }
    if (typeof item.class_name !== 'string') {
      throw new Error('Each class allocation must include a class name.');
    }
    const className = item.class_name.trim();
    const subclassName = typeof item.subclass_name === 'string' ? item.subclass_name.trim() : '';
    const level = Number(item.level);
    const isPrimary = item.is_primary === true || item.is_primary === 1 || item.is_primary === '1';
    if (!Number.isInteger(level) || level < 1) {
      throw new Error('Each class level must be a positive whole number.');
    }
    const { canonicalClass, canonicalSubclass } =
      validateCharacterOptions('Human', className, subclassName);
    const normalizedName = canonicalClass.toLowerCase();
    if (seenClasses.has(normalizedName)) {
      throw new Error(`Class "${canonicalClass}" appears more than once in the allocations.`);
    }
    seenClasses.add(normalizedName);
    if (isPrimary) primaryCount += 1;
    return {
      class_name: canonicalClass,
      subclass_name: canonicalSubclass || null,
      level,
      is_primary: isPrimary ? 1 : 0
    };
  });

  if (primaryCount !== 1) {
    throw new Error('Exactly one class must be marked as primary.');
  }

  const xpValue = xp === null ? character.xp : xp;
  const maxAllowedLevel = calculateLevelFromXp(xpValue);
  const totalAllocated = allocations.reduce((sum, item) => sum + item.level, 0);
  if (totalAllocated !== maxAllowedLevel) {
    throw new Error(
      `Total class levels (${totalAllocated}) must equal character level (${maxAllowedLevel}) based on XP (${xpValue}).`
    );
  }
  return allocations;
}

function replaceCharacterClasses(characterId, classAllocations, xp) {
  const allocations = validateCharacterLevels(characterId, classAllocations, xp);
  const deleteClasses = db.prepare('DELETE FROM character_classes WHERE character_id = ?');
  const insertClass = db.prepare(`
    INSERT INTO character_classes
      (character_id, class_name, subclass_name, class_level, is_primary)
    VALUES (?, ?, ?, ?, ?)
  `);
  deleteClasses.run(characterId);
  for (const allocation of allocations) {
    insertClass.run(
      characterId,
      allocation.class_name,
      allocation.subclass_name,
      allocation.level,
      allocation.is_primary
    );
  }
  return allocations;
}

// Keeps the primary class row in sync with the character's class and trims
// class levels above targetLevel. It never adds levels: levels earned from XP
// stay pending until the player applies them with a level-up.
function reconcileCharacterClassLevels(characterId, targetLevel, className, subclassName) {
  removeRecordedLevelsAbove(characterId, targetLevel);
  let classes = getCharacterClassRows(characterId);
  let primary = classes.find(item => item.is_primary === 1);
  if (!primary) {
    const matchingClass = classes.find(item => item.class_name.toLowerCase() === className.toLowerCase());
    if (matchingClass) {
      db.prepare('UPDATE character_classes SET is_primary = 0 WHERE character_id = ?').run(characterId);
      db.prepare('UPDATE character_classes SET is_primary = 1 WHERE id = ?').run(matchingClass.id);
      primary = matchingClass;
    } else {
      const inserted = db.prepare(`
        INSERT INTO character_classes
          (character_id, class_name, subclass_name, class_level, is_primary)
        VALUES (?, ?, ?, 1, 1)
      `).run(characterId, className, subclassName || null);
      primary = {
        id: inserted.lastInsertRowid,
        class_name: className,
        class_level: 1
      };
    }
  }

  if (primary.class_name.toLowerCase() !== className.toLowerCase()) {
    const nextPrimary = classes.find(item => item.class_name.toLowerCase() === className.toLowerCase());
    if (nextPrimary) {
      db.prepare('UPDATE character_classes SET is_primary = 0 WHERE character_id = ?').run(characterId);
      db.prepare(
        'UPDATE character_classes SET is_primary = 1, subclass_name = ? WHERE id = ?'
      ).run(subclassName || null, nextPrimary.id);
      primary = nextPrimary;
    } else {
      db.prepare(`
        UPDATE character_classes SET class_name = ?, subclass_name = ? WHERE id = ?
      `).run(className, subclassName || null, primary.id);
      primary = { ...primary, class_name: className, subclass_name: subclassName || null };
    }
  } else {
    db.prepare('UPDATE character_classes SET subclass_name = ? WHERE id = ?')
      .run(subclassName || null, primary.id);
  }

  classes = getCharacterClassRows(characterId);
  primary = classes.find(item => item.is_primary === 1);
  const remaining = targetLevel - classes.reduce((sum, item) => sum + item.class_level, 0);
  if (remaining < 0) {
    let levelsToRemove = -remaining;
    const reduceClass = db.prepare(
      'UPDATE character_classes SET class_level = class_level - ? WHERE id = ?'
    );
    for (const item of [primary, ...classes.filter(row => row.id !== primary.id).reverse()]) {
      const removable = item.class_level - 1;
      const reduction = Math.min(removable, levelsToRemove);
      if (reduction > 0) {
        reduceClass.run(reduction, item.id);
        levelsToRemove -= reduction;
      }
      if (levelsToRemove === 0) break;
    }
    if (levelsToRemove > 0) {
      throw new Error(
        `Character level ${targetLevel} is too low for the ${classes.length} allocated classes. Reallocate or remove classes before reducing XP.`
      );
    }
  }
}

function readSheetData(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('Stored character sheet data is invalid.');
  }
}

function levelUpState(character) {
  const rows = getCharacterClassRows(character.id);
  return {
    classes: rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level })),
    earnedLevel: character.level,
    species: character.race,
    sheetData: readSheetData(character.sheet_data)
  };
}

// Writes rule-engine class rows back, keeping the primary row's identity.
function writeClassRows(characterId, classes) {
  const existing = getCharacterClassRows(characterId);
  const update = db.prepare('UPDATE character_classes SET class_level = ?, subclass_name = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM character_classes WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary)
    VALUES (?, ?, ?, ?, 0)
  `);
  for (const row of existing) {
    const next = classes.find(item => item.className === row.class_name);
    if (next) update.run(next.level, next.subclassName || null, row.id);
    else remove.run(row.id);
  }
  for (const item of classes) {
    if (!existing.some(row => row.class_name === item.className)) {
      insert.run(characterId, item.className, item.subclassName || null, item.level);
    }
  }
  const primary = getCharacterClassRows(characterId).find(row => row.is_primary === 1);
  if (primary) {
    db.prepare('UPDATE characters SET subclass = ? WHERE id = ?').run(primary.subclass_name || '', characterId);
  }
}

// Undoes recorded level-ups, newest first, until the applied level fits.
function removeRecordedLevelsAbove(characterId, targetLevel) {
  for (;;) {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    const state = levelUpState(character);
    const applied = state.classes.reduce((sum, row) => sum + row.level, 0);
    if (applied <= targetLevel) return;
    const reverted = rules.revertLastLevel(state);
    if (!reverted) return;
    const appliedAfter = reverted.classes.reduce((sum, row) => sum + row.level, 0);
    if (appliedAfter >= applied) return; // History no longer matches the class rows.
    writeClassRows(characterId, reverted.classes);
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?')
      .run(JSON.stringify(reverted.sheetData), characterId);
  }
}

function loadOwnedCharacter(characterId, playerId, isAdmin) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) throw new Error('Character not found.');
  if (!isAdmin && character.player_id !== Number(playerId)) throw new Error('Forbidden.');
  return character;
}

function getCharacterLevelUpOptions({ id, player_id, is_admin }) {
  const character = loadOwnedCharacter(id, player_id, is_admin);
  return rules.getLevelUpOptions(levelUpState(character));
}

function levelUpCharacter({ id, player_id, is_admin, request }) {
  return db.transaction(() => {
    const character = loadOwnedCharacter(id, player_id, is_admin);
    if (character.status !== 'alive') throw new Error('Only living characters can level up.');
    const result = rules.applyLevelUp(levelUpState(character), request);
    writeClassRows(character.id, result.classes);
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?')
      .run(JSON.stringify(result.sheetData), character.id);
    return { entry: result.entry, classes: result.classes };
  })();
}

// Saves a character built by rules.buildStartingCharacter. Returns its ID.
function insertStartingCharacter(playerId, character) {
  return db.transaction(() => {
    const inserted = db.prepare(`
      INSERT INTO characters
        (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'alive', ?, ?)
    `).run(
      playerId,
      character.name,
      character.species,
      character.className,
      character.subclass,
      character.level,
      character.goldGp * 100,
      JSON.stringify(character.sheetData)
    );
    db.prepare(`
      INSERT INTO character_classes
        (character_id, class_name, subclass_name, class_level, is_primary)
      VALUES (?, ?, ?, ?, 1)
    `).run(inserted.lastInsertRowid, character.className, character.subclass, character.level);
    return Number(inserted.lastInsertRowid);
  })();
}

// Sets a character's purse (DM edit). gold is in gp, e.g. 12.37.
function updateCharacterGold(characterId, gold) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const goldCp = parseGpToCp(gold);
  return db.transaction(() => {
    const character = db.prepare('SELECT id, name, gold_cp FROM characters WHERE id = ?').get(id);
    if (!character) throw new Error('Character not found.');
    db.prepare('UPDATE characters SET gold_cp = ? WHERE id = ?').run(goldCp, id);
    return { id, name: character.name, oldGoldCp: character.gold_cp, newGoldCp: goldCp };
  })();
}

function updateCharacterProgression(characterId, xp) {
  const character = db.prepare('SELECT class, subclass FROM characters WHERE id = ?').get(characterId);
  if (!character) return;
  const level = calculateLevelFromXp(xp);
  db.prepare('UPDATE characters SET xp = ?, level = ? WHERE id = ?').run(xp, level, characterId);
  reconcileCharacterClassLevels(characterId, level, character.class, character.subclass);
}

module.exports = {
  calculateLevelFromXp,
  validateCharacterLevels,
  updateCharacterGold,
  getCharacterLevelUpOptions,
  levelUpCharacter,
  insertStartingCharacter,
  updateCharacterProgression,
getCharacterById: (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
updateCharacterSheet: ({ id, player_id, is_admin, name, race, class_name, subclass, sheet_data }) => {
    const characterId = Number(id);
    if (!Number.isSafeInteger(characterId) || characterId <= 0) {
      throw new Error('Invalid character ID.');
    }

    return db.transaction(() => {
      const character = db.prepare(`
        SELECT id, player_id, name, race, class, subclass, level, sheet_data
        FROM characters
        WHERE id = ?
      `).get(characterId);
      if (!character) throw new Error('Character not found.');
      if (!is_admin && character.player_id !== Number(player_id)) {
        throw new Error('Forbidden.');
      }

      const nextName = name === null || name === undefined ? character.name : name.trim();
      if (!nextName) throw new Error('Character name cannot be empty.');
      let nextSpecies = character.race;
      let nextClass = character.class;
      let nextSubclass = character.subclass;
      const updatesClassDetails =
        (race !== null && race !== undefined) ||
        (class_name !== null && class_name !== undefined) ||
        (subclass !== null && subclass !== undefined);
      if (updatesClassDetails) {
        const canonicalOptions = validateCharacterOptions(
          race === null || race === undefined ? character.race : race,
          class_name === null || class_name === undefined ? character.class : class_name,
          subclass === null || subclass === undefined ? character.subclass : subclass
        );
        nextSpecies = canonicalOptions.canonicalSpecies;
        nextClass = canonicalOptions.canonicalClass;
        nextSubclass = canonicalOptions.canonicalSubclass;
      }
      // Species, class and subclass come from creation and level-ups. The one
      // exception: an older character may fill in a missing subclass.
      const fillsMissingSubclass = !character.subclass && nextSubclass && nextClass === character.class;
      if (
        nextSpecies !== character.race ||
        nextClass !== character.class ||
        (nextSubclass !== character.subclass && !fillsMissingSubclass)
      ) {
        throw new Error('Species, class and subclass are set at creation and by level-ups. Ask the DM to change them in the Players tab.');
      }

      let nextSheetData;
      try {
        nextSheetData = JSON.parse(sheet_data);
      } catch {
        throw new Error('Invalid character sheet data.');
      }
      if (!nextSheetData || typeof nextSheetData !== 'object' || Array.isArray(nextSheetData)) {
        throw new Error('Character sheet data must be an object.');
      }
      // Merge over the stored sheet so fields the editor does not manage
      // (inventory, feats, languages, creation choices) survive a save.
      let storedSheetData = {};
      try {
        const parsed = JSON.parse(character.sheet_data || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) storedSheetData = parsed;
      } catch {
        // Unreadable stored data is replaced by the incoming sheet.
      }
      nextSheetData = { ...storedSheetData, ...nextSheetData };
      // Vitals change only through the vitals API, so a stale editor tab
      // cannot undo damage, rests or spent slots.
      keepStored(nextSheetData, storedSheetData, VITALS_KEYS);
      // A stored background or feat list is never replaced by the editor; an
      // older sheet without one may still set it.
      keepStored(nextSheetData, storedSheetData, RULES_KEYS.filter(key => Object.hasOwn(storedSheetData, key)));
      if (isRulesManaged(storedSheetData) && !is_admin) {
        keepStored(nextSheetData, storedSheetData, RULES_MANAGED_KEYS);
      }
      if (
        nextSheetData.abilities &&
        typeof nextSheetData.abilities === 'object' &&
        !Array.isArray(nextSheetData.abilities)
      ) {
        for (const [ability, value] of Object.entries(nextSheetData.abilities)) {
          const score = value && typeof value === 'object'
            ? (value.score === undefined ? value.total : value.score)
            : value;
          if (
            !['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ability) ||
            !Number.isInteger(score) ||
            score < 1 ||
            score > 30
          ) {
            throw new Error('Ability scores must be whole numbers from 1 to 30.');
          }
        }
      }

      const result = db.prepare(`
        UPDATE characters
        SET name = ?, race = ?, class = ?, subclass = ?, sheet_data = ?
        WHERE id = ?
      `).run(
        nextName,
        nextSpecies,
        nextClass,
        nextSubclass,
        JSON.stringify(nextSheetData),
        characterId
      );
      if ((class_name !== null && class_name !== undefined) ||
          (subclass !== null && subclass !== undefined)) {
        reconcileCharacterClassLevels(characterId, character.level, nextClass, nextSubclass);
      }
      return result;
    })();
  },
getCharacterClasses: (id) => getCharacterClassRows(Number(id)),
addCharacter: ({ player_id, name, race, class_name, subclass = '', xp = 0, status = 'alive', gold_gp = 0 }) => {
    const pId = parseInt(player_id, 10);
    const trimmedName = (name || '').trim();
    const parsedXp = Math.max(0, parseInt(xp, 10) || 0);
    const goldCp = parseGpToCp(gold_gp);

    if (isNaN(pId)) throw new Error('Valid player must be selected.');
    if (!trimmedName) throw new Error('Character name is required.');
    if (!['alive', 'dead'].includes(status)) throw new Error('Status must be alive or dead.');
    const { canonicalSpecies, canonicalClass, canonicalSubclass } =
      validateCharacterOptions(race, class_name, subclass);
    const pLevel = calculateLevelFromXp(parsedXp);

    const run = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pId,
        trimmedName,
        canonicalSpecies,
        canonicalClass,
        canonicalSubclass,
        pLevel,
        parsedXp,
        status,
        goldCp
      );
      db.prepare(`
        INSERT INTO character_classes
          (character_id, class_name, subclass_name, class_level, is_primary)
        VALUES (?, ?, ?, ?, 1)
      `).run(result.lastInsertRowid, canonicalClass, canonicalSubclass || null, pLevel);
      return result;
    });
    return run();
  },
updateCharacter: ({ id, player_id, name, race, class_name, subclass, xp, level, override_level, status }) => {
    const cId = parseInt(id, 10);
    const pId = parseInt(player_id, 10);
    const trimmedName = (name || '').trim();
    const trimmedRace = (race || '').trim();
    const trimmedClass = (class_name || '').trim();
    const trimmedSubclass = (subclass || '').trim();
    const parsedXp = Math.max(0, parseInt(xp, 10) || 0);

    let finalLevel = calculateLevelFromXp(parsedXp);
    if (override_level === '1' || override_level === 1 || override_level === true) {
      const manualLvl = parseInt(level, 10);
      if (!isNaN(manualLvl) && manualLvl >= 1 && manualLvl <= 20) {
        finalLevel = manualLvl;
      }
    }

    const run = db.transaction(() => {
      const result = db.prepare(`
        UPDATE characters
        SET player_id = ?, name = ?, race = ?, class = ?, subclass = ?, level = ?, xp = ?, status = ?
        WHERE id = ?
      `).run(pId, trimmedName, trimmedRace, trimmedClass, trimmedSubclass, finalLevel, parsedXp, status, cId);
      if (result.changes) {
        const existingClasses = getCharacterClassRows(cId);
        if (existingClasses.length > 1 && finalLevel !== calculateLevelFromXp(parsedXp)) {
          throw new Error('Manual level overrides must match the XP-derived level for multiclass characters.');
        }
        reconcileCharacterClassLevels(cId, finalLevel, trimmedClass, trimmedSubclass);
      }
      return result;
    });
    return run();
  },
getCharacterAdventureIds: (characterId) => {
    const rows = db.prepare('SELECT adventure_id FROM adventure_rewards WHERE character_id = ?')
      .all(Number(characterId));
    return rows.map(row => row.adventure_id);
  },
updateCharacterWithAdventures: ({
    id,
    player_id,
    name,
    race,
    class_name,
    subclass,
    xp,
    level,
    override_level,
    status,
    gold_gp,
    adventure_ids,
    class_allocations,
    death_adventure_id,
    death_dm_player_id,
    death_notes
  }) => {
    const run = db.transaction(() => {
      const charId = Number(id);
      const char = db.prepare('SELECT id, gold_cp FROM characters WHERE id = ?').get(charId);
      if (!Number.isSafeInteger(charId) || !char) {
        throw new Error(`Character #${id} not found.`);
      }

      const pId = parseInt(player_id, 10);
      const trimmedName = (name || '').trim();
      if (!Number.isInteger(pId)) throw new Error('Valid player must be selected.');
      if (!trimmedName) throw new Error('Character name is required.');
      if (!['alive', 'dead'].includes(status)) throw new Error('Status must be alive or dead.');

      const { canonicalSpecies, canonicalClass, canonicalSubclass } =
        validateCharacterOptions(race, class_name, subclass);
      const deathAdventureId = status === 'dead' && death_adventure_id
        ? Number(death_adventure_id)
        : null;
      const deathDmPlayerId = status === 'dead' && death_dm_player_id
        ? Number(death_dm_player_id)
        : null;
      const deathNotes = status === 'dead' ? (death_notes || '').trim() : null;
      if (deathAdventureId !== null) {
        if (!Number.isSafeInteger(deathAdventureId) || !db.prepare('SELECT 1 FROM adventures WHERE id = ?').get(deathAdventureId)) {
          throw new Error('Selected death adventure was not found.');
        }
      }
      if (deathDmPlayerId !== null) {
        if (!Number.isSafeInteger(deathDmPlayerId) || !db.prepare('SELECT 1 FROM players WHERE id = ?').get(deathDmPlayerId)) {
          throw new Error('Selected death DM was not found.');
        }
      }
      const parsedXp = parseInt(xp, 10);
      if (!Number.isSafeInteger(parsedXp) || parsedXp < 0) {
        throw new Error('Adventure XP must be a non-negative whole number.');
      }
      const goldCp = gold_gp === undefined ? char.gold_cp : parseGpToCp(gold_gp);

      const targetAdvIds = Array.from(new Set((adventure_ids || []).map(Number)));
      if (targetAdvIds.some(adventureId => !Number.isSafeInteger(adventureId) || adventureId <= 0)) {
        throw new Error('Invalid adventure selection.');
      }
      const currentRewards = db.prepare(
        'SELECT adventure_id, xp FROM adventure_rewards WHERE character_id = ?'
      ).all(charId);
      const currentAdvIds = new Set(currentRewards.map(reward => reward.adventure_id));
      const targetAdvIdSet = new Set(targetAdvIds);
      const toRemove = currentRewards.filter(reward => !targetAdvIdSet.has(reward.adventure_id));
      const toAdd = targetAdvIds.filter(adventureId => !currentAdvIds.has(adventureId));

      let adventureXpDelta = 0;
      const deleteReward = db.prepare(
        'DELETE FROM adventure_rewards WHERE adventure_id = ? AND character_id = ?'
      );
      for (const reward of toRemove) {
        adventureXpDelta -= reward.xp;
        deleteReward.run(reward.adventure_id, charId);
      }

      const getAdventure = db.prepare('SELECT xp_awarded FROM adventures WHERE id = ?');
      const insertReward = db.prepare(
        'INSERT INTO adventure_rewards (adventure_id, character_id, xp) VALUES (?, ?, ?)'
      );
      for (const adventureId of toAdd) {
        const adventure = getAdventure.get(adventureId);
        if (!adventure) {
          throw new Error(`Adventure #${adventureId} not found.`);
        }
        adventureXpDelta += adventure.xp_awarded;
        insertReward.run(adventureId, charId, adventure.xp_awarded);
      }

      const finalXp = Math.max(0, parsedXp + adventureXpDelta);
      let finalLevel = calculateLevelFromXp(finalXp);
      if (override_level === '1' || override_level === 1 || override_level === true) {
        const manualLevel = parseInt(level, 10);
        if (Number.isInteger(manualLevel) && manualLevel >= 1 && manualLevel <= 20) {
          finalLevel = manualLevel;
        }
      }

      const currentClasses = getCharacterClassRows(charId);
      const hasClassAllocations = class_allocations !== undefined && (
        currentClasses.length > 1 ||
        !Array.isArray(class_allocations) ||
        class_allocations.length > 0
      );
      if (
        finalLevel !== calculateLevelFromXp(finalXp) &&
        (currentClasses.length > 1 || hasClassAllocations)
      ) {
        throw new Error('Manual level overrides must match the XP-derived level for multiclass characters.');
      }

      const result = db.prepare(`
        UPDATE characters
        SET player_id = ?, name = ?, race = ?, class = ?, subclass = ?, level = ?, xp = ?, status = ?,
            death_adventure_id = ?, death_dm_player_id = ?, death_notes = ?, gold_cp = ?
        WHERE id = ?
      `).run(
        pId,
        trimmedName,
        canonicalSpecies,
        canonicalClass,
        canonicalSubclass,
        finalLevel,
        finalXp,
        status,
        deathAdventureId,
        deathDmPlayerId,
        deathNotes,
        goldCp,
        charId
      );

      if (hasClassAllocations) {
        if (!Array.isArray(class_allocations)) {
          throw new Error('Class allocations must be provided as a list.');
        }
        const includesPrimary = class_allocations.some(
          item => item && (item.is_primary === true || item.is_primary === 1 || item.is_primary === '1')
        );
        let allocations = class_allocations;
        if (!includesPrimary) {
          const secondaryAllocations = class_allocations.filter(item =>
            !item ||
            typeof item.class_name !== 'string' ||
            item.class_name.trim().toLowerCase() !== canonicalClass.toLowerCase()
          );
          const secondaryLevels = secondaryAllocations.reduce((sum, item) => {
            const classLevel = Number(item && item.level);
            if (!Number.isInteger(classLevel) || classLevel < 1) {
              throw new Error('Each class level must be a positive whole number.');
            }
            return sum + classLevel;
          }, 0);
          const primaryLevel = calculateLevelFromXp(finalXp) - secondaryLevels;
          if (primaryLevel < 1) {
            throw new Error('Secondary class levels must leave at least one level for the primary class.');
          }
          allocations = [
            {
              class_name: canonicalClass,
              subclass_name: canonicalSubclass,
              level: primaryLevel,
              is_primary: true
            },
            ...secondaryAllocations.map(item => ({ ...item, is_primary: false }))
          ];
        }
        const normalizedAllocations = validateCharacterLevels(charId, allocations, finalXp);
        const primaryAllocation = normalizedAllocations.find(item => item.is_primary === 1);
        if (primaryAllocation.class_name !== canonicalClass) {
          throw new Error('The primary class allocation must match the selected character class.');
        }
        replaceCharacterClasses(charId, normalizedAllocations, finalXp);
      } else {
        reconcileCharacterClassLevels(charId, finalLevel, canonicalClass, canonicalSubclass);
      }
      return result;
    });

    return run();
  },
deleteCharacter: (id) => {
    return db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  }
};
