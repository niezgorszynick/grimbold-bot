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
  const partyLevel = typeof dbModule.getPartyLevel === 'function'
    ? dbModule.getPartyLevel()
    : 3;

  const pool = typeof dbModule.getCatalogItemsByLevel === 'function'
    ? dbModule.getCatalogItemsByLevel(partyLevel)
    : sqlite.prepare('SELECT * FROM catalog WHERE min_level <= ?').all(partyLevel);

  if (!pool || pool.length === 0) {
    console.error('❌ No items found in catalog for party level:', partyLevel);
    return;
  }

  // 1. Podział przedmiotów ze względu na tiery i zwoje
  const staples = pool.filter(i => i.tier === 'staple');
  const rares = pool.filter(i => i.tier === 'rare');
  const magics = pool.filter(i => i.tier === 'magic');

  // Dedykowana pula zwojów (kategoria Spell Scroll lub nazwa zaczynająca się od Spell Scroll)
  const cantripScrolls = pool.filter(i => 
    i.category === 'Spell Scroll' && i.name.startsWith('Spell Scroll (Cantrip:')
  );
  const level1Scrolls = pool.filter(i => 
    i.category === 'Spell Scroll' && i.name.startsWith('Spell Scroll (Level 1:')
  );

  // Pula zwykłych przedmiotów common (z wyłączeniem zwojów, aby nie wypierały ekwipunku)
  const generalCommons = pool.filter(i => 
    i.tier === 'common' && i.category !== 'Spell Scroll' && !i.name.startsWith('Spell Scroll')
  );

  // 2. Wybór asortymentu na bieżący tydzień:
  const selectedStaples = staples;
  const selectedCommons = pickRandom(generalCommons, 12); // 12 zwykłych przedmiotów
  const selectedCantrips = pickRandom(cantripScrolls, 3);  // Zawsze 3 losowe cantripy
  const selectedLevel1 = pickRandom(level1Scrolls, 2);     // Zawsze 2 losowe zaklęcia 1. kręgu
  const selectedRares = pickRandom(rares, 2);              // 2 rzadkie przedmioty
  const selectedMagics = pickRandom(magics, 1);            // 1 przedmiot magiczny

  const newWeeklySelection = [
    ...selectedStaples,
    ...selectedCommons,
    ...selectedCantrips,
    ...selectedLevel1,
    ...selectedRares,
    ...selectedMagics
  ];

  // 3. Atomowa aktualizacja lady sklepowej w transakcji SQLite
  const updateStore = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM items').run();

    const insertItem = sqlite.prepare(`
      INSERT INTO items (name, category, price, stock, description, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    for (const item of newWeeklySelection) {
      const stock = randomInt(item.min_stock, item.max_stock);
      
      // Staple mają stałą cenę bazową, reszta asortymentu podlega wahaniom
      const finalPriceCp = item.tier === 'staple'
        ? item.base_price_cp
        : calculateFluctuatedPriceCp(item.base_price_cp);

      insertItem.run(
        item.name,
        item.category,
        finalPriceCp,
        stock,
        item.description
      );
    }
  });

  updateStore();

  console.log(`🛒 Restock completed! Added ${newWeeklySelection.length} items to shop (Party Level: ${partyLevel}):`);
  console.log(`   - Staples: ${selectedStaples.length}`);
  console.log(`   - Common goods: ${selectedCommons.length}`);
  console.log(`   - Guaranteed Cantrip scrolls: ${selectedCantrips.length}`);
  console.log(`   - Guaranteed Level 1 scrolls: ${selectedLevel1.length}`);
  console.log(`   - Rares: ${selectedRares.length}`);
  console.log(`   - Magic: ${selectedMagics.length}`);

  await sendDiscordAnnouncement();
}

module.exports = { restockShop };

if (require.main === module) {
  restockShop();
}