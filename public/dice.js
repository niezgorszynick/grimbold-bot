// public/dice.js — Click to roll. Anything marked data-roll="skill:Stealth"
// (inside an element with data-roll-character="<id>") rolls on the server;
// the result shows in the dice bar, goes into the roll log, and reaches
// Owlbear Rodeo through the "Grimbold's Dice" extension.
// Shift-click: advantage. Ctrl/Cmd-click: disadvantage.

(function () {
  const characters = () => [...document.querySelectorAll('[data-roll-character]')];
  // The adventure table (data-roll-page) draws its cards after loading.
  if (!document.querySelector('[data-roll-character], [data-roll-page]')) return;
  const singleCharacter = !document.querySelector('[data-roll-page]');

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
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  let mode = 'normal';
  let critical = false;
  let privateRoll = false;
  let busy = false;

  // ─── The dice bar ──────────────────────────────────────────────────────────
  const result = el('div', { className: 'dice-result', 'aria-live': 'polite' }, [el('span', { className: 'muted small', text: 'Click a bonus, attack or damage to roll.' })]);
  const modeButtons = ['disadvantage', 'normal', 'advantage'].map(value => el('button', {
    type: 'button', className: 'dice-toggle', 'data-mode': value,
    text: { disadvantage: 'Dis', normal: 'Normal', advantage: 'Adv' }[value],
    title: { disadvantage: 'Disadvantage (or Ctrl-click)', normal: 'Normal roll', advantage: 'Advantage (or Shift-click)' }[value],
    onclick: () => { mode = value; sync(); }
  }));
  const critButton = el('button', { type: 'button', className: 'dice-toggle', text: 'Crit', title: 'Next damage roll is a critical hit (double dice)', onclick: () => { critical = !critical; sync(); } });
  const privateButton = el('button', { type: 'button', className: 'dice-toggle', text: '🔒 GM', title: 'Only the GM sees these rolls in Owlbear Rodeo', onclick: () => { privateRoll = !privateRoll; sync(); } });
  const formula = el('input', { type: 'text', placeholder: '2d6+3', maxlength: '60', 'aria-label': 'Dice formula', className: 'dice-formula' });
  const customForm = el('form', { className: 'dice-custom' }, [formula, el('button', { type: 'submit', className: 'btn btn-small', text: 'Roll' })]);
  customForm.addEventListener('submit', event => {
    event.preventDefault();
    const target = characters()[0];
    if (formula.value.trim() && target) roll(target.dataset.rollCharacter, { formula: formula.value.trim(), label: formula.value.trim() });
  });
  const keyButton = el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Owlbear key', onclick: showKey });
  const collapse = el('button', { type: 'button', className: 'dice-collapse', text: '–', title: 'Hide the dice bar', onclick: () => { bar.classList.toggle('is-collapsed'); collapse.textContent = bar.classList.contains('is-collapsed') ? '🎲' : '–'; } });
  const bar = el('aside', { className: 'dice-bar', 'aria-label': 'Dice' }, [
    el('div', { className: 'dice-bar-row' }, [el('strong', { text: '🎲 Dice' }), el('span', { className: 'dice-toggles' }, [...modeButtons, critButton, privateButton]), collapse]),
    result,
    el('div', { className: 'dice-bar-row' }, [singleCharacter ? customForm : null, keyButton])
  ]);
  document.body.append(bar);

  function sync() {
    modeButtons.forEach(button => button.classList.toggle('is-on', button.dataset.mode === mode));
    critButton.classList.toggle('is-on', critical);
    privateButton.classList.toggle('is-on', privateRoll);
  }
  sync();

  function showResult(rollResult) {
    const nat = rollResult.natural === 20 ? ' nat20' : rollResult.natural === 1 ? ' nat1' : '';
    const textNode = el('div', { className: 'muted small' });
    String(rollResult.text || '').split(/(~~\d+~~)/).forEach(part => {
      textNode.append(/^~~\d+~~$/.test(part) ? el('s', { text: part.slice(2, -2) }) : document.createTextNode(part));
    });
    result.replaceChildren(
      el('div', { className: 'dice-total' + nat, text: String(rollResult.total) }),
      el('div', {}, [
        el('strong', { text: rollResult.character }), ' — ' + rollResult.label,
        rollResult.mode !== 'normal' ? el('span', { className: 'muted small', text: ' (' + rollResult.mode + ')' }) : null,
        rollResult.private ? el('span', { className: 'tag gold', text: 'GM only' }) : null,
        textNode
      ])
    );
    bar.classList.remove('is-collapsed');
    collapse.textContent = '–';
  }

  async function roll(characterId, request) {
    if (busy) return;
    busy = true;
    bar.classList.add('is-rolling');
    try {
      const response = await fetch('/api/characters/' + characterId + '/roll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ mode, critical, private: privateRoll }, request))
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not roll.');
      showResult(data);
      if (critical && /damage/i.test(data.label)) { critical = false; sync(); }
      document.dispatchEvent(new CustomEvent('grimbold-roll', { detail: data }));
    } catch (error) {
      result.replaceChildren(el('span', { className: 'sheet-message is-error', text: error.message }));
    } finally {
      busy = false;
      bar.classList.remove('is-rolling');
    }
  }

  // Click anything marked data-roll. Inside a label (saves, skills) the click
  // rolls instead of ticking the checkbox.
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-roll]');
    if (!target) return;
    const owner = target.closest('[data-roll-character]');
    if (!owner) return;
    event.preventDefault();
    const request = { roll: target.dataset.roll };
    if (event.shiftKey) request.mode = 'advantage';
    else if (event.ctrlKey || event.metaKey) request.mode = 'disadvantage';
    roll(owner.dataset.rollCharacter, request);
  });

  // ─── Owlbear Rodeo key ────────────────────────────────────────────────────
  async function showKey() {
    const existing = document.getElementById('dice-key-dialog');
    if (existing) { existing.remove(); return; }
    const box = el('div', { id: 'dice-key-dialog', className: 'dice-key' }, [el('p', { className: 'muted small', text: 'Loading your key…' })]);
    bar.append(box);
    async function load(regenerate) {
      try {
        const response = await fetch('/api/vtt/key', { method: regenerate ? 'POST' : 'GET' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not get your key.');
        const keyInput = el('input', { type: 'text', readonly: true, value: data.key, 'aria-label': 'Your Owlbear key', className: 'dice-formula' });
        const manifest = window.location.origin + '/vtt/manifest.json';
        box.replaceChildren(
          el('p', { className: 'small' }, [el('strong', { text: 'Rolls in Owlbear Rodeo' })]),
          el('ol', { className: 'small dice-steps' }, [
            el('li', {}, ['In Owlbear Rodeo: your profile → Extensions → Add custom extension → ', el('code', { text: manifest })]),
            el('li', { text: 'In a room, open "Grimbold\'s Dice" and paste this key:' })
          ]),
          el('div', { className: 'dice-bar-row' }, [
            keyInput,
            el('button', { type: 'button', className: 'btn btn-small', text: 'Copy', onclick: () => { keyInput.select(); navigator.clipboard && navigator.clipboard.writeText(data.key); } })
          ]),
          el('p', { className: 'muted small' }, ['The key only shows your own rolls. ',
            el('button', { type: 'button', className: 'link-button small', text: 'Make a new key', onclick: () => { if (window.confirm('Make a new key? The old one stops working in Owlbear.')) load(true); } })])
        );
      } catch (error) {
        box.replaceChildren(el('p', { className: 'sheet-message is-error', text: error.message }));
      }
    }
    load(false);
  }
})();
