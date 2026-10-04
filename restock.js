// restock.js — weekly store restock, price fluctuation and announcement on existing channel
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const dbModule = require('./db');
const sqlite = dbModule.db || dbModule;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateFluctuatedPriceCp(basePriceCp) {
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
          `"Fresh shipment arrived from the trade roads! The shelves are stocked, and the ledger has been wiped clean for the week.\n\n` +
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
  const partyLevel = typeof dbModule.getPartyLevel === 'function'
    ? dbModule.getPartyLevel()
    : 3;

  const pool = typeof dbModule.getCatalogItemsByLevel === 'function'
    ? dbModule.getCatalogItemsByLevel(partyLevel)
    : sqlite.prepare('SELECT * FROM catalog WHERE min_level <= ?').all(partyLevel);

  const staples = pool.filter(i => i.tier === 'staple');
  const commons = pool.filter(i => i.tier === 'common');
  const rares = pool.filter(i => i.tier === 'rare');
  const magics = pool.filter(i => i.tier === 'magic');

  const selectedStaples = staples;
  const selectedCommons = pickRandom(commons, 10);
  const selectedRares = pickRandom(rares, 2);   // Dokładnie 2 rare
  const selectedMagics = pickRandom(magics, 1); // Dokładnie 1 magic

  const newWeeklySelection = [
    ...selectedStaples,
    ...selectedCommons,
    ...selectedRares,
    ...selectedMagics
  ];

  const updateStore = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM items').run();

    const insertItem = sqlite.prepare(`
      INSERT INTO items (name, category, price, stock, description, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    for (const item of newWeeklySelection) {
      const stock = randomInt(item.min_stock, item.max_stock);
      const priceCp = item.tier === 'staple'
        ? item.base_price_cp
        : calculateFluctuatedPriceCp(item.base_price_cp);

      const priceGp = (priceCp / 100).toFixed(2);

      insertItem.run(
        item.name,
        item.category,
        Math.max(0, Math.round(priceCp / 100)), // gp
        stock,
        item.description,
        priceCp // nowa kolumna price_cp
        );
    }
  });

  updateStore();
  console.log(`🛒 Restock completed! Added ${newWeeklySelection.length} items to shop (Party Level: ${partyLevel}).`);

  await sendDiscordAnnouncement();
}

module.exports = { restockShop };

if (require.main === module) {
  restockShop();
}