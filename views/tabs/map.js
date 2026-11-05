// views/tabs/map.js — "Map" tab: the world map with its hex grid, filled in by
// public/world-map.js. Players see it through their fog of war (the hexes
// their characters visited); DMs see all of it and place markers.

'use strict';

module.exports = function renderMapTab() {
  return `
    <section class="card world-map-card">
      <div id="world-map" aria-live="polite">Loading the map…</div>
    </section>
    <script src="/admin/assets/world-map.js" defer></script>`;
};
