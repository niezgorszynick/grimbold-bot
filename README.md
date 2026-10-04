# 🧙 Grimbold the Shopkeeper & D&D Discord Ecosystem

A modular Discord bot ecosystem designed for D&D 5e campaigns. The project combines atmospheric roleplay with robust campaign utilities: shop mechanics, dice rolls, character inventory tracking, and player marketplaces.

---

## 📖 Table of Contents
- [Overview & Architecture](#-overview--architecture)
- [Key Features](#-key-features)
- [Current State (October 2026)](#-current-state-october-2026)
- [Database Schema](#-database-schema)
- [Roadmap](#-roadmap)
- [Setup & Deployment](#-setup--deployment)
- [Commands Overview](#-commands-overview)

---

## 🏰 Overview & Architecture

- **Primary Bot (Grimbold):** Manages weekly d20 discount rolls, store inventory, sales logging, and in-character English RP dialogues.
- **Backend & Database:** Node.js, Express web server, and local **SQLite** (`better-sqlite3`) running in **WAL mode** as the single source of truth.
- **Hosting:** Ubuntu VPS managed via `pm2` with Express listening on port `10000`.
- **Admin Interface:** HTTP Basic Auth-secured panel (`/admin`) for Dungeon Masters to manage catalogue items and inventory.

---

## ⚡ Current State (October 4, 2026)

- [x] **SQLite Migration:** Transitioned weekly d20 discount rolls from Google Sheets to SQLite (`rolls`).
- [x] **Catalogue Seeding:** Initial 12 items imported into the `items` table.
- [x] **DM Admin Dashboard:** Built `/admin` panel in Express with strict input validation (disallowing incomplete items).
- [x] **Discord Embed Fix:** Implemented field chunking in `/show` to prevent Discord's 1024-character embed limit errors.
- [x] **Sales Schema:** Prepared transactional `sales` table schema matching historical tracking needs.

---

## 🗺️️ Long-Term Roadmap

### Phase 1: Complete Grimbold & Deprecate Google Sheets (Current Focus)
- [ ] Import historical sales logs and rolls from Google Sheets into SQLite (`sales`, `rolls`).
- [ ] Remove `googleapis`, `sheets.js`, and `GOOGLE_KEY_FILE` dependencies.
- [ ] Configure `.gitignore` for SQLite files (`data.sqlite`, `data.sqlite-wal`, `data.sqlite-shm`) and set up an automated cron backup.

### Phase 2: Dynamic Shop & Restock System
- [ ] Split catalog storage into `catalog` (master item pool) and `shop_inventory` (active weekly items).
- [ ] Implement a Monday 00:00 cron job for automatic restocks with price variance ($0.85$–$1.15$).

### Phase 3: Character Hub Bot
- [ ] Design character sheet database schema (stats, levels, spell slots, inventory, gold pouch `gp`).
- [ ] Add `/sheet edit` command generating one-time web tokens for browser-based sheet editing.
- [ ] Set up `#dm-approvals` channel with interactive Discord buttons (`[Approve]` / `[Reject]`).

### Phase 4: Full Ecosystem Integration & Player Market
- [ ] Link `/buy` directly with character sheets (deducting gold pouch and updating inventory).
- [ ] Implement an in-game Auction House (`/auction create` with Discord bidding buttons).

---

## 🗄️ Database Schema

The SQLite database (`data.sqlite`) utilizes the following structure:

```sql
-- Weekly discount rolls (resets every Monday at 00:00)
CREATE TABLE IF NOT EXISTS rolls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  roll_value INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, week_start)
);

-- Active shop items and master listing
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

-- Transaction history
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
🚀 Setup & Deployment1. Environment VariablesCopy .env.example to .env and fill in the required variables:BashDISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id
PORT=10000
ADMIN_PASSWORD=your_secure_password
2. InstallationBashnpm install
node deploy-commands.js
3. Running with PM2Bashpm2 start index.js --name "grimbold-bot"
pm2 save
📜 Commands OverviewCommandDescription/rollRoll a weekly d20 check to determine your personal discount in Grimbold's shop./showDisplay the current shop inventory, categorized with chunked embeds./buy [item] [quantity]Purchase an item applying the active weekly discount.
