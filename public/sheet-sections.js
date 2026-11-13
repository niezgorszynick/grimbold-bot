// public/sheet-sections.js — The character sheet on phones and narrow tablets
// (up to 900px): a bar that stays at the top with what is needed mid-fight
// (portrait, name, AC, Initiative, Hit Points, Heroic Inspiration, rests,
// Edit/Save), and one section of the sheet at a time, picked from a menu or
// stepped through with ‹ ›. The section last open is remembered in this
// browser. Wider screens show the whole sheet as before.
// Styles: admin.css "Character sheet on phones".

(function () {
  const container = document.getElementById('fullCharacterSheetContainer');
  if (!container) return;

  const NARROW = window.matchMedia('(max-width: 900px)');
  const STORAGE_KEY = 'grimbold-sheet-section';
  // Each menu entry: the sections it shows ([data-collapse] names) and other
  // parts of the sheet that belong with them.
  const GROUPS = [
    { key: 'abilities', label: 'Abilities, Saves & Senses', icon: '💪', sections: ['abilities', 'saves', 'senses'], extra: ['.sheet-combat-stats', '#cs_ac_details', '#cs_inspiration_text'] },
    { key: 'skills', label: 'Skills', icon: '🎯', sections: ['skills'] },
    { key: 'vitals', label: 'Hit Points, Rests & Resources', icon: '❤️', sections: ['vitals', 'resources', 'wildShape'] },
    { key: 'attacks', label: 'Actions & Attacks', icon: '⚔️', sections: ['attacks'] },
    { key: 'spells', label: 'Spells', icon: '✨', sections: ['spells'] },
    { key: 'inventory', label: 'Inventory & Magic Items', icon: '🎒', sections: ['equipment', 'magicItems'] },
    { key: 'features', label: 'Features & Traits', icon: '📜', sections: ['features'] },
    { key: 'proficiencies', label: 'Proficiencies & Languages', icon: '🛠️', sections: ['proficiencies'] },
    { key: 'details', label: 'Details, Appearance & Levels', icon: '🪪', sections: ['details'], extra: ['.sheet-appearance', '.level-breakdown'] }
  ];

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    });
    return node;
  }

  // Setting hidden, even to the same value, wakes the observer below: only on change.
  const setHidden = (node, value) => { if (node.hidden !== value) node.hidden = value; };

  let current = 'abilities';
  try { current = localStorage.getItem(STORAGE_KEY) || current; } catch { /* private window */ }

  // The parts of the sheet each group shows.
  function partsOf(group) {
    return [
      ...group.sections.map(name => container.querySelector(`[data-collapse="${name}"]`)),
      ...(group.extra || []).map(selector => document.querySelector(selector))
    ].filter(Boolean);
  }
  // Spells, Wild Shape and Senses stay hidden for characters without them.
  const available = group => partsOf(group).some(part => !part.hidden);

  // ─── The bar at the top ────────────────────────────────────────────────────
  const portrait = el('button', { type: 'button', className: 'sheet-hud-portrait', 'aria-label': 'Details and portrait', onclick: () => show('details') });
  const name = el('strong', { className: 'sheet-hud-name' });
  const sub = el('span', { className: 'sheet-hud-sub' });
  const modeButton = el('button', { type: 'button', className: 'btn btn-small btn-secondary sheet-hud-mode', onclick: () => document.getElementById('cs_mode').click() });
  const saveButton = el('button', { type: 'button', className: 'btn btn-small btn-success sheet-hud-save', text: 'Save', onclick: () => document.getElementById('cs_save').click() });

  const acValue = el('strong');
  const initiativeValue = el('strong');
  const hpValue = el('strong');
  const hpTemp = el('span', { className: 'sheet-hud-temp' });
  const hpBar = el('span', { className: 'sheet-hud-hp-bar' }, [el('span')]);
  const inspiration = el('button', {
    type: 'button', className: 'sheet-hud-tile sheet-hud-inspiration', title: 'Heroic Inspiration: tap to use or gain it',
    onclick: () => { const box = document.getElementById('cs_inspiration'); if (box && !box.disabled) box.click(); refresh(); }
  }, [el('span', { className: 'sheet-hud-icon', text: '☀' }), el('small', { text: 'Inspired' })]);

  const hud = el('div', { className: 'sheet-hud' }, [
    el('div', { className: 'sheet-hud-identity' }, [
      portrait,
      el('div', { className: 'sheet-hud-names' }, [name, sub]),
      saveButton,
      modeButton
    ]),
    el('div', { className: 'sheet-hud-stats' }, [
      el('div', { className: 'sheet-hud-tile' }, [el('small', { text: 'AC' }), acValue]),
      // Rolls initiative through public/dice.js.
      el('button', { type: 'button', className: 'sheet-hud-tile sheet-hud-roll', 'data-roll': 'initiative', title: 'Roll initiative (Shift: Advantage)' }, [el('small', { text: 'Initiative' }), initiativeValue]),
      el('button', { type: 'button', className: 'sheet-hud-tile sheet-hud-hp', title: 'Hit Points: damage, healing and rests', onclick: () => show('vitals') }, [
        el('small', { text: 'Hit Points' }), el('span', { className: 'sheet-hud-hp-numbers' }, [hpValue, hpTemp]), hpBar
      ]),
      inspiration,
      el('button', {
        type: 'button', className: 'sheet-hud-tile', title: 'Short and Long Rest, Hit Point Dice',
        onclick: () => { show('vitals'); const rests = container.querySelector('.vitals-rests'); if (rests) rests.scrollIntoView({ block: 'center' }); }
      }, [el('span', { className: 'sheet-hud-icon', text: '⛺' }), el('small', { text: 'Rest' })])
    ])
  ]);

  // ─── The section bar and its menu ─────────────────────────────────────────
  const sectionLabel = el('span', { className: 'sheet-nav-label' });
  const step = direction => () => {
    const list = GROUPS.filter(available);
    const at = list.findIndex(group => group.key === current);
    show(list[(at + direction + list.length) % list.length].key);
  };
  const nav = el('div', { className: 'sheet-nav' }, [
    el('button', { type: 'button', className: 'sheet-nav-step', 'aria-label': 'Previous section', text: '‹', onclick: step(-1) }),
    el('button', { type: 'button', className: 'sheet-nav-current', 'aria-haspopup': 'dialog', onclick: () => openMenu() }, [sectionLabel, el('span', { className: 'sheet-nav-menu', 'aria-hidden': 'true', text: '☰' })]),
    el('button', { type: 'button', className: 'sheet-nav-step', 'aria-label': 'Next section', text: '›', onclick: step(1) })
  ]);
  const top = el('div', { className: 'sheet-phone-top' }, [hud, nav]);

  const menu = el('div', { className: 'sheet-menu', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sheet sections', hidden: true });
  // The bar's own hidden changes are not the sheet's.
  const ownNodes = node => top.contains(node);
  menu.addEventListener('click', event => { if (event.target === menu) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) closeMenu(); });
  function openMenu() {
    menu.replaceChildren(el('div', { className: 'sheet-menu-panel' }, [
      el('div', { className: 'sheet-menu-head' }, [
        el('strong', { text: 'Sections' }),
        el('button', { type: 'button', className: 'sheet-menu-close', 'aria-label': 'Close', text: '×', onclick: closeMenu })
      ]),
      ...GROUPS.filter(available).map(group => el('button', {
        type: 'button', className: 'sheet-menu-item' + (group.key === current ? ' is-current' : ''),
        'aria-current': group.key === current ? 'true' : null,
        onclick: () => { closeMenu(); show(group.key); }
      }, [el('span', { className: 'sheet-menu-icon', 'aria-hidden': 'true', text: group.icon }), group.label]))
    ]));
    menu.hidden = false;
    const chosen = menu.querySelector('.is-current') || menu.querySelector('.sheet-menu-item');
    if (chosen) chosen.focus();
  }
  function closeMenu() {
    menu.hidden = true;
    nav.querySelector('.sheet-nav-current').focus();
  }

  // ─── Showing one section ──────────────────────────────────────────────────
  function show(key) {
    current = key;
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* not remembered */ }
    apply();
    // The section starts right under the bar.
    const y = container.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > y) window.scrollTo({ top: y });
  }

  function apply() {
    const phone = NARROW.matches;
    container.classList.toggle('sheet-phone', phone);
    setHidden(top, !phone);
    if (!phone) {
      GROUPS.forEach(group => partsOf(group).forEach(part => part.classList.remove('sheet-group-off')));
      return;
    }
    if (!GROUPS.some(group => group.key === current && available(group))) current = (GROUPS.find(available) || GROUPS[0]).key;
    const group = GROUPS.find(entry => entry.key === current);
    GROUPS.forEach(entry => partsOf(entry).forEach(part => part.classList.toggle('sheet-group-off', entry !== group)));
    sectionLabel.textContent = group.icon + ' ' + group.label;
    refresh();
  }

  // ─── Keeping the bar's numbers current ────────────────────────────────────
  let hp = null;
  document.addEventListener('grimbold-vitals', event => { hp = event.detail; refresh(); });
  function refresh() {
    if (!NARROW.matches) return;
    name.textContent = (document.getElementById('cs_header_name') || {}).textContent || '';
    sub.textContent = (document.getElementById('cs_header_sub') || {}).textContent || '';
    const image = container.querySelector('.sheet-portrait-image img');
    const initials = container.querySelector('.sheet-portrait-image span');
    if (image && (!portrait.firstChild || portrait.firstChild.src !== image.src)) portrait.replaceChildren(el('img', { src: image.src, alt: '' }));
    else if (!image && initials && portrait.textContent !== initials.textContent) portrait.replaceChildren(initials.textContent);
    acValue.textContent = (document.getElementById('cs_ac') || {}).value || '—';
    initiativeValue.textContent = (document.getElementById('cs_initiative') || {}).value || '—';
    if (hp) {
      hpValue.textContent = hp.hpCurrent + '/' + hp.hpMax;
      hpTemp.textContent = hp.hpTemp ? ' +' + hp.hpTemp : '';
      hpTemp.title = hp.hpTemp ? hp.hpTemp + ' Temporary Hit Points' : '';
      const share = hp.hpMax ? Math.max(0, Math.min(1, hp.hpCurrent / hp.hpMax)) : 0;
      hpBar.firstChild.style.width = Math.round(share * 100) + '%';
      hpBar.dataset.state = hp.hpCurrent === 0 ? 'down' : share <= 0.5 ? 'bloodied' : 'ok';
    }
    const box = document.getElementById('cs_inspiration');
    inspiration.classList.toggle('is-on', Boolean(box && box.checked));
    inspiration.setAttribute('aria-pressed', String(Boolean(box && box.checked)));
    const mode = document.getElementById('cs_mode');
    if (mode) modeButton.textContent = mode.textContent;
    const save = document.getElementById('cs_save');
    setHidden(saveButton, document.body.classList.contains('sheet-view') || !save);
    if (save) saveButton.disabled = save.disabled;
  }

  container.prepend(top);
  document.body.append(menu);
  // The sheet's own scripts fill in values and redraw sections as they load.
  container.addEventListener('input', refresh);
  container.addEventListener('change', refresh);
  document.addEventListener('grimbold-roll', refresh);
  new MutationObserver(records => { if (records.some(record => !ownNodes(record.target))) apply(); })
    .observe(container, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  setInterval(refresh, 1500);
  if (NARROW.addEventListener) NARROW.addEventListener('change', apply);
  apply();
})();
