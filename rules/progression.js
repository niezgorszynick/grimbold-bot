// rules/progression.js — What a character gains, and must choose, when gaining a level.

const { proficiencyBonus } = require('./util');
const { getClass, SUBCLASS_LEVEL, EPIC_BOON_LEVEL } = require('./classes');
const { hpGainForLevel } = require('./hitPoints');
const { getSpellSlots, getSpellsKnown } = require('./spellcasting');
const { checkMulticlass, MULTICLASS_PROFICIENCIES } = require('./multiclass');

const MAX_CHARACTER_LEVEL = 20;

// classes: [{ className, subclassName, level }] (first entry = starting class)
// scores: { str, dex, con, int, wis, cha }
// Returns the plan for gaining one level in newClass, or throws if not allowed.
function planLevelUp({ classes, scores, newClass, species = '', feats = [] }) {
  const classData = getClass(newClass);
  if (!classData) throw new Error(`Unknown class "${newClass}".`);

  const totalLevel = classes.reduce((sum, row) => sum + row.level, 0);
  if (totalLevel >= MAX_CHARACTER_LEVEL) {
    throw new Error('Character is already level 20.');
  }

  const existing = classes.find(row => row.className === newClass);
  const isNewClass = !existing;
  if (isNewClass && classes.length > 0) {
    const check = checkMulticlass({
      currentClasses: classes.map(row => row.className),
      newClass,
      scores
    });
    if (!check.allowed) {
      throw new Error(
        `Multiclassing into ${newClass} requires 13+ in the primary abilities of: ${check.missing.join(', ')}.`
      );
    }
  }

  const classLevel = isNewClass ? 1 : existing.level + 1;
  const subclassName = existing ? existing.subclassName : null;
  const nextClasses = isNewClass
    ? [...classes, { className: newClass, subclassName: null, level: 1 }]
    : classes.map(row => (row.className === newClass ? { ...row, level: classLevel } : row));

  const choices = [];
  if (classLevel === SUBCLASS_LEVEL && !subclassName) choices.push('subclass');
  if (classData.asiLevels.includes(classLevel)) choices.push('abilityScoreImprovementOrFeat');
  if (classLevel === EPIC_BOON_LEVEL) choices.push('epicBoon');
  if (isNewClass && classes.length > 0) choices.push('multiclassProficiencies');

  const spellsBefore = getSpellsKnown(newClass, subclassName, classLevel - 1);
  const spellsAfter = getSpellsKnown(newClass, subclassName, classLevel);
  const cantripsGained = spellsAfter.cantrips - (classLevel > 1 ? spellsBefore.cantrips : 0);
  const preparedGained = spellsAfter.prepared - (classLevel > 1 ? spellsBefore.prepared : 0);
  if (cantripsGained > 0) choices.push('cantrips');
  if (preparedGained > 0) choices.push('preparedSpells');

  return {
    className: newClass,
    classLevel,
    isNewClass,
    totalLevel: totalLevel + 1,
    proficiencyBonus: proficiencyBonus(totalLevel + 1),
    hpGain: hpGainForLevel({
      className: newClass,
      constitution: scores.con,
      isFirstCharacterLevel: totalLevel === 0,
      species,
      feats
    }),
    features: classData.featuresByLevel[classLevel] || [],
    choices,
    spells: { cantripsGained, preparedGained, ability: spellsAfter.ability },
    spellSlots: getSpellSlots(nextClasses),
    multiclassProficiencies: isNewClass && classes.length > 0 ? MULTICLASS_PROFICIENCIES[newClass] : null,
    classes: nextClasses
  };
}

// Builds a single-class character from level 1 to targetLevel by applying
// planLevelUp repeatedly. Used for characters that start above level 1.
function planStartingLevels({ className, subclassName = null, targetLevel, scores, species = '', feats = [] }) {
  let classes = [];
  const steps = [];
  for (let level = 1; level <= targetLevel; level += 1) {
    const step = planLevelUp({ classes, scores, newClass: className, species, feats });
    classes = step.classes.map(row =>
      row.className === className && step.classLevel >= SUBCLASS_LEVEL && subclassName
        ? { ...row, subclassName }
        : row
    );
    steps.push(step);
  }
  return { classes, steps };
}

module.exports = { MAX_CHARACTER_LEVEL, planLevelUp, planStartingLevels };
