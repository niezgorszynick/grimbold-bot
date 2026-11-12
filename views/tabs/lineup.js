// views/tabs/lineup.js — "Lineup" tab: characters side by side by height,
// drawn as outlines from their build, species and class (public/lineup.js).

'use strict';

module.exports = function renderLineupTab() {
  return `
    <section class="card lineup-card">
      <div id="lineup" aria-live="polite">Loading the lineup…</div>
    </section>
    <script src="/admin/assets/lineup.js" defer></script>`;
};
