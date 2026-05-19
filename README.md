# ⚗️ Grimbold's Emporium — Discord Shopkeeper Bot

A D&D-flavoured Discord bot backed entirely by Google Sheets.
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

Your Google Spreadsheet acts as the complete backend database. It requires the following tabs:

### 1. `Items` (Active Shop)
Create a sheet named **`Items`** with this exact layout in Row 1:

| A: Name | B: Description | C: Price (gp) | D: Stock | E: Category | F: Status |
|---|---|---|---|---|---|
| Health Potion | Restores 2d4+2 HP | 50 | ∞ | Potions | |
| Rope (50ft) | Hempen rope | 1 | 12 | Adventuring Gear | |

- **Stock**: use a number for limited stock, or `∞` for unlimited.
- **Column F (Status)**: leave blank — the bot writes `Sold Out` here automatically when stock hits 0.

### 2. `Rolls` (Weekly Haggle Tracking)
Create a completely blank sheet named **`Rolls`**.
- The bot automatically saves player d20 rolls here across the internet so they persist between server restarts. No headers are needed.

### 3. `Sales` (Receipt Ledger)
You do not need to create this! The bot auto-creates a **`Sales`** tab to log every single transaction (timestamp, buyer, item, price paid, modifier applied) upon the very first purchase.

### 4. `Catalogue` (Optional Master Database)
Create a sheet named **`Catalogue`** to store hundreds of items in the background. 
- You can set up the `Items` tab to use Google Sheets Data Validation (Dropdowns) to pull names directly from the `Catalogue`, using `=ARRAYFORMULA` to auto-fill the descriptions and prices.

---

## Setup

### 1. Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, click **Add Bot** and copy your **Token** → `DISCORD_TOKEN`.
3. Copy the **Application ID** → `CLIENT_ID`.
4. Under **OAuth2 → URL Generator**, select scopes: `bot`, `applications.commands`.
   Permissions needed: `Send Messages`, `Embed Links`, `Read Message History`.
5. Invite the bot to your server using the generated URL. Copy your **Server ID** → `GUILD_ID`.

> **Note**: The bot needs **Editor** access on the Google Sheet (not just Viewer) to log sales, update stock, and track rolls.

> **Privileged Intents**: No privileged intents are needed for slash commands.

---

### 2. Set Up Google Sheets API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project.
2. Enable the **Google Sheets API** for the project.
3. Create a **Service Account**: IAM & Admin → Service Accounts → Create.
4. Generate a JSON key for the service account and save it as `service-account.json` in the bot folder.
5. Copy the service account's email address (looks like `name@project.iam.gserviceaccount.com`).
6. **Share your Google Sheet** with that email address, making sure to grant **Editor** permission.
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
├── index.js             # Bot entry point & Express health check server
├── sheets.js            # Google Sheets integration (Read/Write)
├── rollTracker.js       # Bridges the roll logic to Google Sheets
├── deploy-commands.js   # Register slash commands with Discord
├── service-account.json # Your Google service account key (keep secret!)
├── .env                 # Your secrets (keep secret!)
└── package.json
```

---

## Tips & Customisation

- **Shopkeeper personality**: search for Grimbold's dialogue strings in the command files and rewrite to taste.
- **More commands**: add a new file to `commands/`, export `{ data, execute }`, and re-run `npm run deploy`.
- **Hosting on Render**: The bot includes a built-in Express web server (port 10000) for health checks. To host it 24/7 on Render's free tier, deploy it as a Web Service and use a free uptime monitor (like cron-job.org) to ping your Render URL every 14 minutes. This prevents the bot from going to sleep!

