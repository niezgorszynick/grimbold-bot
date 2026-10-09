// rules/index.js — D&D 2024 rules engine entry point.

module.exports = {
  ...require('./util'),
  ...require('./equipment'),
  ...require('./species'),
  ...require('./subclasses'),
  ...require('./backgrounds'),
  ...require('./feats'),
  ...require('./classes'),
  ...require('./abilities'),
  ...require('./armor'),
  ...require('./spellcasting'),
  ...require('./hitPoints'),
  ...require('./multiclass'),
  ...require('./progression'),
  ...require('./creation'),
  ...require('./vitals'),
  ...require('./content')
};
