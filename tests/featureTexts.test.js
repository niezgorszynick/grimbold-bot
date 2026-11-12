// Class and subclass feature text for the sheet's feature chips, read from
// rules/content/classes.md and subclasses.md (fixtures here; the real files are
// book text kept off Git).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'grimbold-features-'));
fs.writeFileSync(path.join(fixtures, 'classes.md'), [
  '## Cleric', '',
  '### Level 1: Divine Order', 'Pick a sacred role.', '',
  '### Level 1: Spellcasting', '', '',
  '### Level 5: Sear Undead', 'Undead burn.', '',
  '---', ''
].join('\n'));
fs.writeFileSync(path.join(fixtures, 'subclasses.md'), [
  '## War Domain', '- Class: Cleric', '', 'Battle priests.', '',
  '### Level 3: War Priest', 'Extra attacks.', '',
  '### Level 6: Feature name', '', '',
  '### Level 6: Guided Strike', 'Plus ten.', ''
].join('\n'));
process.env.RULES_CONTENT_DIR = fixtures;
const rules = require('../rules');

test('class features up to the class level, only those with text', () => {
  assert.deepEqual(rules.classFeatureTexts([{ className: 'Cleric', level: 4 }]), [
    { className: 'Cleric', level: 4, features: [{ level: 1, name: 'Divine Order', text: 'Pick a sacred role.' }] }
  ]);
  const [cleric] = rules.classFeatureTexts([{ className: 'Cleric', level: 5 }, { className: 'Wizard', level: 3 }]);
  assert.deepEqual(cleric.features.map(feature => feature.name), ['Divine Order', 'Sear Undead']);
  assert.equal(rules.classFeatureTexts([{ className: 'Wizard', level: 3 }]).length, 0, 'no text for the class yet');
});

test('subclass features skip template headings left empty', () => {
  const [war] = rules.subclassFeatureTexts([{ className: 'Cleric', subclassName: 'War Domain', level: 6 }]);
  assert.equal(war.intro, 'Battle priests.');
  assert.deepEqual(war.features.map(feature => feature.name), ['War Priest', 'Guided Strike']);
});
