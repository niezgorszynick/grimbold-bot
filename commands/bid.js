// commands/bid.js — /bid <auction> <character> [amount]: bids on an item at
// Grimbold's auction. The bid comes out of the character's purse and comes
// back if someone outbids it (db/auctions.js). Without an amount: the minimum.

const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const shop = require('../shop');
const { formatCp } = require('../currency');
const { postAuctionNews } = require('../auctionNews');

function resolveCharacter(playerId, value) {
  const characters = shop.getShoppingCharacters(playerId);
  const needle = String(value || '').trim().toLowerCase();
  return characters.find(character => String(character.id) === String(value)) ||
    characters.find(character => character.name.toLowerCase() === needle) || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bid')
    .setDescription("Bid on an item at Grimbold's auction")
    .addStringOption(option => option.setName('auction').setDescription('The item up for auction').setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('character').setDescription('Who bids (pays from their purse)').setRequired(true).setAutocomplete(true))
    .addNumberOption(option => option.setName('amount').setDescription('Your bid in gold pieces (default: the minimum)').setRequired(false).setMinValue(1)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value || '').toLowerCase();
    try {
      if (focused.name === 'auction') {
        return interaction.respond(db.listAuctions().open
          .filter(auction => auction.item.toLowerCase().includes(query)).slice(0, 25)
          .map(auction => ({ name: `#${auction.id} ${auction.item} — next bid ${formatCp(auction.nextBidCp)}`.slice(0, 100), value: String(auction.id) })));
      }
      const player = shop.findPlayerByDiscordId(interaction.user.id);
      if (!player) return interaction.respond([]);
      return interaction.respond(shop.getShoppingCharacters(player.id)
        .filter(character => character.name.toLowerCase().includes(query)).slice(0, 25)
        .map(character => ({ name: `${character.name} (${formatCp(character.gold_cp)})`, value: String(character.id) })));
    } catch {
      return interaction.respond([]);
    }
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const player = shop.findPlayerByDiscordId(interaction.user.id);
    if (!player) return interaction.editReply('*Grimbold squints at you.* "I don\'t know you. Ask the DM to add your Discord account to the campaign ledger."');
    const character = resolveCharacter(player.id, interaction.options.getString('character'));
    if (!character) return interaction.editReply('*Grimbold looks around.* "Who\'s bidding? Pick one of your living characters from the list."');
    const auctionId = String(interaction.options.getString('auction')).replace(/^#/, '');
    try {
      const before = db.getAuction(auctionId);
      if (!before) throw new Error('No such auction.');
      const amount = interaction.options.getNumber('amount');
      const amountCp = amount ? Math.round(amount * 100) : before.nextBidCp;
      const auction = db.placeBid({ user: { id: player.id, role: 'player' }, auctionId: before.id, characterId: character.id, amountCp });
      postAuctionNews([{ kind: 'bid', auctionId: auction.id, item: auction.item, bidder: auction.highestBidder, amountCp: auction.currentBidCp }]);
      return interaction.editReply(`*Grimbold notes it in his ledger.* ${character.name} bids **${formatCp(auction.currentBidCp)}** on **${auction.item}**. The gold is held until the auction ends, or comes back if someone outbids you.`);
    } catch (error) {
      return interaction.editReply(`*Grimbold shakes his head.* "${error.message}"`);
    }
  }
};
