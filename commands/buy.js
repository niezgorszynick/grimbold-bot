// commands/buy.js — /buy <item> [quantity]
// Purchases an item from the shop, validates stock, applies roll modifier, and writes to ledger.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { getUserRoll, getDiscount, applyModifier } = require('../rollTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Purchase an item from Grimbold')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The item you want to buy (type to search)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option
        .setName('quantity')
        .setDescription('How many to buy (default: 1)')
        .setRequired(false)
        .setMinValue(1)
    ),

  // Autocomplete: search active items by name
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    try {
      const items = db.getAllActiveItems();
      const filtered = items
        .filter(item => {
          const inStock = item.stock === null || item.stock > 0;
          return inStock && item.name.toLowerCase().includes(focused);
        })
        .slice(0, 25);

      await interaction.respond(
        filtered.map(item => ({
          name: `${item.name} — ${item.price} gp${item.stock !== null ? ` (${item.stock} left)` : ''}`,
          value: item.name,
        }))
      );
    } catch {
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    await interaction.deferReply();

    const itemName = interaction.options.getString('item');
    const quantity = interaction.options.getInteger('quantity') || 1;
    const userId   = interaction.user.id;
    const userTag  = interaction.user.tag;

    try {
      // 1. Find item in SQLite
      const item = db.findItemByName(itemName);

      if (!item) {
        return interaction.editReply({
          content:
            `*Grimbold squints at your request...*\n` +
            `"Never heard of '${itemName}'. Check \`/show\` to see what I actually have in stock."`,
        });
      }

      // 2. Check stock
      if (item.stock !== null && item.stock < quantity) {
        return interaction.editReply({
          content:
            `*Grimbold holds up ${item.stock} finger${item.stock === 1 ? '' : 's'}.*\n` +
            `"I've only got ${item.stock} left — not enough for ${quantity}. Take what I have or come back later."`,
        });
      }

      // 3. Price calculation with weekly modifier
      const roll          = getUserRoll(userId);
      const modifier      = roll !== null ? getDiscount(roll) : { percent: 0, label: '' };
      const finalPriceEa  = applyModifier(item.price, modifier);
      const totalPaid     = finalPriceEa * quantity;

      // 4. Atomic transaction in SQLite (deduct stock + insert sales row)
      db.purchaseItemTransaction(item.id, quantity, {
        item_name: item.name,
        category: item.category,
        quantity: quantity,
        buyer_tag: userTag,
        buyer_id: userId,
        base_price: item.price,
        discount_percent: modifier.percent,
        final_price: finalPriceEa,
        total_paid: totalPaid,
      });

      // 5. Build Receipt Embed
      const discountNote =
        modifier.percent === 0
          ? ''
          : modifier.percent < 0
            ? ` (${Math.abs(modifier.percent)}% weekly discount applied)`
            : ` (+${modifier.percent}% surcharge applied — rolled a 1)`;

      const qtyStr = quantity > 1 ? ` × ${quantity}` : '';
      const unitStr = quantity > 1 ? ` (${finalPriceEa} gp each)` : '';

      const embed = new EmbedBuilder()
        .setTitle('Grimbold slides your purchase across the counter.')
        .setColor(0x8B4513)
        .setDescription(
          `*"Pleasure doing business with you, ${interaction.user}."*\n\n` +
          `**Item:** ${item.name}${qtyStr}\n` +
          `**Total:** **${totalPaid} gp**${unitStr}${discountNote}\n\n` +
          `*${item.description}*`
        )
        .setFooter({ text: "Grimbold's Emporium • All sales final • No refunds" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error in /buy:', err);

      if (err.message && err.message.startsWith('INSUFFICIENT_STOCK')) {
        const available = err.message.split(':')[1];
        return interaction.editReply({
          content:
            `*Grimbold holds up ${available} finger${available === '1' ? '' : 's'}.*\n` +
            `"I've only got ${available} left — not enough for ${quantity}. Take what I have or come back later."`,
        });
      }

      await interaction.editReply({
        content:
          `*Grimbold pulls the item back across the counter.*\n` +
          `"Something went wrong with the ledger. Keep your gold for now."`,
      });
    }
  },
};