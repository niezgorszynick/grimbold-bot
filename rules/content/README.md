# Rules content

Descriptive text for the rules engine. Mechanics (numbers, tables, choices) live in
`rules/*.js`; these files supply the readable text shown on character sheets.

One file per category: `backgrounds.md`, `species.md`, `classes.md`, `subclasses.md`,
`feats.md`, `spells.md`, `items.md`. Missing files are simply treated as empty.

## Format

- `## Name` starts an entry. The name must match the engine exactly (e.g. `Magic Initiate`, `Path of the Berserker`).
- `- Key: Value` lines directly under the heading are fields.
- Text before the first `###` is the description.
- Each `### Heading` is a named section, used for class and subclass features, feat benefits and spell upgrades.

### Spell example

```markdown
## Fireball
- Level: 3
- School: Evocation
- Casting Time: Action
- Range: 150 feet
- Components: V, S, M (a ball of bat guano and sulfur)
- Duration: Instantaneous
- Classes: Sorcerer, Wizard

A bright streak flashes from you to a point you choose within range...

### Using a Higher-Level Spell Slot
The damage increases by 1d6 for each spell slot level above 3.
```

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
Spells use `Level: 0` for cantrips, and `Classes` is a comma-separated list of class spell lists.
