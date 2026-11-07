# 🧙 Grimbold the Shopkeeper & D&D Discord Ecosystem

A Discord bot and web campaign panel for a D&D 2024 one-shot community. Grimbold runs an in-character shop on Discord; the panel handles everything around it: characters built and levelled by the 2024 rules, adventures and their Discord threads, encounters, session scheduling, a world map with fog of war, auctions, and the campaign's news.

---

## 📖 Table of Contents
- [Overview & Architecture](#-overview--architecture)
- [Features](#-features)
- [Project Layout](#-project-layout)
- [Database & Migrations](#-database--migrations)
- [Rules Text (kept off Git)](#-rules-text-kept-off-git)
- [Setup & Deployment](#-setup--deployment)
- [Configuration](#-configuration)
- [Local Development & Tests](#-local-development--tests)
- [Commands Overview](#-commands-overview)
- [Roadmap](#-roadmap)

---

## 🏰 Overview & Architecture

- **Discord bot:** Grimbold keeps the shop; Grimbrandt, his clerk, keeps the adventure ledger (threads, sessions, reminders). Both speak in character.
- **Web panel:** session-authenticated `/admin`. DMs (`admin` role) run the campaign; players see the shop, their characters, adventures they take part in, the map, sessions and the news.
- **Backend:** Node.js, Express 5 and **SQLite** (`better-sqlite3`, WAL mode) as the single source of truth.
- **Rules engine:** `rules/` implements the D&D 2024 rules the panel enforces: creation, level-ups, hit points, spells, combat, class resources.
- **Owlbear Rodeo:** a small extension (`vtt/`) sends panel dice rolls and encounter initiative to the virtual tabletop.
- **Hosting:** an Ubuntu VPS with `pm2` behind nginx; Express listens on port `10000`.

---

## ⚡ Features

### Characters
- **Creation (2024 rules):** all 16 backgrounds with their origin feats, tools and equipment; species and lineages; Point Buy, Standard Array or rolled scores; class skills, tools and starting gear. Characters start at level 3 (campaign rule).
- **Level-ups:** adventure XP earns levels that players apply on their sheet: class or multiclass (prerequisites checked), subclass, Ability Score Improvement or feat (general, origin, Epic Boons, playtest Paths of Villainy). Lowering XP undoes the newest level-ups exactly.
- **The sheet:** hit points, death saves, rests and Hit Point Dice, exhaustion, spell and pact slots, class resources with their dice (Rage, Channel Divinity, Infernal Wound…), a Defenses block (resistances, senses, creature type), armor class and attacks from worn gear (pact weapons and Eldritch Blast included), and an Appearance section.
- **Spells:** choosing, preparing and casting with the 2024 change rules, Wizard spellbooks, Warlock invocations, feat and species spells, concentration.
- **Wild Shape:** learned beast forms, Circle of the Stars' Starry Form, Circle of the Titan's Titan Forms; the stat block rolls while transformed.
- **Magic items, gifts and portraits:** attunement and charges, items given between characters (logged), and an uploaded portrait.
- **Dice:** every number on the sheet rolls on the server, is logged in Rolls History, and can go to Owlbear.

### Shop & economy
- Weekly d20 price rolls, the shop counter, and purchases from the web or Discord charged to a character's purse (in copper).
- Master catalog and a restock engine with artisans and shop events; reservations that hold an item through restocks.
- Auctions (`/sell`, `/bid`) with NPC bidders, settled automatically, and a sales ledger.

### Adventures & encounters
- A new thread in the adventures channel opens an adventure run by its starter; the panel's adventure table shows the party live and the thread is closed with Grimbrandt's summary when it ends (0 XP allowed, with a confirmation).
- Encounters built from a monster catalog (5etools imports, book filters, homebrew statblocks per adventure) against the 2024 XP budget, run with initiative, HP tracking and monster rolls the DM reveals when they choose.
- Notable NPCs with portraits, who can speak in a thread.

### Scheduling
- `/schedule` polls in adventure threads (✅ / 🤔 / ❌ buttons, Polish time), booking from Discord or the panel, clash warnings across all games, Discord server events, day-before reminders, and personal calendar feeds that update themselves.
- **Campaigns** run outside the adventure threads (`/campaign`) share the same calendar, managed from Discord or the panel's Sessions tab.

### World map
- A hex map on an uploaded image, with DM markers (secret or shown) linked to adventures.
- Players see only the hexes their characters have visited (adventure routes and hand reveals) plus hexes revealed to everyone; the rest is fogged.
- DM tools: paint hexes by dragging, fill a whole sea at once, look through a player's eyes, full-screen mode.

### Campaign tools
- Adventures with XP and DM points, players and roles, analytics, and a Changelog tab of news pages (`public/news/`, also public at `/news/<name>`).

---

## 🗂️ Project Layout

| Path | Purpose |
| --- | --- |
| `index.js` | Entry point: Express app, login, Discord client, slash commands, background jobs |
| `server.js` | Admin panel routes (form actions); pages are rendered by `views/` |
| `views/adminPage.js`, `views/tabs/*.js` | Panel layout and one module per tab |
| `webShopApi.js` | JSON API under `/api` (characters, spells, vitals, adventures, encounters, map, sessions…) |
| `auth.js` | Session checks shared by the panel and the API |
| `shop.js`, `restock.js`, `shopAnnouncements.js`, `auctionNews.js` | Purchases, restocks and their Discord posts |
| `adventureThreads.js`, `characterThreads.js` | Adventure and character threads on Discord |
| `scheduleDiscord.js`, `calendar.js` | Session polls, announcements, reminders, server events, calendar feeds |
| `vtt.js`, `vtt/` | Owlbear Rodeo extension and its API |
| `db.js`, `db/*.js` | Database access, split by area; `db/migrations.js` holds the schema |
| `rules/` | D&D 2024 rules engine |
| `rules/content/` | Rules text in Markdown (format in its README; book text is kept off Git) |
| `public/` | Browser scripts and CSS served at `/admin/assets/`; `public/news/` holds the news pages |
| `commands/` | Discord slash commands |
| `scripts/` | Test data seeding and pre-deploy checks |
| `tests/` | `node --test` suite |

---

## 🗄️ Database & Migrations

The database is `data.sqlite` (override with `DB_PATH`); uploads (portraits, the map image) go to `uploads/` next to it (override with `UPLOADS_DIR`). The schema lives in `db/migrations.js` as numbered migrations; SQLite's `user_version` records which have run, and they run automatically on startup, each in its own transaction.

To change the schema, append a migration with the next version number. A migration that rebuilds a table other tables point to sets `foreignKeysOff: true` (see migration 33), because foreign keys can only be switched off outside a transaction.

Money is stored in copper pieces (`items.price`, `characters.gold_cp`, `sales.*`).

---

## 📚 Rules Text (kept off Git)

This repository is public, and text from the D&D books (and "personal use" playtest material) can't be published. The rules engine works without it; the text only adds descriptions. These files are listed in `.gitignore` and are copied to the server by hand:

`rules/content/spells.md`, `feats.md`, `invocations.md`, `magic_items.md`, `beasts.md`, `monsters.md`, `subclasses.md`

```bash
scp rules/content/subclasses.md rules/content/feats.md vps:/var/www/grimbold-bot/rules/content/
```

Short summaries in our own words (`*.fallback.md`) are committed and fill gaps. Monsters can also be imported from 5etools files in the panel's Monsters tab; those stay in the database.

---

## 🚀 Setup & Deployment

1. Copy `.env.example` to `.env` and fill it in (see [Configuration](#-configuration)).
2. Set `SESSION_SECRET` to a unique random value of at least 32 characters (`openssl rand -hex 32`). The application refuses to start without it.
3. Set a strong `ADMIN_PASSWORD` for the emergency `admin` login (the Root DM). Players log in with their `discord_tag`; the Root DM sets account passwords and roles in the Players tab. Passwords are stored as salted scrypt hashes.
4. Install dependencies and register the slash commands (re-run `npm run deploy` whenever a command or its options change):

   ```bash
   npm install
   npm run deploy
   ```

5. Start with PM2:

   ```bash
   pm2 start index.js --name "grimbold-bot"
   pm2 save
   ```

6. In Discord, give the bot **Manage Events** (session server events) and **Manage Webhooks** in the adventures channel (Grimbrandt speaks through a webhook).
7. Schedule the weekly restock (it also posts to Discord), for example with cron every Monday at 00:00:

   ```bash
   0 0 * * 1 cd /var/www/grimbold-bot && node restock.js
   ```

8. If nginx sits in front, uploads go through in small pieces, so its default `client_max_body_size` is enough.

Before updating a live server, back up the database and preview how existing characters look under the current rules:

```bash
node -e "require('better-sqlite3')('data.sqlite').backup('backup.sqlite').then(() => console.log('ok'))"
node scripts/check-characters.js backup.sqlite
```

---

## ⚙️ Configuration

| Setting | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` | yes | The bot and the server its commands are registered on |
| `SESSION_SECRET` | yes | Signs panel sessions (32+ random characters) |
| `ADMIN_PASSWORD` | yes | The emergency `admin` (Root DM) login |
| `PANEL_URL` | recommended | The panel's public address, for links in Discord, calendar feeds and news pages |
| `ADVENTURE_CHANNEL_ID` | recommended | The forum/channel whose threads become adventures |
| `CHARACTER_THREADS_CHANNEL_ID` | optional | Where each character's thread lives (gifts, sales) |
| `ANNOUNCEMENT_CHANNEL_ID` | optional | Shop news: purchases, restocks, reservations, auctions |
| `AUCTIONS_CHANNEL_ID` | optional | Auction news, if not in the announcement channel |
| `NAT_ROLLS_CHANNEL_ID` | optional | Natural 1s and 20s are announced here |
| `CAMPAIGN_DM_IDS` | optional | Discord IDs (comma-separated) of DMs without a panel DM account who may run `/campaign` |
| `GRIMBRANDT_AVATAR_URL` | optional | Avatar for Grimbrandt's webhook posts |
| `PORT`, `DB_PATH`, `UPLOADS_DIR` | optional | Defaults: `10000`, `data.sqlite`, `uploads/` |

---

## 🧪 Local Development & Tests

```bash
cp .env.dev.example .env.dev   # then set SESSION_SECRET
npm run seed:dev               # (re)creates data.dev.sqlite with test accounts and characters
npm run dev                    # web panel on http://localhost:10000 (Discord bot stays offline)
npm test                       # the whole suite (rules engine, database, API, Discord handlers)
```

The seed creates `alice` and `bob` (players) and `dungeonmaster` (DM), all with password `test1234`, plus characters in useful states. It refuses to run against `data.sqlite`. Tests use temporary databases and their own rules-text fixtures, so they pass without the files kept off Git.

---

## 📜 Commands Overview

| Command | Description |
| --- | --- |
| `/roll` | Roll the weekly d20 that sets your prices in Grimbold's shop. |
| `/show` | Show the shop's stock with your prices. |
| `/buy` | Buy an item for one of your characters; the price comes out of their purse. |
| `/sell` | Put one of your character's magic items up for auction (7 days). |
| `/bid` | Bid on an item at Grimbold's auction. |
| `/schedule` | In an adventure thread: `propose` times for a poll, `set` or `move` a session, `cancel`, and your personal `calendar` link. |
| `/sessions` | The sessions of the next two weeks (`mine` for just yours). |
| `/campaign` | Campaigns outside the adventure threads: `create`, `add` / `remove` players, `set` / `move` / `cancel` sessions, `info`. |

---

## 🗺️ Roadmap

- [x] Shop with catalog, restocks, artisans, reservations, auctions and gifts
- [x] Character hub: 2024 creation, level-ups, vitals, spells, magic items, Wild Shape, combat
- [x] Adventures with Discord threads, encounters, monsters, NPCs and Owlbear initiative
- [x] Scheduling with polls, calendars and campaigns
- [x] World map with fog of war
- [ ] Automated database backups
- [ ] `/sheet` command linking to the web sheet
- [ ] Feature descriptions for the official subclasses (text to be added to `rules/content/subclasses.md`)
