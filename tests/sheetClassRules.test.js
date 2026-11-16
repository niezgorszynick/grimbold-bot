const test = require('node:test');
const assert = require('node:assert/strict');
const { sheetClassRules } = require('../views/tabs/characterSheet');
const { SKILL_NAMES } = require('../rules/util');

test('the sheet gets every class skill choice as a list of skill names (the Bard picks any three)', () => {
  const rules = sheetClassRules();
  assert.equal(rules.Bard.skillChoices.count, 3);
  assert.deepEqual(rules.Bard.skillChoices.options, SKILL_NAMES);
  for (const [name, data] of Object.entries(rules)) {
    if (data.skillChoices) assert.ok(Array.isArray(data.skillChoices.options), `${name}: options are a list`);
  }
});
