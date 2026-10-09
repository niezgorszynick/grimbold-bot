// dndData.js — Canonical D&D 2024 (Revised 5e) Reference Data
//
// Compatibility layer for the server and sheet UI. All rules data and
// validation live in ./rules; this module only reshapes it.

const rules = require('./rules');

const DND_DATA = {
  classes: rules.CLASSES,
  supplementalClasses: rules.SUPPLEMENTAL_CLASSES,
  species: rules.DND_SPECIES_DATA,
  backgrounds: rules.BACKGROUNDS,
  abilityScores: rules.ABILITIES,
  generationMethods: rules.GENERATION_METHODS,
  getProficiencyBonus: rules.proficiencyBonus,
  getModifier: rules.abilityModifier
};

module.exports = {
  DND_SPECIES: rules.DND_SPECIES,
  DND_DATA,
  DND_CLASSES_AND_SUBCLASSES: rules.DND_CLASSES_AND_SUBCLASSES,
  MULTICLASS_REQUIREMENTS: rules.MULTICLASS_REQUIREMENTS,
  MULTICLASS_PROFICIENCIES: rules.MULTICLASS_PROFICIENCIES,
  validateCharacterOptions: rules.validateCharacterOptions,
  POINT_BUY_COSTS: rules.POINT_BUY_COSTS,
  TOTAL_POINT_BUY_POINTS: rules.TOTAL_POINT_BUY_POINTS,
  STANDARD_ARRAY_SUGGESTIONS: rules.STANDARD_ARRAY_SUGGESTIONS,
  calculatePointBuyCost: rules.calculatePointBuyCost,
  getAbilityModifier: rules.abilityModifier
};
