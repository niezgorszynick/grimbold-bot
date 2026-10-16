// auctionNews.js — Auction news on Discord: new listings, bids and results,
// posted to AUCTIONS_CHANNEL_ID (or the restock ANNOUNCEMENT_CHANNEL_ID). Also
// settles due auctions (NPC bids, endings) every 15 minutes while the bot runs.
//
// Without a channel or the bot nothing is posted; auctions still work.

'use strict';

const db = require('./db');
const { formatCp } = require('./currency');

let client = null;

function channelId() {
  return process.env.AUCTIONS_CHANNEL_ID || process.env.ANNOUNCEMENT_CHANNEL_ID || '';
}

// One news item (from db/auctions.js or a route) as a line of text.
function newsMessage(item) {
  switch (item.kind) {
    case 'listed':
      return `🔨 **Auction #${item.auctionId}:** ${item.seller} puts up **${item.item}** (${item.rarity}). Opening bid **${formatCp(item.openingBidCp)}**, closes <t:${Math.floor(Date.parse(item.endsAt) / 1000)}:R>. Bid with \`/bid\`.`;
    case 'bid':
      return `💰 **${item.bidder}** bids **${formatCp(item.amountCp)}** on **${item.item}** (auction #${item.auctionId}).`;
    case 'npcBid':
      return `💰 *${item.npc}* bids **${formatCp(item.amountCp)}** on **${item.item}** (auction #${item.auctionId}).`;
    case 'closed':
      return item.status === 'sold'
        ? `🏁 **${item.item}** (auction #${item.auctionId}) goes to **${item.winner}** for **${formatCp(item.priceCp)}**. ${item.seller} receives ${formatCp(item.sellerGetsCp)}.`
        : `🏁 Nobody bid on **${item.item}** (auction #${item.auctionId}). Grimbold buys it from ${item.seller} for ${formatCp(item.sellerGetsCp)} and puts it on his shelf.`;
    default:
      return null;
  }
}

// Never throws.
async function postAuctionNews(items) {
  const lines = (items || []).map(newsMessage).filter(Boolean);
  if (!lines.length || !channelId() || !client || (typeof client.isReady === 'function' && !client.isReady())) return;
  try {
    const channel = await client.channels.fetch(channelId());
    if (!channel || typeof channel.send !== 'function') return;
    for (let i = 0; i < lines.length; i += 10) {
      await channel.send({ content: lines.slice(i, i + 10).join('\n'), allowedMentions: { parse: [] } });
    }
  } catch (error) {
    console.warn(`Could not post auction news: ${error.message}`);
  }
}

function settleAndPost() {
  try {
    return postAuctionNews(db.settleAuctions());
  } catch (error) {
    console.warn(`Auction settling failed: ${error.message}`);
    return Promise.resolve();
  }
}

function setAuctionNewsClient(discordClient) {
  client = discordClient;
  setInterval(settleAndPost, 15 * 60 * 1000).unref();
  settleAndPost();
}

module.exports = { setAuctionNewsClient, postAuctionNews, newsMessage };
