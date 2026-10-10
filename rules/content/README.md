# Rules content

Descriptive text for the rules engine. Mechanics (numbers, tables, choices) live in
`rules/*.js`; these files supply the readable text shown on character sheets.

One file per category: `backgrounds.md`, `species.md`, `classes.md`, `subclasses.md`,
`feats.md`, `spells.md`, `items.md`. Missing files are simply treated as empty.

## Book text stays out of Git

Text copied from the D&D books can't be published, and this repository is public.
`spells.md` is listed in `.gitignore`: keep it locally and copy it to the server
yourself (for example `scp rules/content/spells.md vps:~/grimbold-bot/rules/content/`).
Add other book-text files to `.gitignore` the same way.

A committed `<category>.fallback.md` (e.g. `spells.fallback.md`) holds short
summaries in our own words. They are only used where the main file has no entry
or says "No description available."

## Format

- An entry starts with `## Name`, or `# Name` in files that use no `##` headings
  (like `spells.md`). The name must match the engine exactly (e.g. `Magic Initiate`).
- `- Key: Value` or `- **Key**: Value` lines directly under the heading are fields.
- Text before the first `###` is the description; a `### Description` heading is
  treated as part of the description.
- Other `### Heading` blocks are named sections (class and subclass features, feat benefits).
- `---` lines between entries are ignored.

### Spell example (the format of spells.md)

```markdown
# Fireball

- **Level**: Level 3
- **School**: Evocation
- **Casting Time**: Action
- **Range**: 150 feet
- **Components**: V, S, M (a ball of bat guano and sulfur)
- **Duration**: Instantaneous
- **Classes**: Sorcerer, Wizard

### Description

A bright streak flashes from you to a point you choose within range...

**Using a Higher-Level Spell Slot**. The damage increases by 1d6 for each spell slot level above 3.

---
```

- `Level` is `Cantrip (Level 0)` or `Level N`.
- `Casting Time` containing "Ritual" marks a ritual; `Duration` starting with "Concentration" marks concentration.
- `Classes` is a comma-separated list. Unknown names (e.g. playtest classes) are ignored, and a clearly cut-off name such as `Warlo` is matched to `Warlock`.
- `**Using a Higher-Level Spell Slot**.` and `**Cantrip Upgrade**.` paragraphs are shown separately.

### Feat example

```markdown
## Great Weapon Master
- Category: General
- Prerequisite: Level 4+, Strength 13+
- Ability Increase: Strength

### Heavy Weapon Mastery
When you hit a creature with a weapon that has the Heavy property...
```

### Class / subclass example

```markdown
## Path of the Berserker
- Class: Barbarian

### Level 3: Frenzy
If you use Reckless Attack while your Rage is active...
```

Class and subclass features use `### Level N: Feature Name` headings, the same as the book.
