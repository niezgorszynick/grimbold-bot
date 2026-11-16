// commands/sellgear.js — /sellgear <character> <item> [quantity]: sells mundane
// gear from a character's equipment list to Grimbold on the spot, for half
// its price moved by the weekly roll (rules in rules/gearSales.js). Magic
// items go to auction with /sell instead.

const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const shop = require('../shop');
const { formatCp } = require('../currency');

function resolveCharacter(playerId, value) {
  const characters = shop.getShoppingCharacters(playerId);
  const needle = String(value || '').trim().toLowerCase();
  return characters.find(character => String(character.id) === String(value)) ||
    characters.find(character => character.name.toLowerCase() === needle) || null;
}

// Rows Grimbold would buy, with his offer.
function sellableRows(player, character) {
  return db.getCharacterInventory({ id: character.id, player_id: player.id, is_admin: false }).items
    .filter(item => item.sale && item.sale.unitCp > 0);
}

// The item option's value: "index|name", so a changed list is noticed.
function parseItem(value) {
  const match = String(value || '').match(/^(\d+)\|(.+)$/);
  return match ? { index: Number(match[1]), name: match[2] } : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sellgear')
    .setDescription('Sell mundane gear to Grimbold for coin (half price, better with a good weekly roll)')
    .addStringOption(option => option.setName('character').setDescription('Who is selling').setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('item').setDescription('The item from their equipment list').setRequired(true).setAutocomplete(true))
    .addIntegerOption(option => option.setName('quantity').setDescription('How many to sell (default: 1)').setRequired(false).setMinValue(1)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value || '').toLowerCase();
    try {
      const player = shop.findPlayerByDiscordId(interaction.user.id);
      if (!player) return interaction.respond([]);
      if (focused.name === 'character') {
        return interaction.respond(shop.getShoppingCharacters(player.id)
          .filter(character => character.name.toLowerCase().includes(query)).slice(0, 25)
          .map(character => ({ name: character.name, value: String(character.id) })));
      }
      const character = resolveCharacter(player.id, interaction.options.getString('character'));
      if (!character) return interaction.respond([]);
      return interaction.respond(sellableRows(player, character)
        .filter(item => (item.nickname || item.name).toLowerCase().includes(query)).slice(0, 25)
        .map(item => ({
          name: `${item.nickname || item.name}${item.quantity > 1 ? ` (have ${item.quantity})` : ''} — ${formatCp(item.sale.unitCp)}${item.quantity > 1 ? ' each' : ''}`.slice(0, 100),
          value: `${item.index}|${item.name}`.slice(0, 100)
        })));
    } catch {
      return interaction.respond([]);
    }
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const player = shop.findPlayerByDiscordId(interaction.user.id);
    if (!player) return interaction.editReply('*Grimbold squints at you.* "I don\'t know you. Ask the DM to add your Discord account to the campaign ledger."');
    const character = resolveCharacter(player.id, interaction.options.getString('character'));
    if (!character) return interaction.editReply('*Grimbold looks around.* "Whose gear is this? Pick one of your living characters from the list."');
    const item = parseItem(interaction.options.getString('item'));
    if (!item) return interaction.editReply('*Grimbold taps the counter.* "Pick the item from the list, so I know which one you mean."');
    try {
      const result = db.changeCharacterInventory({
        id: character.id, player_id: player.id, is_admin: false, action: 'sell',
        params: { index: item.index, name: item.name, quantity: interaction.options.getInteger('quantity') || 1 }
      });
      require('../characterThreads').announceSale(result.sold, { sellerTag: interaction.user.tag });
      const sold = result.sold;
      const each = sold.quantity > 1 ? ` (${formatCp(sold.unitCp)} each)` : '';
      return interaction.editReply(`*Grimbold weighs the ${sold.item} in his hand and counts out the coins.* **${formatCp(sold.totalCp)}**${each} for ${character.name}. Purse now: **${formatCp(sold.purseCp)}**.`);
    } catch (error) {
      return interaction.editReply(`*Grimbold shakes his head.* "${error.message}"`);
    }
  }
};
