// db.js — SQLite layer using better-sqlite3
const crypto = require('crypto');
const { validateCharacterOptions } = require('./dndData');
const rules = require('./rules');
const { parseGpToCp } = require('./currency');

// Sheet fields owned by the vitals API (see rules/vitals.js).
const VITALS_KEYS = [
  'hpCurrent', 'hpTemp', 'hpMaxBonus', 'hitDiceSpent', 'deathSaves',
  'stable', 'exhaustion', 'spellSlotsSpent', 'pactSlotsSpent'
];
const Database = require('better-sqlite3');
const path = require('path');

// DB_PATH lets local testing use a separate database file.
const dbPath = process.env.DB_PATH
  ? path.resolve(__dirname, process.env.DB_PATH)
  : path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// 1. Weekly d20 rolls
db.exec(`
  CREATE TABLE IF NOT EXISTS rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    roll_value INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_start)
  );
`);

// Add the rolls.username column if it does not exist yet
const rollsColumns = db.prepare("PRAGMA table_info(rolls)").all();
if (!rollsColumns.some(col => col.name === 'username')) {
  db.exec("ALTER TABLE rolls ADD COLUMN username TEXT;");
}

// 2. Shop items (current stock on the counter)
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    stock INTEGER DEFAULT NULL CHECK (stock IS NULL OR stock >= 0),
    description TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 3. Sales history (replaces the old Sales spreadsheet)
db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    buyer_tag TEXT NOT NULL,
    buyer_id TEXT NOT NULL,
    base_price INTEGER NOT NULL,
    discount_percent INTEGER NOT NULL,
    final_price INTEGER NOT NULL,
    total_paid INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 4. Master item catalog
db.exec(`
  CREATE TABLE IF NOT EXISTS catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('staple', 'common', 'rare', 'magic', 'service')),
    base_price_cp INTEGER NOT NULL CHECK (base_price_cp >= 0),
    description TEXT NOT NULL,
    min_level INTEGER NOT NULL DEFAULT 1,
    min_stock INTEGER NOT NULL DEFAULT 1,
    max_stock INTEGER NOT NULL DEFAULT 3
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO config (key, value) VALUES ('party_level', '3');
`);

// 5. Players and their characters
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL UNIQUE,
    discord_tag TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    class TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 20),
    status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'dead')),
    sheet_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  );
`);

const playerColumns = db.prepare('PRAGMA table_info(players)').all();
if (!playerColumns.some(column => column.name === 'password_hash')) {
  db.exec('ALTER TABLE players ADD COLUMN password_hash TEXT;');
}
if (!playerColumns.some(column => column.name === 'role')) {
  db.exec("ALTER TABLE players ADD COLUMN role TEXT NOT NULL DEFAULT 'player';");
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_discord_tag
  ON players (discord_tag COLLATE NOCASE);
`);

// 5.1. Character class levels (multiclassing)
db.exec(`
  CREATE TABLE IF NOT EXISTS character_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    class_name TEXT NOT NULL,
    subclass_name TEXT DEFAULT NULL,
    class_level INTEGER NOT NULL CHECK (class_level >= 1),
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(character_id, class_name)
  );
`);

// 6. Adventures
db.exec(`
  CREATE TABLE IF NOT EXISTS adventures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    xp_awarded INTEGER NOT NULL DEFAULT 1 CHECK (xp_awarded >= 1),
    dm_player_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dm_player_id) REFERENCES players(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS adventure_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adventure_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    xp INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (adventure_id) REFERENCES adventures(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
  );
`);

try {
  db.exec(`ALTER TABLE adventures ADD COLUMN dm_character_id INTEGER REFERENCES characters(id)`);
} catch (e) {
  // Column already exists
}

// 6.1. Add missing columns to players
const playerCols = db.prepare("PRAGMA table_info(players)").all().map(c => c.name);
if (!playerCols.includes('dm_points')) {
  db.exec("ALTER TABLE players ADD COLUMN dm_points INTEGER NOT NULL DEFAULT 0;");
}

// 6.2. Add missing columns to characters
const charCols = db.prepare("PRAGMA table_info(characters)").all().map(c => c.name);
if (!charCols.includes('race')) {
  db.exec("ALTER TABLE characters ADD COLUMN race TEXT NOT NULL DEFAULT 'Unknown';");
}
if (!charCols.includes('subclass')) {
  db.exec("ALTER TABLE characters ADD COLUMN subclass TEXT NOT NULL DEFAULT '';");
}
if (!charCols.includes('xp')) {
  db.exec("ALTER TABLE characters ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;");
}
if (!charCols.includes('gold_gp')) {
  db.exec('ALTER TABLE characters ADD COLUMN gold_gp INTEGER NOT NULL DEFAULT 0 CHECK (gold_gp >= 0);');
}
if (!charCols.includes('death_adventure_id')) {
  db.exec('ALTER TABLE characters ADD COLUMN death_adventure_id INTEGER REFERENCES adventures(id) ON DELETE SET NULL;');
}
if (!charCols.includes('death_dm_player_id')) {
  db.exec('ALTER TABLE characters ADD COLUMN death_dm_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL;');
}
if (!charCols.includes('death_notes')) {
  db.exec('ALTER TABLE characters ADD COLUMN death_notes TEXT;');
}
if (!charCols.includes('sheet_data')) {
  db.exec('ALTER TABLE characters ADD COLUMN sheet_data TEXT;');
}
// Gold is stored as whole copper pieces in gold_cp. gold_gp is the old column
// (it ended up holding fractions after web purchases); triggers keep it as a
// read-only mirror so the previous app version still shows correct gold.
if (!charCols.includes('gold_cp')) {
  db.transaction(() => {
    db.exec('ALTER TABLE characters ADD COLUMN gold_cp INTEGER NOT NULL DEFAULT 0 CHECK (gold_cp >= 0);');
    db.exec('UPDATE characters SET gold_cp = CAST(ROUND(gold_gp * 100) AS INTEGER);');
  })();
}
db.exec(`
  CREATE TRIGGER IF NOT EXISTS characters_gold_mirror_insert AFTER INSERT ON characters
  BEGIN UPDATE characters SET gold_gp = NEW.gold_cp / 100.0 WHERE id = NEW.id; END;
  CREATE TRIGGER IF NOT EXISTS characters_gold_mirror_update AFTER UPDATE OF gold_cp ON characters
  BEGIN UPDATE characters SET gold_gp = NEW.gold_cp / 100.0 WHERE id = NEW.id; END;
`);

// 6.3. Which character paid for a sale (NULL for sales before characters had purses).
const saleCols = db.prepare('PRAGMA table_info(sales)').all().map(c => c.name);
if (!saleCols.includes('character_id')) {
  db.exec('ALTER TABLE sales ADD COLUMN character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;');
}

// Backfill the multiclass table from the legacy character columns.
const existingChars = db.prepare(
  'SELECT id, class AS character_class, subclass, level FROM characters'
).all();
const insertClass = db.prepare(`
  INSERT OR IGNORE INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary)
  VALUES (?, ?, ?, ?, 1)
`);
const migrateCharacterClasses = db.transaction(() => {
  for (const char of existingChars) {
    if (char.character_class) {
      insertClass.run(
        char.id,
        char.character_class,
        char.subclass || null,
        Math.max(1, char.level)
      );
    }
  }
});
migrateCharacterClasses();

// Character level from adventure points (campaign rule: start at 3, +1 per 4 points)
function calculateLevelFromXp(xp) {
  const points = Math.max(0, parseInt(xp, 10) || 0);
  if (points < 3) return 3;
  return Math.min(20, 4 + Math.floor((points - 3) / 4));
}

function getCharacterClassRows(characterId) {
  return db.prepare(`
    SELECT id, character_id, class_name, subclass_name, class_level, is_primary
    FROM character_classes
    WHERE character_id = ?
    ORDER BY is_primary DESC, id ASC
  `).all(characterId);
}

function validateCharacterLevels(characterId, classAllocations, xp = null) {
  const character = db.prepare('SELECT xp FROM characters WHERE id = ?').get(characterId);
  if (!character) throw new Error(`Character #${characterId} not found.`);
  if (!Array.isArray(classAllocations) || classAllocations.length === 0) {
    throw new Error('At least one class allocation is required.');
  }

  const seenClasses = new Set();
  let primaryCount = 0;
  const allocations = classAllocations.map(item => {
    if (!item || typeof item !== 'object') {
      throw new Error('Each class allocation must be an object.');
    }
    if (typeof item.class_name !== 'string') {
      throw new Error('Each class allocation must include a class name.');
    }
    const className = item.class_name.trim();
    const subclassName = typeof item.subclass_name === 'string' ? item.subclass_name.trim() : '';
    const level = Number(item.level);
    const isPrimary = item.is_primary === true || item.is_primary === 1 || item.is_primary === '1';
    if (!Number.isInteger(level) || level < 1) {
      throw new Error('Each class level must be a positive whole number.');
    }
    const { canonicalClass, canonicalSubclass } =
      validateCharacterOptions('Human', className, subclassName);
    const normalizedName = canonicalClass.toLowerCase();
    if (seenClasses.has(normalizedName)) {
      throw new Error(`Class "${canonicalClass}" appears more than once in the allocations.`);
    }
    seenClasses.add(normalizedName);
    if (isPrimary) primaryCount += 1;
    return {
      class_name: canonicalClass,
      subclass_name: canonicalSubclass || null,
      level,
      is_primary: isPrimary ? 1 : 0
    };
  });

  if (primaryCount !== 1) {
    throw new Error('Exactly one class must be marked as primary.');
  }

  const xpValue = xp === null ? character.xp : xp;
  const maxAllowedLevel = calculateLevelFromXp(xpValue);
  const totalAllocated = allocations.reduce((sum, item) => sum + item.level, 0);
  if (totalAllocated !== maxAllowedLevel) {
    throw new Error(
      `Total class levels (${totalAllocated}) must equal character level (${maxAllowedLevel}) based on XP (${xpValue}).`
    );
  }
  return allocations;
}

function replaceCharacterClasses(characterId, classAllocations, xp) {
  const allocations = validateCharacterLevels(characterId, classAllocations, xp);
  const deleteClasses = db.prepare('DELETE FROM character_classes WHERE character_id = ?');
  const insertClass = db.prepare(`
    INSERT INTO character_classes
      (character_id, class_name, subclass_name, class_level, is_primary)
    VALUES (?, ?, ?, ?, ?)
  `);
  deleteClasses.run(characterId);
  for (const allocation of allocations) {
    insertClass.run(
      characterId,
      allocation.class_name,
      allocation.subclass_name,
      allocation.level,
      allocation.is_primary
    );
  }
  return allocations;
}

// Keeps the primary class row in sync with the character's class and trims
// class levels above targetLevel. It never adds levels: levels earned from XP
// stay pending until the player applies them with a level-up.
function reconcileCharacterClassLevels(characterId, targetLevel, className, subclassName) {
  removeRecordedLevelsAbove(characterId, targetLevel);
  let classes = getCharacterClassRows(characterId);
  let primary = classes.find(item => item.is_primary === 1);
  if (!primary) {
    const matchingClass = classes.find(item => item.class_name.toLowerCase() === className.toLowerCase());
    if (matchingClass) {
      db.prepare('UPDATE character_classes SET is_primary = 0 WHERE character_id = ?').run(characterId);
      db.prepare('UPDATE character_classes SET is_primary = 1 WHERE id = ?').run(matchingClass.id);
      primary = matchingClass;
    } else {
      const inserted = db.prepare(`
        INSERT INTO character_classes
          (character_id, class_name, subclass_name, class_level, is_primary)
        VALUES (?, ?, ?, 1, 1)
      `).run(characterId, className, subclassName || null);
      primary = {
        id: inserted.lastInsertRowid,
        class_name: className,
        class_level: 1
      };
    }
  }

  if (primary.class_name.toLowerCase() !== className.toLowerCase()) {
    const nextPrimary = classes.find(item => item.class_name.toLowerCase() === className.toLowerCase());
    if (nextPrimary) {
      db.prepare('UPDATE character_classes SET is_primary = 0 WHERE character_id = ?').run(characterId);
      db.prepare(
        'UPDATE character_classes SET is_primary = 1, subclass_name = ? WHERE id = ?'
      ).run(subclassName || null, nextPrimary.id);
      primary = nextPrimary;
    } else {
      db.prepare(`
        UPDATE character_classes SET class_name = ?, subclass_name = ? WHERE id = ?
      `).run(className, subclassName || null, primary.id);
      primary = { ...primary, class_name: className, subclass_name: subclassName || null };
    }
  } else {
    db.prepare('UPDATE character_classes SET subclass_name = ? WHERE id = ?')
      .run(subclassName || null, primary.id);
  }

  classes = getCharacterClassRows(characterId);
  primary = classes.find(item => item.is_primary === 1);
  const remaining = targetLevel - classes.reduce((sum, item) => sum + item.class_level, 0);
  if (remaining < 0) {
    let levelsToRemove = -remaining;
    const reduceClass = db.prepare(
      'UPDATE character_classes SET class_level = class_level - ? WHERE id = ?'
    );
    for (const item of [primary, ...classes.filter(row => row.id !== primary.id).reverse()]) {
      const removable = item.class_level - 1;
      const reduction = Math.min(removable, levelsToRemove);
      if (reduction > 0) {
        reduceClass.run(reduction, item.id);
        levelsToRemove -= reduction;
      }
      if (levelsToRemove === 0) break;
    }
    if (levelsToRemove > 0) {
      throw new Error(
        `Character level ${targetLevel} is too low for the ${classes.length} allocated classes. Reallocate or remove classes before reducing XP.`
      );
    }
  }
}

// ─── Level-ups ─────────────────────────────────────────────────────────────
// XP earns levels (characters.level); the player applies each one through a
// guided level-up, which adds the class level and records its choices in
// sheet_data.levelHistory.

function readSheetData(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('Stored character sheet data is invalid.');
  }
}

function levelUpState(character) {
  const rows = getCharacterClassRows(character.id);
  return {
    classes: rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level })),
    earnedLevel: character.level,
    species: character.race,
    sheetData: readSheetData(character.sheet_data)
  };
}

// Writes rule-engine class rows back, keeping the primary row's identity.
function writeClassRows(characterId, classes) {
  const existing = getCharacterClassRows(characterId);
  const update = db.prepare('UPDATE character_classes SET class_level = ?, subclass_name = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM character_classes WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary)
    VALUES (?, ?, ?, ?, 0)
  `);
  for (const row of existing) {
    const next = classes.find(item => item.className === row.class_name);
    if (next) update.run(next.level, next.subclassName || null, row.id);
    else remove.run(row.id);
  }
  for (const item of classes) {
    if (!existing.some(row => row.class_name === item.className)) {
      insert.run(characterId, item.className, item.subclassName || null, item.level);
    }
  }
  const primary = getCharacterClassRows(characterId).find(row => row.is_primary === 1);
  if (primary) {
    db.prepare('UPDATE characters SET subclass = ? WHERE id = ?').run(primary.subclass_name || '', characterId);
  }
}

// Undoes recorded level-ups, newest first, until the applied level fits.
function removeRecordedLevelsAbove(characterId, targetLevel) {
  for (;;) {
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    const state = levelUpState(character);
    const applied = state.classes.reduce((sum, row) => sum + row.level, 0);
    if (applied <= targetLevel) return;
    const reverted = rules.revertLastLevel(state);
    if (!reverted) return;
    const appliedAfter = reverted.classes.reduce((sum, row) => sum + row.level, 0);
    if (appliedAfter >= applied) return; // History no longer matches the class rows.
    writeClassRows(characterId, reverted.classes);
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?')
      .run(JSON.stringify(reverted.sheetData), characterId);
  }
}

function loadOwnedCharacter(characterId, playerId, isAdmin) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!character) throw new Error('Character not found.');
  if (!isAdmin && character.player_id !== Number(playerId)) throw new Error('Forbidden.');
  return character;
}

function getCharacterLevelUpOptions({ id, player_id, is_admin }) {
  const character = loadOwnedCharacter(id, player_id, is_admin);
  return rules.getLevelUpOptions(levelUpState(character));
}

function levelUpCharacter({ id, player_id, is_admin, request }) {
  return db.transaction(() => {
    const character = loadOwnedCharacter(id, player_id, is_admin);
    if (character.status !== 'alive') throw new Error('Only living characters can level up.');
    const result = rules.applyLevelUp(levelUpState(character), request);
    writeClassRows(character.id, result.classes);
    db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?')
      .run(JSON.stringify(result.sheetData), character.id);
    return { entry: result.entry, classes: result.classes };
  })();
}

// Saves a character built by rules.buildStartingCharacter. Returns its ID.
function insertStartingCharacter(playerId, character) {
  return db.transaction(() => {
    const inserted = db.prepare(`
      INSERT INTO characters
        (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'alive', ?, ?)
    `).run(
      playerId,
      character.name,
      character.species,
      character.className,
      character.subclass,
      character.level,
      character.goldGp * 100,
      JSON.stringify(character.sheetData)
    );
    db.prepare(`
      INSERT INTO character_classes
        (character_id, class_name, subclass_name, class_level, is_primary)
      VALUES (?, ?, ?, ?, 1)
    `).run(inserted.lastInsertRowid, character.className, character.subclass, character.level);
    return Number(inserted.lastInsertRowid);
  })();
}

// Sets a character's purse (DM edit). gold is in gp, e.g. 12.37.
function updateCharacterGold(characterId, gold) {
  const id = Number(characterId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid character ID.');
  const goldCp = parseGpToCp(gold);
  return db.transaction(() => {
    const character = db.prepare('SELECT id, name, gold_cp FROM characters WHERE id = ?').get(id);
    if (!character) throw new Error('Character not found.');
    db.prepare('UPDATE characters SET gold_cp = ? WHERE id = ?').run(goldCp, id);
    return { id, name: character.name, oldGoldCp: character.gold_cp, newGoldCp: goldCp };
  })();
}

function updateCharacterProgression(characterId, xp) {
  const character = db.prepare('SELECT class, subclass FROM characters WHERE id = ?').get(characterId);
  if (!character) return;
  const level = calculateLevelFromXp(xp);
  db.prepare('UPDATE characters SET xp = ?, level = ? WHERE id = ?').run(xp, level, characterId);
  reconcileCharacterClassLevels(characterId, level, character.class, character.subclass);
}

function getCharacterAnalytics() {
  const characters = db.prepare(`
    SELECT c.*,
           p.discord_tag AS player_tag,
           dm.discord_tag AS death_dm_name,
           a.title AS death_adv_title
    FROM characters c
    LEFT JOIN players p ON c.player_id = p.id
    LEFT JOIN players dm ON c.death_dm_player_id = dm.id
    LEFT JOIN adventures a ON c.death_adventure_id = a.id
    ORDER BY c.name ASC
  `).all();
  const primaryClasses = new Map(
    db.prepare(`
      SELECT character_id, class_name
      FROM character_classes
      WHERE is_primary = 1
    `).all().map(row => [row.character_id, row.class_name])
  );

  const speciesCount = {};
  const classCount = {};
  const statusCount = { Alive: 0, Dead: 0 };
  const levelCount = {};
  let totalXp = 0;

  for (const character of characters) {
    const status = character.status === 'dead' ? 'Dead' : 'Alive';
    const species = character.race || 'Unknown';
    const charClass = primaryClasses.get(character.id) || character.class || 'Unassigned';
    const level = character.level || 3;
    statusCount[status] += 1;
    speciesCount[species] = (speciesCount[species] || 0) + 1;
    classCount[charClass] = (classCount[charClass] || 0) + 1;
    const levelKey = `Lvl ${level}`;
    levelCount[levelKey] = (levelCount[levelKey] || 0) + 1;
    totalXp += character.xp || 0;
  }

  return {
    total: characters.length,
    totalXp,
    averageLevel: characters.length
      ? Number((characters.reduce((sum, character) => sum + (character.level || 3), 0) / characters.length).toFixed(1))
      : 0,
    speciesCount,
    classCount,
    statusCount,
    levelCount,
    graveyard: characters.filter(character => character.status === 'dead')
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const match = /^([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(storedHash);
  if (!match) return false;

  const expectedKey = Buffer.from(match[2], 'hex');
  const derivedKey = crypto.scryptSync(password, match[1], expectedKey.length);
  return crypto.timingSafeEqual(expectedKey, derivedKey);
}

function getDiceAnalytics() {
  const rollCounts = db.prepare(`
    SELECT roll_value, COUNT(*) AS count
    FROM rolls
    WHERE roll_value BETWEEN 1 AND 20
    GROUP BY roll_value
  `).all();
  const distribution = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [index + 1, 0])
  );

  let totalRolls = 0;
  let totalSum = 0;

  for (const { roll_value: value, count } of rollCounts) {
    distribution[value] = count;
    totalRolls += count;
    totalSum += value * count;
  }

  return {
    totalRolls,
    averageRoll: totalRolls ? Number((totalSum / totalRolls).toFixed(2)) : 0,
    nat20Count: distribution[20],
    nat1Count: distribution[1],
    distribution
  };
}

const queries = {
  // Rolls
  getRoll: db.prepare(`SELECT * FROM rolls WHERE user_id = ? AND week_start = ?`),
 saveRoll: db.prepare(`
    INSERT INTO rolls (user_id, username, week_start, roll_value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, week_start) DO UPDATE SET 
      roll_value = excluded.roll_value,
      username = excluded.username
  `),

  // Items
  getAllItems: db.prepare(`SELECT * FROM items WHERE is_active = 1 ORDER BY category, name`),
  getAllItemsAdmin: db.prepare(`SELECT * FROM items ORDER BY category, name`),
  getItemByName: db.prepare(`SELECT * FROM items WHERE name = ? COLLATE NOCASE AND is_active = 1`),
  
  insertItem: db.prepare(`
    INSERT INTO items (name, category, price, stock, description, is_active)
    VALUES (@name, @category, @price, @stock, @description, @is_active)
  `),

  updateStock: db.prepare(`UPDATE items SET stock = ? WHERE id = ?`),
  updatePrice: db.prepare(`UPDATE items SET price = ? WHERE id = ?`),
  toggleActive: db.prepare(`UPDATE items SET is_active = ? WHERE id = ?`),
  deleteItem: db.prepare(`DELETE FROM items WHERE id = ?`)
};

module.exports = {
  calculateLevelFromXp,
  validateCharacterLevels,
  updateCharacterGold,
  getCharacterLevelUpOptions,
  levelUpCharacter,
  insertStartingCharacter,

getAdventureById: (id) => {
  return db.prepare('SELECT * FROM adventures WHERE id = ?').get(Number(id));
},

getAdventureParticipantIds: (adventureId) => {
  const rows = db.prepare('SELECT character_id FROM adventure_rewards WHERE adventure_id = ?').all(Number(adventureId));
  return rows.map(r => r.character_id);
},

updateAdventure: ({ adventure_id, title, description, xp_awarded, dm_player_id, dm_character_id, character_ids }) => {
  const run = db.transaction(() => {
    const advId = Number(adventure_id);
    const newXp = Math.max(1, parseInt(xp_awarded, 10) || 1);
    const newDmPlayerId = dm_player_id ? Number(dm_player_id) : null;
    const newDmCharId = dm_character_id ? Number(dm_character_id) : null;
    const targetCharIds = Array.from(new Set((character_ids || []).map(Number)));

    // 1. Load the current adventure
    const oldAdv = db.prepare('SELECT * FROM adventures WHERE id = ?').get(advId);
    if (!oldAdv) {
      throw new Error(`Adventure #${advId} not found.`);
    }

    const oldXp = oldAdv.xp_awarded || 0;
    const diffXp = newXp - oldXp;
    const oldDmCharId = oldAdv.dm_character_id ? Number(oldAdv.dm_character_id) : null;
    const oldDmPlayerId = oldAdv.dm_player_id ? Number(oldAdv.dm_player_id) : null;

    // 2. Compare participant lists
    const currentRewards = db.prepare('SELECT character_id FROM adventure_rewards WHERE adventure_id = ?').all(advId);
    const oldCharIds = currentRewards.map(r => r.character_id);

    const toRemove = oldCharIds.filter(id => !targetCharIds.includes(id));
    const toKeep = oldCharIds.filter(id => targetCharIds.includes(id));
    const toAdd = targetCharIds.filter(id => !oldCharIds.includes(id));

    const getCharStmt = db.prepare('SELECT xp FROM characters WHERE id = ?');

    // 3. Removed participants: take back their XP and recalculate level
    for (const charId of toRemove) {
      const char = getCharStmt.get(charId);
      if (char) {
        const nextXp = Math.max(0, char.xp - oldXp);
        updateCharacterProgression(charId, nextXp);
      }
      db.prepare('DELETE FROM adventure_rewards WHERE adventure_id = ? AND character_id = ?').run(advId, charId);
    }

    // 4. Remaining participants: adjust by the XP difference
    if (diffXp !== 0) {
      for (const charId of toKeep) {
        const char = getCharStmt.get(charId);
        if (char) {
          const nextXp = Math.max(0, char.xp + diffXp);
          updateCharacterProgression(charId, nextXp);
          db.prepare('UPDATE adventure_rewards SET xp = ? WHERE adventure_id = ? AND character_id = ?').run(newXp, advId, charId);
        }
      }
    }

    // 5. Postacie nowo dodane: przyznanie newXp
    for (const charId of toAdd) {
      const char = getCharStmt.get(charId);
      if (char) {
        const nextXp = char.xp + newXp;
        updateCharacterProgression(charId, nextXp);
        db.prepare('INSERT INTO adventure_rewards (adventure_id, character_id, xp) VALUES (?, ?, ?)').run(advId, charId, newXp);
      }
    }

    // 6. DM bonus (+1 XP to the DM's character, or +1 DM point to the player)
    if (oldDmCharId !== newDmCharId || oldDmPlayerId !== newDmPlayerId) {
      // Undo the previous DM reward
      if (oldDmCharId) {
        const prevChar = getCharStmt.get(oldDmCharId);
        if (prevChar) {
          const revXp = Math.max(0, prevChar.xp - 1);
          updateCharacterProgression(oldDmCharId, revXp);
        }
      } else if (oldDmPlayerId) {
        db.prepare('UPDATE players SET dm_points = MAX(0, dm_points - 1) WHERE id = ?').run(oldDmPlayerId);
      }

      // Przyznanie nowej nagrody DM
      if (newDmCharId) {
        const nextChar = getCharStmt.get(newDmCharId);
        if (nextChar) {
          const elevatedXp = nextChar.xp + 1;
          updateCharacterProgression(newDmCharId, elevatedXp);
        }
      } else if (newDmPlayerId) {
        db.prepare('UPDATE players SET dm_points = dm_points + 1 WHERE id = ?').run(newDmPlayerId);
      }
    }

    // 7. Save the adventure details
    db.prepare(`
      UPDATE adventures 
      SET title = ?, description = ?, xp_awarded = ?, dm_player_id = ?, dm_character_id = ?
      WHERE id = ?
    `).run(title, description || '', newXp, newDmPlayerId, newDmCharId, advId);
  });

  return run();
},

  // Spend 1 banked DM point as +1 XP on one of the player's characters
  assignDmPointToCharacter: (playerId, characterId) => {
    const run = db.transaction(() => {
      const player = db.prepare('SELECT dm_points FROM players WHERE id = ?').get(playerId);
      if (!player || player.dm_points < 1) {
        throw new Error('This player has no DM points to spend.');
      }
      const char = db.prepare('SELECT id, xp FROM characters WHERE id = ? AND player_id = ?').get(characterId, playerId);
      if (!char) {
        throw new Error('That character does not belong to this player.');
      }

      const newXp = char.xp + 1;
      db.prepare('UPDATE players SET dm_points = dm_points - 1 WHERE id = ?').run(playerId);
      updateCharacterProgression(characterId, newXp);
    });
    return run();
  },

  // Adventures
  getAllAdventures: () => db.prepare(`
    SELECT a.*, p.discord_tag AS dm_name 
    FROM adventures a
    LEFT JOIN players p ON a.dm_player_id = p.id
    ORDER BY a.created_at DESC
  `).all(),
  

  recordAdventure: ({ title, description, xp_awarded, dm_player_id, dm_character_id, character_ids }) => {
    const run = db.transaction(() => {
      const xp = Math.max(1, parseInt(xp_awarded, 10) || 1);
      const targetDmCharId = dm_character_id ? Number(dm_character_id) : null;
      const targetDmPlayerId = dm_player_id ? Number(dm_player_id) : null;

      const insertAdv = db.prepare(`
        INSERT INTO adventures (title, description, xp_awarded, dm_player_id, dm_character_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(title, description, xp, targetDmPlayerId, targetDmCharId);

      const adventureId = insertAdv.lastInsertRowid;

      // Przyznanie XP uczestnikom
      if (Array.isArray(character_ids)) {
        for (const charId of character_ids) {
          db.prepare(`
            INSERT INTO adventure_rewards (adventure_id, character_id, xp)
            VALUES (?, ?, ?)
          `).run(adventureId, charId, xp);

          const char = db.prepare('SELECT xp FROM characters WHERE id = ?').get(charId);
          if (char) {
            const nextXp = char.xp + xp;
            updateCharacterProgression(charId, nextXp);
          }
        }
      }

      // DM bonus: directly to a character, or banked with the player
      if (targetDmCharId) {
        const dmChar = db.prepare('SELECT xp FROM characters WHERE id = ?').get(targetDmCharId);
        if (dmChar) {
          const nextXp = dmChar.xp + 1;
          updateCharacterProgression(targetDmCharId, nextXp);
        }
      } else if (targetDmPlayerId) {
        db.prepare('UPDATE players SET dm_points = dm_points + 1 WHERE id = ?').run(targetDmPlayerId);
      }

      return adventureId;
    });
    return run();
  },

  addCatalogItem: ({ name, category, tier, base_price_cp, description, min_level, min_stock, max_stock }) => {
      const trimmedName = (name || '').trim();
      const trimmedCat = (category || '').trim();
      const trimmedDesc = (description || '').trim();
      const validTiers = ['staple', 'common', 'rare', 'magic', 'service'];

      if (!trimmedName) throw new Error('Item name is required.');
      if (!trimmedCat) throw new Error('Category is required.');
      if (!validTiers.includes(tier)) throw new Error(`Invalid tier selected: ${tier}`);
      
      const parsedPriceCp = parseInt(base_price_cp, 10);
      if (isNaN(parsedPriceCp) || parsedPriceCp < 0) throw new Error('Base price (in CP) must be a non-negative integer.');

      const parsedMinLevel = parseInt(min_level, 10);
      if (isNaN(parsedMinLevel) || parsedMinLevel < 1 || parsedMinLevel > 20) {
        throw new Error('Minimum party level must be between 1 and 20.');
      }

      const parsedMinStock = parseInt(min_stock, 10);
      const parsedMaxStock = parseInt(max_stock, 10);
      if (isNaN(parsedMinStock) || parsedMinStock < 0) throw new Error('Minimum stock must be a non-negative number.');
      if (isNaN(parsedMaxStock) || parsedMaxStock < parsedMinStock) {
        throw new Error('Maximum stock must be greater than or equal to minimum stock.');
      }
      if (!trimmedDesc) throw new Error('Description is required.');

      // Names must be unique
      const existing = db.prepare('SELECT id FROM catalog WHERE name = ? COLLATE NOCASE').get(trimmedName);
      if (existing) {
        throw new Error(`An item named "${trimmedName}" already exists in the Master Catalog (ID: ${existing.id}).`);
      }

      const stmt = db.prepare(`
        INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      return stmt.run(
        trimmedName,
        trimmedCat,
        tier,
        parsedPriceCp,
        trimmedDesc,
        parsedMinLevel,
        parsedMinStock,
        parsedMaxStock
      );
    },

  // Party level, used to filter the catalog by min_level
  getPartyLevel: () => {
    const row = db.prepare("SELECT value FROM config WHERE key = 'party_level'").get();
    return row ? parseInt(row.value, 10) : 1;
  },
  setPartyLevel: (level) => {
    return db.prepare("INSERT INTO config (key, value) VALUES ('party_level', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(level));
  },
  getCatalogItemsByLevel: (maxLevel) => {
    return db.prepare("SELECT * FROM catalog WHERE min_level <= ?").all(maxLevel);
  },
  
  // Rolls
  hasRolledThisWeek: (userId, weekStart) => queries.getRoll.get(userId, weekStart),
  saveRoll: (userId, username, weekStart, rollValue) => queries.saveRoll.run(userId, username, weekStart, rollValue),

  // Items
  getAllActiveItems: () => queries.getAllItems.all(),
  getAllItemsForAdmin: () => queries.getAllItemsAdmin.all(),
  findItemByName: (name) => queries.getItemByName.get(name),

 // ─── MASTER CATALOG & COUNTER SYNC (ITEMS) ────────────────────────────────

  // Pobranie pojedynczego wpisu z katalogu po ID
  getCatalogItemById: (id) => {
    return db.prepare('SELECT * FROM catalog WHERE id = ?').get(parseInt(id, 10));
  },

  // Update a catalog entry and sync it to the counter (items) immediately
  updateCatalogItem: db.transaction(({ id, name, category, tier, base_price_cp, description, min_level, min_stock, max_stock }) => {
    const trimmedName = (name || '').trim();
    const trimmedCat = (category || '').trim();
    const trimmedDesc = (description || '').trim();
    const validTiers = ['staple', 'common', 'rare', 'magic', 'service'];

    if (!trimmedName) throw new Error('Catalog item name is required.');
    if (!trimmedCat) throw new Error('Category is required.');
    if (!validTiers.includes(tier)) throw new Error(`Invalid tier: ${tier}`);
    if (isNaN(base_price_cp) || base_price_cp < 0) throw new Error('Base price (cp) must be >= 0.');
    if (isNaN(min_level) || min_level < 1) throw new Error('Min level must be >= 1.');
    if (isNaN(min_stock) || min_stock < 0) throw new Error('Min stock must be >= 0.');
    if (isNaN(max_stock) || max_stock < min_stock) throw new Error('Max stock must be >= min stock.');
    if (!trimmedDesc) throw new Error('Description is required.');

    // 1. Look up the old name to find the matching counter item
    const oldItem = db.prepare('SELECT name FROM catalog WHERE id = ?').get(parseInt(id, 10));
    if (!oldItem) throw new Error('Catalog item not found.');

    // 2. Update the master catalog
    db.prepare(`
      UPDATE catalog
      SET name = ?,
          category = ?,
          tier = ?,
          base_price_cp = ?,
          description = ?,
          min_level = ?,
          min_stock = ?,
          max_stock = ?
      WHERE id = ?
    `).run(
      trimmedName,
      trimmedCat,
      tier,
      parseInt(base_price_cp, 10),
      trimmedDesc,
      parseInt(min_level, 10),
      parseInt(min_stock, 10),
      parseInt(max_stock, 10),
      parseInt(id, 10)
    );

    // 3. If the item is currently on the counter (items), sync it now
    const shelfItem = db.prepare('SELECT id FROM items WHERE name = ? COLLATE NOCASE').get(oldItem.name);
    if (shelfItem) {
      const newPriceGp = Math.max(1, Math.round(parseInt(base_price_cp, 10) / 100));
      db.prepare(`
        UPDATE items
        SET name = ?,
            category = ?,
            price = ?,
            description = ?
        WHERE id = ?
      `).run(
        trimmedName,
        trimmedCat,
        newPriceGp,
        trimmedDesc,
        shelfItem.id
      );
    }
  }),

  // Delete from the catalog and remove it from the counter
  deleteCatalogItem: db.transaction((id) => {
    const item = db.prepare('SELECT name FROM catalog WHERE id = ?').get(parseInt(id, 10));
    if (item) {
      db.prepare('DELETE FROM items WHERE name = ? COLLATE NOCASE').run(item.name);
      db.prepare('DELETE FROM catalog WHERE id = ?').run(parseInt(id, 10));
    }
  }),
  
// ─── RESTOCK ENGINE CONFIG ───────────────────────────────────────────────
  getRestockConfig: () => {
    const rows = db.prepare("SELECT key, value FROM config WHERE key LIKE 'restock_%' OR key LIKE 'fluctuation_%' OR key = 'party_level'").all();
    const configMap = {};
    for (const r of rows) {
      configMap[r.key] = r.value;
    }
    return {
      party_level: parseInt(configMap['party_level'], 10) || 3,
      commons_count: parseInt(configMap['restock_commons_count'], 10) || 10,
      cantrips_count: parseInt(configMap['restock_cantrips_count'], 10) || 2,
      lvl1_count: parseInt(configMap['restock_lvl1_count'], 10) || 2,
      rares_count: parseInt(configMap['restock_rares_count'], 10) || 2,
      magics_count: parseInt(configMap['restock_magics_count'], 10) || 1,
      fluctuation_min: parseFloat(configMap['fluctuation_min']) || 0.85,
      fluctuation_max: parseFloat(configMap['fluctuation_max']) || 1.15
    };
  },

  setRestockConfig: ({ party_level, commons_count, cantrips_count, lvl1_count, rares_count, magics_count, fluctuation_min, fluctuation_max }) => {
    const upsert = db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const runAll = db.transaction(() => {
      upsert.run('party_level', String(party_level));
      upsert.run('restock_commons_count', String(commons_count));
      upsert.run('restock_cantrips_count', String(cantrips_count));
      upsert.run('restock_lvl1_count', String(lvl1_count));
      upsert.run('restock_rares_count', String(rares_count));
      upsert.run('restock_magics_count', String(magics_count));
      upsert.run('fluctuation_min', String(fluctuation_min));
      upsert.run('fluctuation_max', String(fluctuation_max));
    });
    runAll();
  },

  // ─── SHOP COUNTER (ITEMS) ─────────────────────────────────────────────────

  addItem: ({ name, category, price, stock, description, is_active = 1 }) => {
    const trimmedName = (name || '').trim();
    const trimmedCategory = (category || '').trim();
    const trimmedDesc = (description || '').trim();
    const parsedPrice = parseInt(price, 10);
    const parsedStock = (stock === null || stock === '' || stock === undefined) ? null : parseInt(stock, 10);

    if (!trimmedName) throw new Error('Item name is required.');
    if (!trimmedCategory) throw new Error('Category is required.');
    if (isNaN(parsedPrice) || parsedPrice < 0) throw new Error('Price must be a valid number >= 0.');
    if (parsedStock !== null && (isNaN(parsedStock) || parsedStock < 0)) {
      throw new Error('Stock must be a number >= 0 or left blank for unlimited.');
    }
    if (!trimmedDesc) throw new Error('Description is required.');

    return queries.insertItem.run({
      name: trimmedName,
      category: trimmedCategory,
      price: parsedPrice,
      stock: parsedStock,
      description: trimmedDesc,
      is_active: is_active ? 1 : 0
    });
  },

  setStock: (id, newStock) => queries.updateStock.run(newStock, id),
  setPrice: (id, newPrice) => queries.updatePrice.run(newPrice, id),
  setActive: (id, isActive) => queries.toggleActive.run(isActive ? 1 : 0, id),
  deleteItem: (id) => queries.deleteItem.run(id),

  // ─── PLAYERS & CHARACTERS ────────────────────────────────────────────────
  getAllPlayersWithCharacters: () => {
    return db.prepare(`
      SELECT 
        p.id AS player_id,
        p.discord_id,
        p.discord_tag,
        p.role,
        CASE WHEN p.password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
        p.dm_points,
        c.id AS character_id,
        c.name AS character_name,
        c.race AS character_race,
        c.class AS character_class,
        c.subclass AS character_subclass,
        c.level AS character_level,
        c.xp AS character_xp,
        c.gold_cp AS character_gold_cp,
        c.status AS character_status
      FROM players p
      LEFT JOIN characters c ON p.id = c.player_id
      ORDER BY p.discord_tag ASC, c.name ASC
    `).all();
  },

  getAllPlayers: () => db.prepare(`
    SELECT id, discord_id, discord_tag, role, dm_points, created_at,
           CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password
    FROM players
    ORDER BY discord_tag ASC
  `).all(),

  authenticatePlayer: (loginTag, password) => {
    if (typeof loginTag !== 'string' || typeof password !== 'string' ||
        loginTag.length > 256 || password.length > 256) {
      return null;
    }

    const player = db.prepare(`
      SELECT id, discord_tag, role, password_hash
      FROM players
      WHERE discord_tag = ? COLLATE NOCASE
    `).get(loginTag.trim());
    if (!player || !player.password_hash || !verifyPassword(password, player.password_hash)) {
      return null;
    }

    return {
      id: player.id,
      discord_tag: player.discord_tag,
      role: player.role || 'player'
    };
  },

  setPlayerCredentials: (playerId, plainPassword, role = 'player') => {
    const id = Number(playerId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Valid player must be selected.');
    if (typeof plainPassword !== 'string' || plainPassword.trim().length < 4 || plainPassword.length > 256) {
      throw new Error('Password must be 4-256 characters.');
    }
    if (role !== 'player' && role !== 'admin') throw new Error('Invalid account role.');

    const result = db.prepare(`
      UPDATE players
      SET password_hash = ?, role = ?
      WHERE id = ?
    `).run(hashPassword(plainPassword.trim()), role, id);
    if (result.changes === 0) throw new Error('Player not found.');
  },
  
  getCharacterById: (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id),
  updateCharacterSheet: ({ id, player_id, is_admin, name, race, class_name, subclass, sheet_data }) => {
    const characterId = Number(id);
    if (!Number.isSafeInteger(characterId) || characterId <= 0) {
      throw new Error('Invalid character ID.');
    }

    return db.transaction(() => {
      const character = db.prepare(`
        SELECT id, player_id, name, race, class, subclass, level, sheet_data
        FROM characters
        WHERE id = ?
      `).get(characterId);
      if (!character) throw new Error('Character not found.');
      if (!is_admin && character.player_id !== Number(player_id)) {
        throw new Error('Forbidden.');
      }

      const nextName = name === null || name === undefined ? character.name : name.trim();
      if (!nextName) throw new Error('Character name cannot be empty.');
      let nextSpecies = character.race;
      let nextClass = character.class;
      let nextSubclass = character.subclass;
      const updatesClassDetails =
        (race !== null && race !== undefined) ||
        (class_name !== null && class_name !== undefined) ||
        (subclass !== null && subclass !== undefined);
      if (updatesClassDetails) {
        const canonicalOptions = validateCharacterOptions(
          race === null || race === undefined ? character.race : race,
          class_name === null || class_name === undefined ? character.class : class_name,
          subclass === null || subclass === undefined ? character.subclass : subclass
        );
        nextSpecies = canonicalOptions.canonicalSpecies;
        nextClass = canonicalOptions.canonicalClass;
        nextSubclass = canonicalOptions.canonicalSubclass;
      }

      let nextSheetData;
      try {
        nextSheetData = JSON.parse(sheet_data);
      } catch {
        throw new Error('Invalid character sheet data.');
      }
      if (!nextSheetData || typeof nextSheetData !== 'object' || Array.isArray(nextSheetData)) {
        throw new Error('Character sheet data must be an object.');
      }
      // Merge over the stored sheet so fields the editor does not manage
      // (inventory, feats, languages, creation choices) survive a save.
      let storedSheetData = {};
      try {
        const parsed = JSON.parse(character.sheet_data || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) storedSheetData = parsed;
      } catch {
        // Unreadable stored data is replaced by the incoming sheet.
      }
      nextSheetData = { ...storedSheetData, ...nextSheetData };
      // Vitals change only through the vitals API, so a stale editor tab
      // cannot undo damage, rests or spent slots.
      for (const key of VITALS_KEYS) {
        if (Object.hasOwn(storedSheetData, key)) nextSheetData[key] = storedSheetData[key];
        else delete nextSheetData[key];
      }
      if (
        nextSheetData.abilities &&
        typeof nextSheetData.abilities === 'object' &&
        !Array.isArray(nextSheetData.abilities)
      ) {
        for (const [ability, value] of Object.entries(nextSheetData.abilities)) {
          const score = value && typeof value === 'object'
            ? (value.score === undefined ? value.total : value.score)
            : value;
          if (
            !['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ability) ||
            !Number.isInteger(score) ||
            score < 1 ||
            score > 30
          ) {
            throw new Error('Ability scores must be whole numbers from 1 to 30.');
          }
        }
      }

      const result = db.prepare(`
        UPDATE characters
        SET name = ?, race = ?, class = ?, subclass = ?, sheet_data = ?
        WHERE id = ?
      `).run(
        nextName,
        nextSpecies,
        nextClass,
        nextSubclass,
        JSON.stringify(nextSheetData),
        characterId
      );
      if ((class_name !== null && class_name !== undefined) ||
          (subclass !== null && subclass !== undefined)) {
        reconcileCharacterClassLevels(characterId, character.level, nextClass, nextSubclass);
      }
      return result;
    })();
  },
  updateCharacterDetailsForPlayer: ({ id, player_id, name, race, class_name, subclass }) => {
    const characterId = Number(id);
    const playerId = Number(player_id);
    const trimmedName = (name || '').trim();
    if (!Number.isSafeInteger(characterId) || characterId <= 0) throw new Error('Invalid character ID.');
    if (!Number.isSafeInteger(playerId) || playerId <= 0) throw new Error('Valid player must be selected.');
    if (!trimmedName) throw new Error('Character name is required.');

    const { canonicalSpecies, canonicalClass, canonicalSubclass } =
      validateCharacterOptions(race, class_name, subclass);
    return db.transaction(() => {
      const character = db.prepare(
        'SELECT level FROM characters WHERE id = ? AND player_id = ?'
      ).get(characterId, playerId);
      if (!character) throw new Error('Character not found.');

      const result = db.prepare(`
        UPDATE characters
        SET name = ?, race = ?, class = ?, subclass = ?
        WHERE id = ? AND player_id = ?
      `).run(
        trimmedName,
        canonicalSpecies,
        canonicalClass,
        canonicalSubclass,
        characterId,
        playerId
      );
      if (result.changes !== 1) throw new Error('Character not found.');
      reconcileCharacterClassLevels(characterId, character.level, canonicalClass, canonicalSubclass);
      return result;
    })();
  },
  getCharacterClasses: (id) => getCharacterClassRows(Number(id)),
  getCharacterAnalytics,
  getDiceAnalytics,

  addPlayer: ({ discord_id, discord_tag }) => {
    const trimmedId = (discord_id || '').trim();
    const trimmedTag = (discord_tag || '').trim();
    if (!trimmedId) throw new Error('Discord ID is required.');
    if (!trimmedTag) throw new Error('Discord Tag/Username is required.');

    const existing = db.prepare('SELECT id FROM players WHERE discord_id = ?').get(trimmedId);
    if (existing) throw new Error(`Player with Discord ID "${trimmedId}" already exists.`);

    return db.prepare('INSERT INTO players (discord_id, discord_tag) VALUES (?, ?)').run(trimmedId, trimmedTag);
  },

  updatePlayer: ({ id, discord_id, discord_tag }) => {
    const trimmedId = (discord_id || '').trim();
    const trimmedTag = (discord_tag || '').trim();
    if (!trimmedId || !trimmedTag) throw new Error('Both Discord ID and Tag are required.');

    const existing = db.prepare('SELECT id FROM players WHERE discord_id = ? AND id != ?').get(trimmedId, id);
    if (existing) throw new Error(`Another player already uses Discord ID "${trimmedId}".`);

    return db.prepare('UPDATE players SET discord_id = ?, discord_tag = ? WHERE id = ?').run(trimmedId, trimmedTag, id);
  },

  deletePlayer: (id) => {
    return db.prepare('DELETE FROM players WHERE id = ?').run(id);
  },

  addCharacter: ({ player_id, name, race, class_name, subclass = '', xp = 0, status = 'alive', gold_gp = 0 }) => {
    const pId = parseInt(player_id, 10);
    const trimmedName = (name || '').trim();
    const parsedXp = Math.max(0, parseInt(xp, 10) || 0);
    const goldCp = parseGpToCp(gold_gp);

    if (isNaN(pId)) throw new Error('Valid player must be selected.');
    if (!trimmedName) throw new Error('Character name is required.');
    if (!['alive', 'dead'].includes(status)) throw new Error('Status must be alive or dead.');
    const { canonicalSpecies, canonicalClass, canonicalSubclass } =
      validateCharacterOptions(race, class_name, subclass);
    const pLevel = calculateLevelFromXp(parsedXp);

    const run = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pId,
        trimmedName,
        canonicalSpecies,
        canonicalClass,
        canonicalSubclass,
        pLevel,
        parsedXp,
        status,
        goldCp
      );
      db.prepare(`
        INSERT INTO character_classes
          (character_id, class_name, subclass_name, class_level, is_primary)
        VALUES (?, ?, ?, ?, 1)
      `).run(result.lastInsertRowid, canonicalClass, canonicalSubclass || null, pLevel);
      return result;
    });
    return run();
  },

  updateCharacter: ({ id, player_id, name, race, class_name, subclass, xp, level, override_level, status }) => {
    const cId = parseInt(id, 10);
    const pId = parseInt(player_id, 10);
    const trimmedName = (name || '').trim();
    const trimmedRace = (race || '').trim();
    const trimmedClass = (class_name || '').trim();
    const trimmedSubclass = (subclass || '').trim();
    const parsedXp = Math.max(0, parseInt(xp, 10) || 0);

    let finalLevel = calculateLevelFromXp(parsedXp);
    if (override_level === '1' || override_level === 1 || override_level === true) {
      const manualLvl = parseInt(level, 10);
      if (!isNaN(manualLvl) && manualLvl >= 1 && manualLvl <= 20) {
        finalLevel = manualLvl;
      }
    }

    const run = db.transaction(() => {
      const result = db.prepare(`
        UPDATE characters
        SET player_id = ?, name = ?, race = ?, class = ?, subclass = ?, level = ?, xp = ?, status = ?
        WHERE id = ?
      `).run(pId, trimmedName, trimmedRace, trimmedClass, trimmedSubclass, finalLevel, parsedXp, status, cId);
      if (result.changes) {
        const existingClasses = getCharacterClassRows(cId);
        if (existingClasses.length > 1 && finalLevel !== calculateLevelFromXp(parsedXp)) {
          throw new Error('Manual level overrides must match the XP-derived level for multiclass characters.');
        }
        reconcileCharacterClassLevels(cId, finalLevel, trimmedClass, trimmedSubclass);
      }
      return result;
    });
    return run();
  },

  getCharacterAdventureIds: (characterId) => {
    const rows = db.prepare('SELECT adventure_id FROM adventure_rewards WHERE character_id = ?')
      .all(Number(characterId));
    return rows.map(row => row.adventure_id);
  },

  updateCharacterWithAdventures: ({
    id,
    player_id,
    name,
    race,
    class_name,
    subclass,
    xp,
    level,
    override_level,
    status,
    gold_gp,
    adventure_ids,
    class_allocations,
    death_adventure_id,
    death_dm_player_id,
    death_notes
  }) => {
    const run = db.transaction(() => {
      const charId = Number(id);
      const char = db.prepare('SELECT id, gold_cp FROM characters WHERE id = ?').get(charId);
      if (!Number.isSafeInteger(charId) || !char) {
        throw new Error(`Character #${id} not found.`);
      }

      const pId = parseInt(player_id, 10);
      const trimmedName = (name || '').trim();
      if (!Number.isInteger(pId)) throw new Error('Valid player must be selected.');
      if (!trimmedName) throw new Error('Character name is required.');
      if (!['alive', 'dead'].includes(status)) throw new Error('Status must be alive or dead.');

      const { canonicalSpecies, canonicalClass, canonicalSubclass } =
        validateCharacterOptions(race, class_name, subclass);
      const deathAdventureId = status === 'dead' && death_adventure_id
        ? Number(death_adventure_id)
        : null;
      const deathDmPlayerId = status === 'dead' && death_dm_player_id
        ? Number(death_dm_player_id)
        : null;
      const deathNotes = status === 'dead' ? (death_notes || '').trim() : null;
      if (deathAdventureId !== null) {
        if (!Number.isSafeInteger(deathAdventureId) || !db.prepare('SELECT 1 FROM adventures WHERE id = ?').get(deathAdventureId)) {
          throw new Error('Selected death adventure was not found.');
        }
      }
      if (deathDmPlayerId !== null) {
        if (!Number.isSafeInteger(deathDmPlayerId) || !db.prepare('SELECT 1 FROM players WHERE id = ?').get(deathDmPlayerId)) {
          throw new Error('Selected death DM was not found.');
        }
      }
      const parsedXp = parseInt(xp, 10);
      if (!Number.isSafeInteger(parsedXp) || parsedXp < 0) {
        throw new Error('Adventure XP must be a non-negative whole number.');
      }
      const goldCp = gold_gp === undefined ? char.gold_cp : parseGpToCp(gold_gp);

      const targetAdvIds = Array.from(new Set((adventure_ids || []).map(Number)));
      if (targetAdvIds.some(adventureId => !Number.isSafeInteger(adventureId) || adventureId <= 0)) {
        throw new Error('Invalid adventure selection.');
      }
      const currentRewards = db.prepare(
        'SELECT adventure_id, xp FROM adventure_rewards WHERE character_id = ?'
      ).all(charId);
      const currentAdvIds = new Set(currentRewards.map(reward => reward.adventure_id));
      const targetAdvIdSet = new Set(targetAdvIds);
      const toRemove = currentRewards.filter(reward => !targetAdvIdSet.has(reward.adventure_id));
      const toAdd = targetAdvIds.filter(adventureId => !currentAdvIds.has(adventureId));

      let adventureXpDelta = 0;
      const deleteReward = db.prepare(
        'DELETE FROM adventure_rewards WHERE adventure_id = ? AND character_id = ?'
      );
      for (const reward of toRemove) {
        adventureXpDelta -= reward.xp;
        deleteReward.run(reward.adventure_id, charId);
      }

      const getAdventure = db.prepare('SELECT xp_awarded FROM adventures WHERE id = ?');
      const insertReward = db.prepare(
        'INSERT INTO adventure_rewards (adventure_id, character_id, xp) VALUES (?, ?, ?)'
      );
      for (const adventureId of toAdd) {
        const adventure = getAdventure.get(adventureId);
        if (!adventure) {
          throw new Error(`Adventure #${adventureId} not found.`);
        }
        adventureXpDelta += adventure.xp_awarded;
        insertReward.run(adventureId, charId, adventure.xp_awarded);
      }

      const finalXp = Math.max(0, parsedXp + adventureXpDelta);
      let finalLevel = calculateLevelFromXp(finalXp);
      if (override_level === '1' || override_level === 1 || override_level === true) {
        const manualLevel = parseInt(level, 10);
        if (Number.isInteger(manualLevel) && manualLevel >= 1 && manualLevel <= 20) {
          finalLevel = manualLevel;
        }
      }

      const currentClasses = getCharacterClassRows(charId);
      const hasClassAllocations = class_allocations !== undefined && (
        currentClasses.length > 1 ||
        !Array.isArray(class_allocations) ||
        class_allocations.length > 0
      );
      if (
        finalLevel !== calculateLevelFromXp(finalXp) &&
        (currentClasses.length > 1 || hasClassAllocations)
      ) {
        throw new Error('Manual level overrides must match the XP-derived level for multiclass characters.');
      }

      const result = db.prepare(`
        UPDATE characters
        SET player_id = ?, name = ?, race = ?, class = ?, subclass = ?, level = ?, xp = ?, status = ?,
            death_adventure_id = ?, death_dm_player_id = ?, death_notes = ?, gold_cp = ?
        WHERE id = ?
      `).run(
        pId,
        trimmedName,
        canonicalSpecies,
        canonicalClass,
        canonicalSubclass,
        finalLevel,
        finalXp,
        status,
        deathAdventureId,
        deathDmPlayerId,
        deathNotes,
        goldCp,
        charId
      );

      if (hasClassAllocations) {
        if (!Array.isArray(class_allocations)) {
          throw new Error('Class allocations must be provided as a list.');
        }
        const includesPrimary = class_allocations.some(
          item => item && (item.is_primary === true || item.is_primary === 1 || item.is_primary === '1')
        );
        let allocations = class_allocations;
        if (!includesPrimary) {
          const secondaryAllocations = class_allocations.filter(item =>
            !item ||
            typeof item.class_name !== 'string' ||
            item.class_name.trim().toLowerCase() !== canonicalClass.toLowerCase()
          );
          const secondaryLevels = secondaryAllocations.reduce((sum, item) => {
            const classLevel = Number(item && item.level);
            if (!Number.isInteger(classLevel) || classLevel < 1) {
              throw new Error('Each class level must be a positive whole number.');
            }
            return sum + classLevel;
          }, 0);
          const primaryLevel = calculateLevelFromXp(finalXp) - secondaryLevels;
          if (primaryLevel < 1) {
            throw new Error('Secondary class levels must leave at least one level for the primary class.');
          }
          allocations = [
            {
              class_name: canonicalClass,
              subclass_name: canonicalSubclass,
              level: primaryLevel,
              is_primary: true
            },
            ...secondaryAllocations.map(item => ({ ...item, is_primary: false }))
          ];
        }
        const normalizedAllocations = validateCharacterLevels(charId, allocations, finalXp);
        const primaryAllocation = normalizedAllocations.find(item => item.is_primary === 1);
        if (primaryAllocation.class_name !== canonicalClass) {
          throw new Error('The primary class allocation must match the selected character class.');
        }
        replaceCharacterClasses(charId, normalizedAllocations, finalXp);
      } else {
        reconcileCharacterClassLevels(charId, finalLevel, canonicalClass, canonicalSubclass);
      }
      return result;
    });

    return run();
  },

  deleteCharacter: (id) => {
    return db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  },

  // ─── DM PANEL QUERIES ─────────────────────────────────────────────────────

  getAllCatalogItems: () => db.prepare('SELECT * FROM catalog ORDER BY name ASC').all(),
  getAllSales: () => db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 100').all(),
  getAllRolls: () => db.prepare(`
    SELECT 
      r.id,
      r.user_id,
      COALESCE(p.discord_tag, r.username, s.buyer_tag, r.user_id) AS display_name,
      r.week_start,
      r.roll_value,
      r.created_at
    FROM rolls r
    LEFT JOIN players p ON p.discord_id = r.user_id
    LEFT JOIN (
      SELECT buyer_id, buyer_tag 
      FROM sales 
      GROUP BY buyer_id
    ) s ON r.user_id = s.buyer_id
    ORDER BY r.week_start DESC, r.created_at DESC 
    LIMIT 100
  `).all(),

  // Direct database access for scripts (seed, restock, maintenance)
  db,
  prepare: (sql) => db.prepare(sql),
  transaction: (fn) => db.transaction(fn)

};