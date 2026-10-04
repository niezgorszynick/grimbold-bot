// restock.js — weekly store restock, guaranteed scrolls, price fluctuation and Discord announcement
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const dbModule = require('./db');
const sqlite = dbModule.db || dbModule;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateFluctuatedPriceCp(basePriceCp) {
  // Wahanie rynkowe w przedziale 0.85 - 1.15
  const factor = 0.85 + Math.random() * 0.30;
  return Math.max(1, Math.round(basePriceCp * factor));
}

function pickRandom(array, count) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

async function sendDiscordAnnouncement() {
  const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
  if (!process.env.DISCORD_TOKEN || !channelId) {
    console.log('Skipping announcement: Missing DISCORD_TOKEN or ANNOUNCEMENT_CHANNEL_ID.');
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(process.env.DISCORD_TOKEN);
    const channel = await client.channels.fetch(channelId);

    if (channel && channel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle("📦 Grimbold's Shelves Have Been Restocked!")
        .setColor(0xD4AF37)
        .setDescription(
          `*The heavy oak door swings open with a creak, letting in the cool morning air.*\n\n` +
          `"Fresh shipment arrived from the trade roads! The shelves are stocked, fresh parchments and scrolls are laid out, and the ledger has been wiped clean for the week.\n\n` +
          `Step up, roll your dice with **/roll** to haggle your weekly rates, and inspect the wares with **/show** before someone else grabs them!"`
        )
        .setFooter({ text: "Grimbold the Shopkeeper • Weekly Restock" })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      console.log('✅ Weekly restock announcement sent to existing channel.');
    }
  } catch (error) {
    console.error('❌ Failed to send announcement:', error);
  } finally {
    client.destroy();
  }
}

async function restockShop() {
  const cfg = typeof dbModule.getRestockConfig === 'function'
    ? dbModule.getRestockConfig()
    : {
        party_level: 3,
        commons_count: 10,
        cantrips_count: 2,
        lvl1_count: 2,
        rares_count: 2,
        magics_count: 1,
        fluctuation_min: 0.85,
        fluctuation_max: 1.15
      };

  const partyLevel = cfg.party_level;

  function calculateFluctuatedPriceCp(basePriceCp) {
    const factor = cfg.fluctuation_min + Math.random() * (cfg.fluctuation_max - cfg.fluctuation_min);
    return Math.max(1, Math.round(basePriceCp * factor));
  }

  const pool = typeof dbModule.getCatalogItemsByLevel === 'function'
    ? dbModule.getCatalogItemsByLevel(partyLevel)
    : sqlite.prepare('SELECT * FROM catalog WHERE min_level <= ?').all(partyLevel);

  if (!pool || pool.length === 0) {
    console.error('❌ No items found in catalog for party level:', partyLevel);
    return;
  }

  // Podział na pule
  const cantripScrolls = pool.filter(i => 
    i.category === 'Spell Scroll' && i.name.startsWith('Spell Scroll (Cantrip:')
  );
  const level1Scrolls = pool.filter(i => 
    i.category === 'Spell Scroll' && i.name.startsWith('Spell Scroll (Level 1:')
  );
  const generalCommons = pool.filter(i => 
    i.tier === 'common' && 
    i.category !== 'Spell Scroll' && 
    i.category !== 'Scroll' && 
    !i.name.toLowerCase().includes('scroll')
  );
  const rares = pool.filter(i => i.tier === 'rare' && !i.name.toLowerCase().includes('scroll'));
  const magics = pool.filter(i => i.tier === 'magic' && !i.name.toLowerCase().includes('scroll'));
  const staples = pool.filter(i => i.tier === 'staple');

  // Losowanie według dynamicznej konfiguracji
  const selectedStaples = staples;
  const selectedCommons = pickRandom(generalCommons, cfg.commons_count);
  const selectedCantrips = pickRandom(cantripScrolls, cfg.cantrips_count);
  const selectedLevel1 = pickRandom(level1Scrolls, cfg.lvl1_count);
  const selectedRares = pickRandom(rares, cfg.rares_count);
  const selectedMagics = pickRandom(magics, cfg.magics_count);

  const newWeeklySelection = [
    ...selectedStaples,
    ...selectedCommons,
    ...selectedCantrips,
    ...selectedLevel1,
    ...selectedRares,
    ...selectedMagics
  ];

  // Atomowy zapis do items (bez zmian)
  const updateStore = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM items').run();
    const insertItem = sqlite.prepare(`
      INSERT INTO items (name, category, price, stock, description, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    for (const item of newWeeklySelection) {
      const stock = randomInt(item.min_stock, item.max_stock);
      const finalPriceCp = item.tier === 'staple'
        ? item.base_price_cp
        : calculateFluctuatedPriceCp(item.base_price_cp);

      insertItem.run(item.name, item.category, finalPriceCp, stock, item.description);
    }
  });

  updateStore();
  console.log(`🛒 Restock completed with custom config (Level: ${partyLevel})!`);
  await sendDiscordAnnouncement();
}

module.exports = { restockShop };

if (require.main === module) {
  restockShop();
}