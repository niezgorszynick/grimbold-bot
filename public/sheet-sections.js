// public/sheet-sections.js — On narrow screens (phones, tablets in portrait, up to 900px),
// each character sheet section can be folded by tapping its title. Sections
// used at the table (HP, attacks, spells, saves, skills) start open; the rest
// (details, ability scores, features, equipment, magic items) start folded. Each player's
// choices are remembered in this browser. Wider screens always show everything.

(function () {
  const container = document.getElementById('fullCharacterSheetContainer');
  if (!container) return;

  const NARROW = window.matchMedia('(max-width: 900px)');
  const STORAGE_KEY = 'grimbold-sheet-sections';
  const FOLDED_BY_DEFAULT = ['details', 'abilities', 'proficiencies', 'features', 'equipment', 'magicItems'];
  // The title that folds each section ([data-collapse] holds the section's name).
  const TITLE = '.sheet-identity > h2, .point-buy-header h3, :scope > h4:first-child';

  function readSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }
  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
  }
  const saved = readSaved();

  function isFolded(name) {
    return Object.hasOwn(saved, name) ? saved[name] : FOLDED_BY_DEFAULT.includes(name);
  }

  function titleOf(section) {
    return section.querySelector(TITLE);
  }

  // Marks titles as buttons (spells and magic items redraw theirs, so this runs again).
  function decorate() {
    container.querySelectorAll('[data-collapse]').forEach(section => {
      const folded = NARROW.matches && isFolded(section.dataset.collapse);
      section.classList.toggle('is-folded', folded);
      const title = titleOf(section);
      if (!title) return;
      if (NARROW.matches) {
        title.setAttribute('role', 'button');
        title.setAttribute('tabindex', '0');
        title.setAttribute('aria-expanded', String(!folded));
        title.classList.add('sheet-fold-title');
      } else {
        title.removeAttribute('role');
        title.removeAttribute('tabindex');
        title.removeAttribute('aria-expanded');
        title.classList.remove('sheet-fold-title');
      }
    });
  }

  function toggle(section) {
    const name = section.dataset.collapse;
    saved[name] = !isFolded(name);
    save(saved);
    decorate();
  }

  container.addEventListener('click', event => {
    if (!NARROW.matches) return;
    const section = event.target.closest('[data-collapse]');
    if (!section || !container.contains(section)) return;
    const title = titleOf(section);
    if (title && (event.target === title || title.contains(event.target)) && !event.target.closest('button, a, input, select')) {
      toggle(section);
    }
  });
  container.addEventListener('keydown', event => {
    if (!NARROW.matches || (event.key !== 'Enter' && event.key !== ' ')) return;
    const section = event.target.closest('[data-collapse]');
    if (section && event.target === titleOf(section)) {
      event.preventDefault();
      toggle(section);
    }
  });

  // Spells and magic items redraw their contents (and titles) often.
  new MutationObserver(() => decorate()).observe(container, { childList: true, subtree: false });
  ['cs_spells', 'cs_magic_items'].forEach(id => {
    const section = document.getElementById(id);
    if (section) new MutationObserver(() => decorate()).observe(section, { childList: true });
  });
  if (NARROW.addEventListener) NARROW.addEventListener('change', decorate);
  decorate();
})();
