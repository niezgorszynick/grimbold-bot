// public/character-live.js — Live updates for the character sheet: when the
// character changes elsewhere (the DM deals damage from the adventure table,
// a roll, a purchase), the sheet's HP, spells, items, purse and attacks
// refresh at once. The main form (name, ability scores, notes) isn't
// reloaded, so nothing typed there is lost.
//
// Each section waits only while the player is in the middle of something in
// it (typing there, or its picker/editor open), so an open spell picker never
// holds back the HP.

(function () {
  const container = document.getElementById('fullCharacterSheetContainer');
  if (!container || !window.EventSource) return;
  const characterId = Number(container.dataset.rollCharacter);
  if (!characterId) return;

  // Section root id → its refresh function and the editors that mean "busy".
  // (The DM's always-visible "give a magic item" form is not an open editor.)
  const SECTIONS = [
    { id: 'cs_vitals', refresh: () => window.refreshCharacterVitals, editors: '.vitals-hp-editor' },
    { id: 'cs_spells', refresh: () => window.reloadCharacterSpells, editors: '.spell-picker' },
    { id: 'cs_magic_items', refresh: () => window.refreshCharacterMagicItems, editors: '.spell-picker:not(.magic-item-grant)' },
    { id: 'cs_inventory', refresh: () => window.refreshCharacterInventory, editors: null },
    { id: 'cs_purse', refresh: () => window.refreshCharacterPurse, editors: null },
    { id: 'cs_attacks_auto', refresh: () => window.refreshCharacterCombat, editors: null },
    { id: 'cs_proficiencies', refresh: () => window.refreshCharacterProficiencies, editors: '.prof-editor' }
  ];

  function busy(section) {
    const root = document.getElementById(section.id);
    if (!root) return false;
    const active = document.activeElement;
    const typing = active && root.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
    return typing || Boolean(section.editors && root.querySelector(section.editors));
  }

  // Sections with a change they haven't shown yet.
  const waiting = new Set();
  function flush() {
    for (const section of SECTIONS) {
      if (!waiting.has(section) || busy(section)) continue;
      waiting.delete(section);
      const refresh = section.refresh();
      if (refresh) refresh();
    }
  }

  let timer = null;
  function refreshSoon() {
    SECTIONS.forEach(section => waiting.add(section));
    clearTimeout(timer);
    // Several changes at once (a long rest) make one refresh.
    timer = setTimeout(flush, 300);
  }
  // Sections held back while the player was busy catch up once they're done.
  setInterval(() => { if (waiting.size) flush(); }, 1000);

  const source = new EventSource('/api/characters/' + characterId + '/live');
  source.onmessage = refreshSoon;
})();
