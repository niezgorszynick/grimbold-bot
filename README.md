# 🧙 Grimbold the Shopkeeper & D&D Discord Ecosystem

A Discord bot and web campaign panel for D&D 2024 campaigns. Grimbold runs an in-character shop with weekly discount rolls; the panel handles characters (2024 creation rules, level-ups, hit points, rests), adventures and XP, and the shop's catalog and restocks.

---

## 📖 Table of Contents
- [Overview & Architecture](#-overview--architecture)
- [Features](#-features)
- [Project Layout](#-project-layout)
- [Database & Migrations](#-database--migrations)
- [Roadmap](#-roadmap)
- [Setup & Deployment](#-setup--deployment)
- [Local Development & Tests](#-local-development--tests)
- [Commands Overview](#-commands-overview)

---

## 🏰 Overview & Architecture

- **Discord bot (Grimbold):** weekly d20 discount rolls, the shop counter and purchases, all in character.
- **Admin panel:** session-authenticated `/admin` web panel. DMs (`admin` role) manage the campaign; players see the shop, adventures, analytics, rolls and their own characters.
- **Backend:** Node.js, Express and **SQLite** (`better-sqlite3`, WAL mode) as the single source of truth.
- **Rules engine:** `rules/` implements the D&D 2024 rules the panel enforces (see below).
- **Hosting:** Ubuntu VPS with `pm2`; Express listens on port `10000`.

---

## ⚡ Features

- **Character creation (2024 rules):** all 16 backgrounds with their origin feats, tools and equipment; species options; Point Buy, Standard Array or rolled scores with the background bonus; class skills and tools; starting equipment or gold. Characters start at level 3 (campaign rule).
- **Level-ups:** adventure XP earns levels; players apply each one on their sheet — class or multiclass (prerequisites enforced), subclass, Ability Score Improvement or feat (general, origin, Epic Boons). Lowering XP undoes the newest level-ups exactly.
- **Hit points & rests:** max HP from the fixed-average rule, damage and healing, temporary HP, death saves, short rests with Hit Point Dice, long rests, exhaustion and spell/pact slot tracking.
- **Shop:** weekly roll discounts, stock, and purchases from the web shop or Discord `/buy` that charge the chosen character's purse (stored in copper) and add the item to their inventory.
- **Campaign tools:** adventures with XP and DM points, master catalog and restock engine, sales ledger, analytics.

Not yet implemented: spell lists and preparing spells (counts are tracked; the spell text is still to be added to `rules/content/`), auctions.

---

## 🗂️ Project Layout

| Path | Purpose |
| --- | --- |
| `index.js` | Entry point: Express app, login, Discord client and slash commands |
| `server.js` | Admin panel routes (form actions); the page is rendered by `views/` |
| `views/adminPage.js`, `views/tabs/*.js` | Admin panel page layout and one module per tab |
| `webShopApi.js` | JSON API under `/api` (characters, level-ups, vitals, shop) |
| `auth.js` | Session checks shared by the panel and the API |
| `shop.js` | Purchases (web and Discord): price, stock, purse, inventory, ledger |
| `db.js`, `db/*.js` | Database access, split by area; `db/migrations.js` holds the schema |
| `rules/` | D&D 2024 rules engine (classes, backgrounds, feats, HP, spell slots, level-ups) |
| `rules/content/` | Rules text in Markdown (format in its README) |
| `public/` | Browser scripts and CSS served at `/admin/assets/` |
| `commands/` | Discord slash commands |
| `scripts/` | Local test data seeding and a pre-deploy character check |
| `tests/` | `node --test` suite (rules engine and database) |

---

## 🗄️ Database & Migrations

The database is `data.sqlite` (override with `DB_PATH`). Its schema lives in `db/migrations.js` as numbered migrations; SQLite's `user_version` records which have run. Migrations run automatically on startup, each in its own transaction.

To change the schema, append a migration with the next version number. Versions 1–3 check what already exists so databases from before migrations were tracked upgrade safely; newer ones can assume the previous version.

Money is stored in copper pieces (`items.price`, `characters.gold_cp`, `sales.*`). The old `characters.gold_gp` column is kept as a read-only mirror (kept in sync by triggers) for rolling back to an earlier version.

---

## 🗺️ Roadmap

### Phase 1: Complete Grimbold & Deprecate Google Sheets
- [ ] Import historical sales logs and rolls from Google Sheets into SQLite (`sales`, `rolls`).
- [x] Remove `googleapis`, `sheets.js`, and `GOOGLE_KEY_FILE` dependencies.
- [x] Ignore the SQLite files in `.gitignore`.
- [ ] Set up an automated cron backup of the database.

### Phase 2: Dynamic Shop & Restock System
- [x] Master catalog (`catalog`) and the active counter (`items`), with a restock engine.
- [ ] Run restocks automatically every Monday 00:00 with price variance (0.85–1.15).

### Phase 3: Character Hub
- [x] Character sheets with 2024 creation rules, level-ups, HP, rests and spell slots.
- [ ] Spell lists and prepared spells (needs `rules/content/spells.md`).
- [ ] `/sheet` Discord command linking to the web sheet.
- [ ] `#dm-approvals` channel with interactive `[Approve]` / `[Reject]` buttons.

### Phase 4: Full Ecosystem Integration & Player Market
- [x] Link `/buy` to character sheets (deducting the purse and updating inventory).
- [ ] Auctions page where players submit magic items and bid; items with no bids sell for at least 50% of vendor value.

---

## 🚀 Setup & Deployment

1. Copy `.env.example` to `.env` and configure the Discord credentials.
2. Set `SESSION_SECRET` to a unique random value of at least 32 characters (for example `openssl rand -hex 32`). The application refuses to start without it.
3. Set a strong `ADMIN_PASSWORD` for the emergency `admin` login. Players log in with their `discord_tag`; the emergency admin sets account passwords and roles in the `/admin` Players tab. DM accounts (`admin` role) can manage the campaign but cannot change account passwords or roles. Passwords are stored as salted scrypt hashes.
4. Install dependencies and register the slash commands (re-run `npm run deploy` whenever a command's options change):

   ```bash
   npm install
   npm run deploy
   ```

5. Start with PM2:

   ```bash
   pm2 start index.js --name "grimbold-bot"
   pm2 save
   ```

Before updating a live server, back up the database and preview how existing characters look under the current rules:

```bash
node -e "require('better-sqlite3')('data.sqlite').backup('backup.sqlite').then(() => console.log('ok'))"
node scripts/check-characters.js backup.sqlite
```

---

## 🧪 Local Development & Tests

```bash
cp .env.dev.example .env.dev   # then set SESSION_SECRET
npm run seed:dev               # (re)creates data.dev.sqlite with test accounts and characters
npm run dev                    # web panel on http://localhost:10000 (Discord bot stays offline)
npm test                       # rules engine and database tests
```

The seed creates `alice` and `bob` (players) and `dungeonmaster` (DM), all with password `test1234`, plus characters in useful states (a pending level-up, a wounded caster, a dying warlock). It refuses to run against `data.sqlite`.

---

## 📜 Commands Overview

| Command | Description |
| --- | --- |
| `/roll` | Roll the weekly d20 that sets your discount (or surcharge) in Grimbold's shop. |
| `/show` | Show the current shop inventory, with your discounted prices. |
| `/buy <item> <character> [quantity]` | Buy an item for one of your characters; the price comes out of their purse. |
