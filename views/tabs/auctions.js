// views/tabs/auctions.js — "Auctions" tab: magic items players sell to each
// other (and to NPC adventurers), drawn by public/auctions.js from /api/auctions.

'use strict';

module.exports = function renderAuctionsTab() {
  return `
    <section class="card">
      <h3>Grimbold's Auction</h3>
      <p class="muted small">Put a magic item from one of your characters up for auction for 7 days. The opening bid is half its value. Bids come out of your character's purse right away and come back if someone outbids you. Adventurers from out of town sometimes bid too. The winner gets the item on their sheet; the seller gets the winning bid less Grimbold's 10%. If nobody bids, Grimbold buys the item for the opening bid. Also on Discord: <code>/sell</code> and <code>/bid</code>.</p>
    </section>
    <div id="auctions" aria-live="polite"><p class="muted">Loading auctions…</p></div>
    <script src="/admin/assets/auctions.js" defer></script>`;
};
