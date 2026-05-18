# ⚗️ Grimbold's Emporium — Discord Shopkeeper Bot

A D&D-flavoured Discord bot backed by Google Sheets inventory.
Players can browse the shop, roll for weekly discounts, and post purchase receipts.

---

## Commands

| Command | Description |
|---|---|
| `/show` | Display all inventory (with prices, stock, and your active discount) |
| `/show category:Potions` | Filter by category |
| `/roll` | Roll a d20 for a weekly discount (once per player per week) |
| `/buy item:Health Potion` | Purchase an item |
| `/buy item:Rope quantity:3` | Purchase multiple units |

### Discount Table (d20 roll)

| Roll | Discount |
|---|---|
| 11–13 | −5% |
| 2–10 | 0% — standard price |
| **1** | **+10%** — Nat 1 surcharge! |
| 6–10 | 5% |
| 11–15 | 10% |
| 16–19 | 15% |
| **20** | **25%** — *Natural 20!* |

Discounts reset every **Monday at midnight UTC**.

---

## Google Sheet Format

Create a sheet named **`Items`** with this layout:

| A: Name | B: Description | C: Price (gp) | D: Stock | E: Category |
|---|---|---|---|---|
| Health Potion | Restores 2d4+2 HP | 50 | ∞ | Potions |
| Rope (50ft) | Hempen rope | 1 | 12 | Adventuring Gear |
| Shortsword | A trusty blade | 10 | 3 | Weapons |

- **Stock**: use a number for limited stock, or `∞` for unlimited.
- **Column F (Status)**: leave blank — the bot writes `Sold Out` here automatically when stock hits 0.

The bot also auto-creates a **Sales** tab to log every transaction (timestamp, buyer, item, price paid, modifier applied).
- Row 1 is the header row (skipped automatically).

---

## Setup

### 1. Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, click **Add Bot** and copy your **Token** → `DISCORD_TOKEN`.
3. Copy the **Application ID** → `CLIENT_ID`.
4. Under **OAuth2 → URL Generator**, select scopes: `bot`, `applications.commands`.
   Permissions needed: `Send Messages`, `Embed Links`, `Read Message History`.
5. Invite the bot to your server using the generated URL. Copy your **Server ID** → `GUILD_ID`.

> **Note**: The bot needs **Editor** access on the Google Sheet (not just Viewer) to log sales and update stock.

> **Privileged Intents**: No privileged intents are needed for slash commands.

---

### 2. Set Up Google Sheets API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project.
2. Enable the **Google Sheets API** for the project.
3. Create a **Service Account**: IAM & Admin → Service Accounts → Create.
4. Generate a JSON key for the service account and save it as `service-account.json` in the bot folder.
5. Copy the service account's email address (looks like `name@project.iam.gserviceaccount.com`).
6. **Share your Google Sheet** with that email address (Viewer permission is enough).
7. Copy your sheet's ID from its URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
   → `SPREADSHEET_ID`

---

### 3. Configure the Bot

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
DISCORD_TOKEN=your_token
CLIENT_ID=your_client_id
GUILD_ID=your_server_id
SPREADSHEET_ID=your_sheet_id
GOOGLE_KEY_FILE=./service-account.json

# Optional: paste a channel ID here to have /show post to a dedicated shop channel
SHOP_CHANNEL_ID=
```

---

### 4. Install & Run

```bash
npm install

# Register slash commands with Discord (run once, and whenever you add new commands)
npm run deploy

# Start the bot
npm start
```

---

## File Structure

```
grimbold-bot/
├── commands/
│   ├── show.js          # /show — browse inventory
│   ├── buy.js           # /buy  — purchase an item
│   └── roll.js          # /roll — weekly d20 discount roll
├── index.js             # Bot entry point
├── sheets.js            # Google Sheets integration
├── rollTracker.js       # Per-user weekly roll persistence
├── deploy-commands.js   # Register slash commands with Discord
├── rolls.json           # Auto-created: stores weekly roll data
├── service-account.json # Your Google service account key (keep secret!)
├── .env                 # Your secrets (keep secret!)
└── package.json
```

---

## Tips & Customisation

- **Shopkeeper personality**: search for Grimbold's dialogue strings in the command files and rewrite to taste.
- **More commands**: add a new file to `commands/`, export `{ data, execute }`, and re-run `npm run deploy`.
- **Hosting**: the bot runs as a simple Node.js process. Free options include [Railway](https://railway.app), [Fly.io](https://fly.io), or a cheap VPS.
- **rolls.json** grows over time but stays small — old week keys are never cleaned up automatically. Feel free to delete it; players just lose their roll history.
