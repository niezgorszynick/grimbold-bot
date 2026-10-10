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

// RULES_CONTENT_DIR lets tests use fixture content instead of the local files.
const CONTENT_DIR = process.env.RULES_CONTENT_DIR || path.join(__dirname, 'content');
const CATEGORIES = ['backgrounds', 'species', 'classes', 'subclasses', 'feats', 'spells', 'invocations', 'items'];

function camelCase(key) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase());
}

// Also accepted: entries as `# Name` when a file has no `## ` headings, bold
// field names (`- **Level**: 3`), `---` separators between entries, and a
// `### Description` or `### Benefits` heading, whose text becomes the description.
const DESCRIPTION_SECTIONS = ['Description', 'Benefits'];

function parseContentMarkdown(markdown) {
  const entries = {};
  let entry = null;
  let section = null;
  let readingFields = false;
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const entryPattern = lines.some(line => /^##\s/.test(line)) ? /^##\s+(.+?)\s*$/ : /^#\s+(.+?)\s*$/;

  const finishText = () => {
    if (!entry) return;
    entry.description = entry.description.trim();
    for (const key of Object.keys(entry.sections)) {
      entry.sections[key] = entry.sections[key].trim();
    }
  };

  for (const line of lines) {
    const entryHeading = line.match(entryPattern);
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
    if (/^-{3,}\s*$/.test(line)) continue;
    if (sectionHeading) {
      section = DESCRIPTION_SECTIONS.includes(sectionHeading[1]) ? null : sectionHeading[1];
      if (section) entry.sections[section] = '';
      readingFields = false;
      continue;
    }
    const field = readingFields && line.match(/^-\s+(?:\*\*([^*]+)\*\*|([^:]+)):\s*(.*)$/);
    if (field) {
      entry.fields[camelCase(field[1] || field[2])] = field[3].trim();
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

const MISSING_DESCRIPTION = /^no description available\.?$/i;

function readEntries(file) {
  return fs.existsSync(file) ? parseContentMarkdown(fs.readFileSync(file, 'utf8')) : {};
}

// Returns {} when the category file has not been provided yet. A committed
// `<category>.fallback.md` fills in entries or descriptions the main file
// lacks; the main file always wins where it has text.
function loadContent(category, { dir = CONTENT_DIR } = {}) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown content category "${category}".`);
  const key = `${dir}|${category}`;
  if (cache.has(key)) return cache.get(key);
  const entries = readEntries(path.join(dir, `${category}.md`));
  const fallback = readEntries(path.join(dir, `${category}.fallback.md`));
  for (const [name, extra] of Object.entries(fallback)) {
    const entry = entries[name];
    if (!entry) entries[name] = { ...extra, fromFallback: true };
    else if (!entry.description || MISSING_DESCRIPTION.test(entry.description)) {
      entry.description = extra.description;
      entry.descriptionFromFallback = true;
    }
  }
  cache.set(key, entries);
  return entries;
}

function clearContentCache() {
  cache.clear();
}

module.exports = { CATEGORIES, parseContentMarkdown, loadContent, clearContentCache };
