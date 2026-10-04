// commands/show.js — displays active shop items grouped by category without descriptions
const { formatCp } = require('../currency');
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

      // Header description
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

      // Group items by category
      const categories = {};
      for (const item of items) {
        const cat = item.category || 'General';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(item);
      }

      // Add fields without descriptions to ensure compact, error-free embeds
      for (const [catName, catItems] of Object.entries(categories)) {
        let currentChunk = [];
        let currentLength = 0;
        let part = 1;

        for (const item of catItems) {
          const finalPrice = modifier ? applyModifier(item.price, modifier) : item.price;
          const isSoldOut = item.stock !== null && item.stock <= 0;

          let stockTag = '';
          if (isSoldOut) stockTag = ' **(Sold Out)**';
          else if (item.stock !== null) stockTag = ` (${item.stock} left)`;
          
          let priceStr = '';
          if (isSoldOut) {
            priceStr = ' — *sold out*';
          } else if (modifier && modifier.percent !== 0 && finalPrice !== item.price) {
            priceStr = ` — ~~${formatCp(item.price)}~~ → **${formatCp(finalPrice)}**`;
          } else {
            priceStr = ` — **${formatCp(item.price)}**`;
}

          const entry = `• **${item.name}**${stockTag}${priceStr}`;

          if (currentLength + entry.length + 1 > 900 && currentChunk.length > 0) {
            embed.addFields({
              name: part === 1 ? catName : `${catName} (cont.)`,
              value: currentChunk.join('\n'),
              inline: false,
            });
            currentChunk = [entry];
            currentLength = entry.length;
            part++;
          } else {
            currentChunk.push(entry);
            currentLength += entry.length + 1;
          }
        }

        if (currentChunk.length > 0) {
          embed.addFields({
            name: part === 1 ? catName : `${catName} (cont.)`,
            value: currentChunk.join('\n'),
            inline: false,
          });
        }
      }

      // Roll info footer / field
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