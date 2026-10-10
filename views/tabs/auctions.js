// views/tabs/auctions.js — "auctions" tab of the admin panel.

'use strict';

module.exports = function renderAuctionsTab(ctx) {
  let contentHtml = '';
  contentHtml = `
    <section class="card">
      <h3>Auctions</h3>
      <p>Players will be able to submit magic items for auction, then bid against and outbid one another. If an item receives no bids, it will be sold for at least 50% of its vendor value.</p>
      <span class="analytics-badge">Coming soon · Next on the roadmap</span>
    </section>
  `;
  return contentHtml;
};
