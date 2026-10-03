// commands/show.js — displays all active items grouped by category with player discounts
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { getUserRoll, getDiscount, applyModifier } = require('../rollTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('show')
    .setDescription("View Grimbold's current inventory and your personal prices"),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const items = db.getAllActiveItems();

      if (!items || items.length === 0) {
        return interaction.editReply({
          content:
            `*Grimbold sweeps an arm across bare wooden shelves.*\n` +
            `"Nothing for sale right now, traveler. Check back soon."`,
        });
      }

      // Check player's weekly roll
      const roll = getUserRoll(interaction.user.id);
      const modifier = roll !== null ? getDiscount(roll) : null;

      // Header description explaining the prices shown
      let headerDesc = `*"Welcome, traveler. These prices are between you and me."*\n\n`;
      if (modifier && modifier.percent !== 0) {
        const sign = modifier.percent < 0 ? 'discount' : 'surcharge';
        headerDesc += `*Prices shown already include your **${Math.abs(modifier.percent)}% ${sign}** from this week's roll.*`;
      } else if (roll !== null) {
        headerDesc += `*Standard prices apply to you this week.*`;
      } else {
        headerDesc += `*You haven't rolled for a discount this week! Use \`/roll\` to try your luck.*`;
      }

      const embed = new EmbedBuilder()
        .setTitle("Grimbold's Emporium — Your Prices")
        .setColor(0x2B2D31)
        .setDescription(headerDesc);

      // Group items by category (preserving insertion order)
      const categories = {};
      for (const item of items) {
        const cat = item.category || 'General';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(item);
      }

      for (const [catName, catItems] of Object.entries(categories)) {
        const lines = catItems.map(item => {
          const finalPrice = modifier ? applyModifier(item.price, modifier) : item.price;
          const isSoldOut = item.stock !== null && item.stock <= 0;

          let stockTag = '';
          if (isSoldOut) stockTag = ' **(Sold Out)**';
          else if (item.stock !== null) stockTag = ` (${item.stock} left)`;

          let priceStr = '';
          if (isSoldOut) {
            priceStr = ' — *sold out*';
          } else if (modifier && modifier.percent !== 0 && finalPrice !== item.price) {
            priceStr = ` — ~~${item.price} gp~~ → **${finalPrice} gp**`;
          } else {
            priceStr = ` — **${item.price} gp**`;
          }

          return `**${item.name}**${stockTag}${priceStr}\n*${item.description}*`;
        });

        embed.addFields({
          name: catName,
          value: lines.join('\n\n'),
          inline: false,
        });
      }

      // Add their roll info at the bottom if they've rolled
      if (roll !== null && modifier) {
        embed.addFields({
          name: 'Your Roll This Week',
          value:
            `${modifier.label}\n` +
            `*Only you can see this message • \`/buy <item>\` to purchase • \`/roll\` for your weekly modifier*`,
          inline: false,
        });
      } else {
        embed.setFooter({
          text: 'Only you can see this message • /buy <item> to purchase • /roll for your weekly modifier',
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in /show:', err);
      await interaction.editReply({
        content: `*Grimbold squints at his ledger and shakes his head.*\n"Can't seem to find my inventory list right now. Try again in a moment."`,
      });
    }
  },
};