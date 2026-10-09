// rules/content.js — Loads descriptive rules text from rules/content/*.md.
//
// Format (one file per category):
//
//   ## Fireball
//   - Level: 3
//   - School: Evocation
//   - Classes: Sorcerer, Wizard
//
//   A bright streak flashes from you...
//
//   ### Using a Higher-Level Spell Slot
//   The damage increases by 1d6...
//
// Each `##` heading is one entry keyed by its exact name. `- Key: Value` lines
// directly under the heading become fields (keys are camelCased). Text before
// the first `###` is the description; each `###` becomes a named section.

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, 'content');
const CATEGORIES = ['backgrounds', 'species', 'classes', 'subclasses', 'feats', 'spells', 'items'];

function camelCase(key) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase());
}

function parseContentMarkdown(markdown) {
  const entries = {};
  let entry = null;
  let section = null;
  let readingFields = false;

  const finishText = () => {
    if (!entry) return;
    entry.description = entry.description.trim();
    for (const key of Object.keys(entry.sections)) {
      entry.sections[key] = entry.sections[key].trim();
    }
  };

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const entryHeading = line.match(/^##\s+(.+?)\s*$/);
    const sectionHeading = line.match(/^###\s+(.+?)\s*$/);
    if (entryHeading && !line.startsWith('###')) {
      finishText();
      entry = { name: entryHeading[1], fields: {}, description: '', sections: {} };
      entries[entry.name] = entry;
      section = null;
      readingFields = true;
      continue;
    }
    if (!entry) continue;
    if (sectionHeading) {
      section = sectionHeading[1];
      entry.sections[section] = '';
      readingFields = false;
      continue;
    }
    const field = readingFields && line.match(/^-\s+([^:]+):\s*(.*)$/);
    if (field) {
      entry.fields[camelCase(field[1])] = field[2].trim();
      continue;
    }
    if (readingFields && line.trim() === '') continue;
    readingFields = false;
    if (section) entry.sections[section] += `${line}\n`;
    else entry.description += `${line}\n`;
  }
  finishText();
  return entries;
}

const cache = new Map();

// Returns {} when the category file has not been provided yet.
function loadContent(category) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown content category "${category}".`);
  if (cache.has(category)) return cache.get(category);
  const file = path.join(CONTENT_DIR, `${category}.md`);
  const entries = fs.existsSync(file) ? parseContentMarkdown(fs.readFileSync(file, 'utf8')) : {};
  cache.set(category, entries);
  return entries;
}

function clearContentCache() {
  cache.clear();
}

module.exports = { CATEGORIES, parseContentMarkdown, loadContent, clearContentCache };
