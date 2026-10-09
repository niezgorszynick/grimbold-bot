// rules/index.js — D&D 2024 rules engine entry point.

module.exports = {
  ...require('./util'),
  ...require('./equipment'),
  ...require('./backgrounds'),
  ...require('./feats'),
  ...require('./classes'),
  ...require('./spellcasting'),
  ...require('./hitPoints'),
  ...require('./multiclass'),
  ...require('./progression'),
  ...require('./content')
};
