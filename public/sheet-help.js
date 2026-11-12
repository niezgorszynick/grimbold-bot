// public/sheet-help.js — Explanations on the character sheet stay out of the
// way: a line marked .sheet-help is hidden, and an ⓘ next to its heading (or
// the feature it describes) shows it. Works on parts that redraw themselves
// (hit points, spells, attacks): new help lines are picked up as they appear,
// and an opened one stays open through the redraw.

(function () {
  const sheet = document.getElementById('fullCharacterSheetContainer');
  if (!sheet) return;
  const open = new Set(); // the headings' texts whose help is shown

  // Where the ⓘ goes: the heading just before the help line, a feature's name
  // in the row before it, or the first heading of the block it sits in.
  function anchorOf(help) {
    const before = help.previousElementSibling;
    if (before && /^H[3-6]$/.test(before.tagName)) return before;
    if (before) {
      const label = before.querySelector('.vitals-slot-label, h5, h4, strong');
      if (label) return label;
    }
    const block = help.parentElement;
    return block && block.querySelector(':scope > h4, :scope > h5, :scope > h3') || null;
  }
  const keyOf = anchor => (anchor.textContent || '').replace('ⓘ', '').trim();

  function process() {
    sheet.querySelectorAll('.sheet-help:not([data-help])').forEach(help => {
      const anchor = anchorOf(help);
      if (!anchor) { help.dataset.help = 'shown'; return; }
      help.dataset.help = 'hidden';
      const key = keyOf(anchor);
      help.dataset.helpKey = key;
      let button = anchor.querySelector(':scope > .help-toggle');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'help-toggle';
        button.textContent = 'ⓘ';
        button.title = 'What is this?';
        button.setAttribute('aria-label', 'Explain ' + key);
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          if (open.has(key)) open.delete(key); else open.add(key);
          apply();
        });
        anchor.append(' ', button);
      }
    });
    apply();
  }

  function apply() {
    sheet.querySelectorAll('.sheet-help[data-help-key]').forEach(help => {
      help.hidden = !open.has(help.dataset.helpKey);
    });
    sheet.querySelectorAll('.help-toggle').forEach(button => {
      const key = keyOf(button.parentElement);
      button.classList.toggle('is-open', open.has(key));
      button.setAttribute('aria-expanded', String(open.has(key)));
    });
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; process(); });
  }).observe(sheet, { childList: true, subtree: true });
  process();
})();
