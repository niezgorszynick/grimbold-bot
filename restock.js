// restock.js — The weekly store restock (rules in db/restock.js) and its
// Discord announcement. Run directly (`node restock.js`) by the weekly job, or
// from the Restock Engine tab.
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const db = require('./db');

// "Bag of Holding, Cloak of Protection and 2 more"
function listNames(names, max = 6) {
  if (!names.length) return 'nothing new';
  const shown = names.slice(0, max);
  return names.length > max ? `${shown.join(', ')} and ${names.length - max} more` : shown.join(', ');
}

async function sendDiscordAnnouncement(summary) {
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
        .addFields(
          ...(summary.event ? [{ name: `📣 ${summary.event.title}`, value: summary.event.announcement.slice(0, 1000), inline: false }] : []),
          ...(summary.merchantGoods.length ? [{ name: '🧳 From the visiting merchant', value: listNames(summary.merchantGoods), inline: false }] : []),
          { name: '✨ New in the vault', value: listNames(summary.newMagic), inline: false },
          { name: '📜 In the scroll case', value: listNames(summary.scrolls), inline: false },
          ...require('./shopAnnouncements').reservationRestockFields(summary.reserved)
        )
        .setFooter({ text: "Grimbold the Shopkeeper • Weekly Restock • /show mundane for everyday gear" })
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
  const summary = db.runRestock();
  console.log(`🛒 Restock completed (party level ${summary.partyLevel}): ${summary.newMagic.length} new magic items, ${summary.keptMagic} kept, ${summary.scrolls.length} scrolls, ${summary.mundane} mundane items, ${summary.artisanGoods} artisan goods${summary.event ? `; event: ${summary.event.title}` : ''}.`);
  await sendDiscordAnnouncement(summary);
  // Reservations that ran out or were refunded (in the panel; the bot's notes need its client).
  const threads = require('./characterThreads');
  (summary.reserved ? summary.reserved.expired : []).forEach(reservation => threads.announceReservation('expired', reservation));
  (summary.reserved ? summary.reserved.refunded : []).forEach(reservation => threads.announceReservation('refunded', reservation));
  return summary;
}

module.exports = { restockShop };

if (require.main === module) {
  restockShop();
}
