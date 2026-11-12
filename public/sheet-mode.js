// public/sheet-mode.js — The character sheet's two modes. View (the default)
// is for play: rolling, HP, rests, spell slots, casting and items all work,
// while the build (identity, ability scores, skill choices, appearance, notes,
// portrait, reset and delete) is shown but not edited. Edit shows everything.
// The choice is remembered in this browser. Styles: body.sheet-view in admin.css.

(function () {
  const sheet = document.getElementById('fullCharacterSheetContainer');
  const toggle = document.getElementById('cs_mode');
  if (!sheet || !toggle) return;
  const KEY = 'grimbold.sheetMode';
  let mode = 'view';
  try { mode = localStorage.getItem(KEY) === 'edit' ? 'edit' : 'view'; } catch { /* private window */ }

  // Empty notes boxes have nothing to show in View.
  function markEmptyNotes() {
    document.querySelectorAll('.sheet-notes-label').forEach(label => {
      const box = label.querySelector('textarea');
      label.classList.toggle('is-empty', Boolean(box) && !box.value.trim());
    });
  }

  function apply() {
    const view = mode === 'view';
    document.body.classList.toggle('sheet-view', view);
    toggle.textContent = view ? '✏️ Edit' : '👁 View';
    toggle.classList.toggle('is-editing', !view);
    toggle.setAttribute('aria-pressed', String(!view));
    // Appearance stays folded to its one-line summary in View.
    const appearance = document.querySelector('.sheet-appearance');
    if (view && appearance) appearance.open = false;
    markEmptyNotes();
    // A notes box hidden while empty measured nothing: size it now it shows.
    if (window.autosizeSheetNotes) window.autosizeSheetNotes();
  }

  toggle.addEventListener('click', () => {
    mode = mode === 'view' ? 'edit' : 'view';
    try { localStorage.setItem(KEY, mode); } catch { /* private window */ }
    apply();
  });
  document.addEventListener('input', event => { if (event.target.closest && event.target.closest('.sheet-notes-label')) markEmptyNotes(); });
  window.refreshSheetMode = apply;
  apply();
})();
