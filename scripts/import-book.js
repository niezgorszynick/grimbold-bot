// scripts/import-book.js — Copies rules text from a book exported to Markdown
// (5etools-style: "## Subclass", "***Level 3: Feature.***" paragraphs,
// "#### Level 1: Feature" headings, "##### Table" titles) into the files of
// rules/content in their format (see rules/content/README.md). The book text
// stays out of Git like the files it is written to; this script has none.
//
//   node scripts/import-book.js class <book.md> <Class> [--source "Book"]
//   node scripts/import-book.js subclass <book.md> <Subclass> --class <Class> [--source "Book"]
//   node scripts/import-book.js species <book.md> <Species> [--source "Book"]
//   node scripts/import-book.js feat <book.md> <Feat> [--source "Book"]
//   node scripts/import-book.js item <book.md> <Item> [--source "Book"]
//   node scripts/import-book.js monsters <book.md> [--skip "Name|Name"] [--source "Book"]
//   node scripts/import-book.js items <book.md> <Section> [--skip "Item|Item"] [--source "Book"]
//
// An entry already in the target file with the same name is replaced; others
// are appended. Several names may follow the book: "Alchemist" "Armorer" ...

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'rules', 'content');

// The lines of the section under `heading` (any level from # to ####), up to
// the next heading of the same or a higher level. null when there is none.
function extractSection(bookText, name, { from = 0 } = {}) {
  const lines = bookText.split(/\r?\n/);
  const start = lines.findIndex((line, index) => {
    if (index < from) return false;
    const match = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    return match && match[2] === name;
  });
  if (start < 0) return null;
  const depth = lines[start].match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const match = lines[end].match(/^(#{1,6})\s/);
    if (match && match[1].length <= depth) break;
    end += 1;
  }
  return { start, lines: lines.slice(start + 1, end) };
}

// Book Markdown → the light Markdown of rules/content: no images, no quote
// marks, "***Name.***" → "**Name.**", "##### Title" (or any heading left in the
// text, like a quoted stat block's "## Name") → "**Title**", one blank
// line between paragraphs (list items and table rows stay together).
function cleanText(lines) {
  const out = [];
  const blockKind = line => (/^\s*\|/.test(line) ? 'table' : /^\s*(-|\d+\.)\s/.test(line) ? 'list' : null);
  for (let raw of lines) {
    let line = raw.replace(/\s+$/, '');
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) continue;
    line = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    line = line.replace(/^>+\s?/, '');
    if (/^-{3,}$|^_{3,}$/.test(line)) continue;
    // Table titles, and headings inside a quoted stat block, become bold lines.
    const title = line.match(/^#{1,6}\s+(.+)$/);
    if (title) line = `**${title[1].trim()}**`;
    line = line.replace(/\*\*\*([^*]+?)\*\*\*/g, '**$1**');
    if (!line.trim()) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    const previous = out[out.length - 1];
    // Separate paragraphs the export ran together, but keep lists and tables whole.
    if (previous && previous !== '' && !(blockKind(line) && blockKind(line) === blockKind(previous))) out.push('');
    out.push(line);
  }
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// Features in a class or subclass section: "#### Level 3: Name" headings or
// "***Level 3: Name.*** text" paragraphs. → { intro, features: [{ level, name, lines }] }
function splitFeatures(lines) {
  const intro = [];
  const features = [];
  for (const line of lines) {
    const heading = line.match(/^#{3,4}\s+Level\s+(\d+)\s*:\s*(.+?)\s*$/i);
    const paragraph = line.match(/^\*\*\*Level\s+(\d+)\s*:\s*(.+?)\.?\*\*\*\s*(.*)$/i);
    if (heading) features.push({ level: Number(heading[1]), name: heading[2].trim(), lines: [] });
    else if (paragraph) features.push({ level: Number(paragraph[1]), name: paragraph[2].trim(), lines: paragraph[3] ? [paragraph[3]] : [] });
    else (features.length ? features[features.length - 1].lines : intro).push(line);
  }
  return { intro, features };
}

// Feature names the sheet builds itself (the subclass choice, ASIs, Epic Boon).
const STRUCTURAL = /^(.+ Subclass|Subclass Feature|Ability Score Improvement|Epic Boon)$/i;

function entryMarkdown(name, fields, intro, features) {
  const out = [`## ${name}`];
  for (const [key, value] of Object.entries(fields)) if (value) out.push(`- ${key}: ${value}`);
  out.push('');
  const introText = cleanText(intro);
  if (introText) out.push(introText, '');
  for (const feature of features) {
    out.push(`### Level ${feature.level}: ${feature.name}`);
    const text = cleanText(feature.lines);
    if (text) out.push(text);
    out.push('');
  }
  out.push('---', '');
  return out.join('\n');
}

function classEntry(bookText, className, { source } = {}) {
  const section = extractSection(bookText, className);
  if (!section) throw new Error(`No "${className}" section in the book.`);
  const { features } = splitFeatures(section.lines);
  return entryMarkdown(className, { Source: source }, [], features.filter(feature => !STRUCTURAL.test(feature.name)));
}

function subclassEntry(bookText, subclassName, { className, source } = {}) {
  const section = extractSection(bookText, subclassName);
  if (!section) throw new Error(`No "${subclassName}" section in the book.`);
  const { intro, features } = splitFeatures(section.lines);
  if (!features.length) throw new Error(`"${subclassName}" has no "Level N: Feature" parts.`);
  return entryMarkdown(subclassName, { Class: className, Source: source }, intro, features);
}

// A species: its "- **Size:** ..." lines become fields, each "***Trait.*** text"
// paragraph a "### Trait" section (text up to the next trait).
function speciesEntry(bookText, speciesName, { source } = {}) {
  const section = extractSection(bookText, speciesName);
  if (!section) throw new Error(`No "${speciesName}" section in the book.`);
  const fields = {};
  const intro = [];
  const traits = [];
  for (const line of section.lines) {
    const field = !traits.length && line.match(/^-\s+\*\*([^*:]+):\*\*\s*(.+?)\s*$/);
    const trait = line.match(/^\*\*\*([^*]+?)\.\*\*\*\s*(.*)$/);
    if (field) fields[field[1].trim()] = field[2].replace(/\*/g, '');
    else if (trait) traits.push({ name: trait[1].trim(), lines: trait[2] ? [trait[2]] : [] });
    else (traits.length ? traits[traits.length - 1].lines : intro).push(line);
  }
  if (!traits.length) throw new Error(`"${speciesName}" has no "***Trait.***" paragraphs.`);
  const out = [`## ${speciesName}`];
  for (const [key, value] of Object.entries({ ...fields, Source: source })) if (value) out.push(`- ${key}: ${value}`);
  out.push('');
  const introText = cleanText(intro);
  if (introText) out.push(introText, '');
  for (const trait of traits) out.push(`### ${trait.name}`, cleanText(trait.lines), '');
  out.push('---', '');
  return out.join('\n');
}

// A feat in the format of feats.md ("# Name", bold fields, "### Benefits"):
// the book's "General Feat (Prerequisite: Level 4+, Charisma 13+)" line gives
// the category and prerequisite, a "**Repeatable:** Yes" line is dropped (the
// text says so too).
function featEntry(bookText, featName, { source } = {}) {
  const section = extractSection(bookText, featName);
  if (!section) throw new Error(`No "${featName}" section in the book.`);
  const lines = [...section.lines];
  const first = lines.findIndex(line => line.trim());
  const header = first >= 0 && lines[first].match(/^(.+? Feat)\s*(?:\(Prerequisite:\s*(.+)\))?\s*$/);
  if (!header) throw new Error(`"${featName}" has no "... Feat (Prerequisite: ...)" line.`);
  lines.splice(first, 1);
  const body = cleanText(lines.filter(line => !/^\*\*Repeatable:\*\*/.test(line)));
  return [
    `# ${featName}`, '',
    `- **Category**: ${header[1]}`,
    `- **Prerequisite**: ${header[2] ? header[2].replace(/;\s*/g, ', ') : 'None'}`,
    ...(source ? [`- **Source**: ${source}`] : []),
    '', '### Benefits', '', body, '', '---', ''
  ].join('\n');
}

// A magic item in the format of magic_items.md. The book's first line reads like
// "Weapon (*Dagger*), Rare (Requires Attunement By a Spellcaster), Simple Weapon,
// Melee Weapon, 1 lb." or "Potion, Common, 50 GP, ½ lb."
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact'];
function parseItemLine(line) {
  const text = line.replace(/\*/g, '').trim();
  const attunement = (text.match(/\((Requires Attunement[^)]*)\)/i) || [])[1] || null;
  const parts = text.replace(/\s*\(Requires Attunement[^)]*\)/i, '').split(/,\s*(?![^()]*\))/).map(part => part.trim()).filter(Boolean)
    .filter(part => !/^(Simple|Martial) Weapon$|^(Melee|Ranged) Weapon$|^Generic Variant$|\blb\.$|\bGP$/i.test(part));
  const rarity = parts.find(part => RARITIES.some(name => part.toLowerCase() === name.toLowerCase())) || 'Varies';
  const type = parts.filter(part => part !== rarity).join(', ') || 'Wondrous Item';
  return {
    type,
    rarity: rarity.replace(/\b\w/g, letter => letter.toUpperCase()),
    attunement: attunement ? attunement.replace(/ By /, ' by ') : 'None'
  };
}

// A "Generic Variant" names no item type: it comes from the text ("This magic
// weapon ..."), and the long "Base items" list after it is left out.
function variantType(text) {
  if (/\bammunition\b/i.test(text) && !/\bmagic weapon\b/i.test(text)) return 'Weapon (Any Ammunition)';
  if (/\bshield\b/i.test(text) && !/\bweapon\b/i.test(text)) return 'Armor (Shield)';
  if (/\bmagic weapon\b|\bthis weapon\b/i.test(text)) return 'Weapon (Any Simple or Martial)';
  if (/\barmor\b/i.test(text)) return 'Armor (Any Light, Medium, or Heavy)';
  return 'Wondrous Item';
}

function itemEntry(name, lines, { source } = {}) {
  let body = [...lines];
  const first = body.findIndex(line => line.trim());
  const typeLine = body.splice(first, 1)[0] || '';
  const info = parseItemLine(typeLine);
  const baseItems = body.findIndex(line => /^\*{2,3}Base items\.\*{2,3}/.test(line.trim()));
  if (baseItems >= 0) body = body.slice(0, baseItems);
  // The engine's names: "Armor (Shield)", "Weapon (Any Ammunition)".
  if (/^Shield\b/.test(info.type)) info.type = 'Armor (Shield)';
  if (info.type === 'Ammunition') info.type = 'Weapon (Any Ammunition)';
  if (/Generic Variant/i.test(typeLine)) {
    if (info.type === 'Wondrous Item' && !/^Wondrous/i.test(typeLine.replace(/^Generic Variant,?\s*/i, ''))) {
      const ownType = parseItemLine(typeLine.replace(/Generic Variant,?\s*/i, '')).type;
      info.type = ownType !== 'Wondrous Item' ? ownType : variantType(body.join(' '));
    }
  }
  return [
    `# ${name}`, '',
    `- **Type**: ${info.type}`,
    `- **Rarity**: ${info.rarity}`,
    `- **Attunement**: ${info.attunement}`,
    ...(source ? [`- **Source**: ${source}`] : []),
    '', '### Description', '', cleanText(body), '', '---', ''
  ].join('\n');
}

// Every "#### Item" under the "## Heading" (or "# Heading") section: [[name, markdown]].
function itemEntries(bookText, sectionName, { source, skip = [] } = {}) {
  const section = extractSection(bookText, sectionName);
  if (!section) throw new Error(`No "${sectionName}" section in the book.`);
  const entries = [];
  let current = null;
  for (const line of section.lines) {
    const heading = line.match(/^####\s+(.+?)\s*$/);
    if (heading) {
      current = { name: heading[1], lines: [] };
      entries.push(current);
    } else if (current && /^#{1,3}\s/.test(line)) current = null;
    else if (current) current.lines.push(line);
  }
  return entries.filter(entry => !skip.includes(entry.name)).map(entry => [entry.name, itemEntry(entry.name, entry.lines, { source })]);
}

// Stat blocks quoted in the book ("> ## Boneless", "> - **Armor Class** 12",
// "> |15 (+2)|14 (+2)|...|", "> ***Smother.*** *Melee Attack Roll:* +4 ...")
// → monsters.md entries (the beasts.md format). The lore since the heading
// before the block becomes its ### Description. Blocks that are a class feature's
// companion ("13 + your Charisma modifier") or have no ability scores are skipped.
const ABILITY_ROW = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];
const FIELD_NAMES = { 'Damage Resistances': 'Resistances', 'Damage Vulnerabilities': 'Vulnerabilities', 'Damage Immunities': 'Immunities', 'Condition Immunities': 'Immunities' };
const sectionTitle = title => title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
const statText = text => text.replace(/\*([^*:]+):\*/g, '*$1*:').replace(/ {2,}/g, ' ').trim();

function statblockEntry(block, lore, { source } = {}) {
  const fields = [];
  const saves = {};
  let scores = null;
  let type = '';
  const sections = [['Traits', []]];
  // Once traits or a ### section start, "- **Name.** text" bullets are entries
  // (Legendary actions, Regional effects), not statblock fields.
  let inBody = false;
  for (const raw of block.slice(1)) {
    const line = raw.trim();
    if (!line || /^_{3,}$|^-{3,}$/.test(line) || /^\|[:\-|\s]+\|$/.test(line) || /^\|STR\|/i.test(line)) continue;
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading || /^\*\*\*/.test(line)) inBody = true;
    const field = !inBody && line.match(/^-\s+\*\*([^*]+?)\*\*:?\s*(.*)$/);
    const bullet = inBody && line.match(/^-\s+\*\*([^*]+?)\.\*\*\s*(.*)$/);
    if (bullet) sections[sections.length - 1][1].push(statText(`**${bullet[1]}**. ${bullet[2]}`));
    else if (!type && /^\*[^*].*\*$/.test(line)) type = line;
    else if (/^\|.*\(\s*[+-−]?\d+\)/.test(line)) scores = line.split('|').filter(Boolean).map(cell => cell.match(/(\d+)\s*\(([+-−]?\d+)\)/)).map(match => match && { score: match[1], mod: match[2].replace('−', '-') });
    else if (field) {
      const name = FIELD_NAMES[field[1].trim()] || field[1].trim();
      if (name === 'Saving Throws') field[2].split(',').forEach(part => { const m = part.trim().match(/^(\w{3})\w*\s*([+-]\d+)/); if (m) saves[m[1].toLowerCase()] = m[2]; });
      else if (name !== 'Proficiency Bonus') fields.push([name, field[2].trim()]);
    } else if (heading) sections.push([sectionTitle(heading[1].trim()), []]);
    else sections[sections.length - 1][1].push(statText(line.replace(/^\*\*\*([^*]+?)\.\*\*\*/, '**$1**.')));
  }
  if (!scores || scores.length !== 6 || scores.some(cell => !cell)) return null;
  const head = fields.filter(([name]) => ['Armor Class', 'Hit Points', 'Speed', 'Initiative'].includes(name));
  if (head.some(([, value]) => /\byour\b/i.test(value))) return null;
  const rest = fields.filter(entry => !head.includes(entry));
  const name = block[0].replace(/^#+\s*/, '').trim();
  const signed = value => (/^[+-]/.test(value) ? value : `+${value}`);
  const out = [`# ${name}`, '', type, '', ...head.map(([key, value]) => `- **${key}**: ${value}`), '',
    '| STAT | SCORE | MOD | SAVE |', '|:---:|:---:|:---:|:---:|',
    ...ABILITY_ROW.map((ability, index) => `| **${ability}** | ${scores[index].score} | ${signed(scores[index].mod)} | ${saves[ability.toLowerCase()] || signed(scores[index].mod)} |`), '',
    ...rest.map(([key, value]) => `- **${key}**: ${value}`), ''];
  // Sections the Monsters tab doesn't show (Regional effects, Lair actions) go
  // into the description, under their title.
  const shown = ['Traits', 'Actions', 'Bonus actions', 'Reactions', 'Legendary actions'];
  const extra = [];
  for (const [title, lines] of sections) {
    const text = lines.filter(Boolean);
    if (!text.length) continue;
    if (shown.includes(title)) out.push(`### ${title}`, '', text.join('\n\n'), '');
    else extra.push(`**${title}**`, '', text.join('\n\n'), '');
  }
  const loreText = [cleanText(lore), extra.join('\n').trim()].filter(Boolean).join('\n\n');
  if (loreText) out.push('### Description', '', loreText, '');
  if (source) out.push(`**Source**: ${source}`, '');
  out.push('---', '');
  return [name, out.join('\n')];
}

function statblockEntries(bookText, { source, skip = [] } = {}) {
  const lines = bookText.split(/\r?\n/);
  const entries = [];
  let lore = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^>\s*##\s+/.test(lines[i])) {
      const block = [];
      while (i < lines.length && /^>/.test(lines[i])) block.push(lines[i++].replace(/^>\s?/, ''));
      i -= 1;
      const entry = statblockEntry(block, lore, { source });
      if (entry && !skip.includes(entry[0]) && !entries.some(([name]) => name === entry[0])) entries.push(entry);
      lore = [];
    } else if (/^#{1,3}\s/.test(lines[i])) lore = [];
    else lore.push(lines[i]);
  }
  return entries;
}

// Replaces "## Name" entries in a content file (up to the next "## "), or appends
// them. depth 1 for the files with "# Name" entries (feats.md, spells.md).
function upsertEntries(fileText, entries, { depth = 2 } = {}) {
  let text = fileText.replace(/\r\n/g, '\n');
  const marker = `${'#'.repeat(depth)} `;
  for (const [name, markdown] of entries) {
    const lines = text.split('\n');
    const start = lines.findIndex(line => line === `${marker}${name}`);
    if (start < 0) {
      text = `${text.replace(/\n*$/, '\n\n')}${markdown}`;
      continue;
    }
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith(marker)) end += 1;
    // Keep a comment that introduces the next entries ("<!-- Subclasses below ... -->").
    const tail = lines.slice(start, end).filter(line => /^<!--.*-->$/.test(line));
    lines.splice(start, end - start, ...markdown.replace(/\n$/, '').split('\n'), '', ...(tail.length ? [...tail, ''] : []));
    text = lines.join('\n');
  }
  return text.replace(/^\n+/, '');
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { positional, options };
}

function main(argv) {
  const { positional: [kind, bookPath, ...names], options } = parseArgs(argv);
  const targets = { class: 'classes.md', subclass: 'subclasses.md', species: 'species.md', feat: 'feats.md', item: 'magic_items.md', items: 'magic_items.md', monsters: 'monsters.md' };
  if (!targets[kind] || !bookPath || (!names.length && kind !== 'monsters')) {
    console.error('Usage: node scripts/import-book.js class|subclass|species|feat|item|items|monsters <book.md> <Name>... [--class Class] [--source "Book"] [--dir rules/content]');
    process.exit(1);
  }
  if (kind === 'subclass' && !options.class) throw new Error('A subclass needs --class.');
  const book = fs.readFileSync(bookPath, 'utf8');
  const build = {
    class: name => classEntry(book, name, { source: options.source }),
    subclass: name => subclassEntry(book, name, { className: options.class, source: options.source }),
    species: name => speciesEntry(book, name, { source: options.source }),
    feat: name => featEntry(book, name, { source: options.source }),
    item: name => {
      const section = extractSection(book, name);
      if (!section) throw new Error(`No "${name}" item in the book.`);
      return itemEntry(name, section.lines, { source: options.source });
    }
  }[kind];
  // items <book> <Section>: every "#### Item" in that section; item <book> <Item>: named items.
  const skip = (options.skip || '').split('|').filter(Boolean);
  const entries = kind === 'monsters' ? statblockEntries(book, { source: options.source, skip })
    : kind === 'items'
    ? names.flatMap(name => itemEntries(book, name, { source: options.source, skip: (options.skip || '').split('|').filter(Boolean) }))
    : names.map(name => [name, build(name)]);
  const file = path.join(options.dir || CONTENT_DIR, targets[kind]);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.writeFileSync(file, upsertEntries(before, entries, { depth: ['feat', 'item', 'items', 'monsters'].includes(kind) ? 1 : 2 }));
  console.log(`Wrote ${(['monsters', 'items'].includes(kind) ? entries.map(([name]) => name) : names).join(', ')} to ${path.relative(process.cwd(), file)}`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { extractSection, cleanText, splitFeatures, classEntry, subclassEntry, speciesEntry, featEntry, itemEntry, itemEntries, parseItemLine, statblockEntries, upsertEntries };
