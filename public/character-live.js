// public/character-live.js — Live updates for the character sheet: when the
// character changes elsewhere (the DM deals damage from the adventure table,
// a roll, a purchase), the sheet's HP, spells, items, purse and attacks
// refresh at once. The main form (name, ability scores, notes) isn't
// reloaded, so nothing typed there is lost.
//
// While the player is in the middle of something in those sections (typing,
// the spell picker or HP editor open), the refresh waits until they're done.

(function () {
  const container = document.getElementById('fullCharacterSheetContainer');
  if (!container || !window.EventSource) return;
  const characterId = Number(container.dataset.rollCharacter);
  if (!characterId) return;

  const LIVE_SECTIONS = ['cs_vitals', 'cs_spells', 'cs_magic_items', 'cs_inventory', 'cs_purse'];
  // .spell-picker: spell, invocation and magic item pickers.
  const OPEN_EDITORS = '.spell-picker, .vitals-hp-editor';

  function busy() {
    const active = document.activeElement;
    const typing = active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) &&
      LIVE_SECTIONS.some(id => { const section = document.getElementById(id); return section && section.contains(active); });
    return typing || Boolean(document.querySelector(OPEN_EDITORS));
  }

  function refreshAll() {
    if (window.refreshCharacterVitals) window.refreshCharacterVitals();
    if (window.reloadCharacterSpells) window.reloadCharacterSpells();
    if (window.refreshCharacterMagicItems) window.refreshCharacterMagicItems();
    if (window.refreshCharacterInventory) window.refreshCharacterInventory();
    if (window.refreshCharacterPurse) window.refreshCharacterPurse();
    if (window.refreshCharacterCombat) window.refreshCharacterCombat();
  }

  let timer = null;
  let waiting = false;
  function refreshSoon() {
    clearTimeout(timer);
    // Several changes at once (a long rest) make one refresh.
    timer = setTimeout(() => {
      if (busy()) {
        waiting = true;
        return;
      }
      waiting = false;
      refreshAll();
    }, 300);
  }
  // A refresh held back while the player was busy goes out once they're done.
  setInterval(() => { if (waiting && !busy()) { waiting = false; refreshAll(); } }, 1000);

  const source = new EventSource('/api/characters/' + characterId + '/live');
  source.onmessage = refreshSoon;
})();
