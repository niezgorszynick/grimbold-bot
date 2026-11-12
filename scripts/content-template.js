// scripts/content-template.js — Writes fill-in templates for the class and
// subclass feature text the character sheet shows:
//
//   rules/content/classes.template.md     every class feature, by level
//   rules/content/subclasses.template.md  every subclass not yet in subclasses.md,
//                                          one heading per subclass feature level
//
// Paste the text under each heading, rename the "Feature name" placeholders,
// and save the entries into classes.md / subclasses.md (both kept off Git; copy
// them to the server). Headings left without text are ignored by the sheet.
//
//   node scripts/content-template.js

const fs = require('fs');
const path = require('path');
const rules = require('../rules');
const { loadContent } = require('../rules/content');

const dir = path.join(__dirname, '..', 'rules', 'content');
const SKIP = /Subclass$|^Subclass Feature$|^Ability Score Improvement$|^Epic Boon$/;
const classNames = Object.keys(rules.DND_CLASSES_AND_SUBCLASSES);
const haveClasses = loadContent('classes');
const haveSubclasses = loadContent('subclasses');

const classLines = ['<!-- Class features: paste each feature\'s text under its heading, then save into classes.md. -->', ''];
for (const className of classNames) {
  const data = rules.getClass(className);
  if (!data) continue;
  const have = (haveClasses[className] || { sections: {} }).sections;
  classLines.push(`## ${className}`, '');
  for (const [level, names] of Object.entries(data.featuresByLevel)) {
    for (const name of names) {
      if (SKIP.test(name)) continue;
      const heading = `Level ${level}: ${name}`;
      classLines.push(`### ${heading}`, have[heading] || '', '');
    }
  }
  classLines.push('---', '');
}

const subclassLines = ['<!-- Subclasses not yet in subclasses.md: rename "Feature name", paste the text, then add the entries to subclasses.md. -->', ''];
for (const className of classNames) {
  const data = rules.getClass(className);
  if (!data) continue;
  for (const subclass of rules.DND_CLASSES_AND_SUBCLASSES[className]) {
    if (haveSubclasses[subclass]) continue;
    subclassLines.push(`## ${subclass}`, `- Class: ${className}`, '', '(A sentence or two about the subclass.)', '');
    for (const level of data.subclassFeatureLevels || []) subclassLines.push(`### Level ${level}: Feature name`, '', '');
    subclassLines.push('---', '');
  }
}

fs.writeFileSync(path.join(dir, 'classes.template.md'), classLines.join('\n'));
fs.writeFileSync(path.join(dir, 'subclasses.template.md'), subclassLines.join('\n'));
console.log('Wrote rules/content/classes.template.md and rules/content/subclasses.template.md');
