// public/character-combat.js — Armor Class and attacks on the character sheet,
// worked out on the server from worn armor and wielded weapons: fills the AC
// box (with its breakdown) and lists the attacks above the typed-in ones.

(function () {
  const root = document.getElementById('cs_attacks_auto');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);
  const acInput = document.getElementById('cs_ac');
  const details = document.getElementById('cs_ac_details');

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
  const signed = n => (n >= 0 ? '+' : '') + n;

  let view = null;
  let message = '';
  let isError = false;
  let editingAdjustment = false;

  async function request(method, body) {
    const response = await fetch('/api/characters/' + characterId + '/combat', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not work out Armor Class.');
    return result;
  }

  function renderArmorClass() {
    const ac = view.armorClass;
    if (!details) return;
    if (ac.manual) {
      // Hand-typed AC (older characters) until they wear armor or a shield.
      acInput.readOnly = false;
      acInput.title = '';
      details.replaceChildren(el('p', { className: 'muted small', text: 'Armor Class is typed in. Wear armor or a shield from Equipment & Items to have it worked out.' }));
      return;
    }
    acInput.value = ac.value;
    acInput.readOnly = true;
    const breakdown = ac.parts.map(part => part.label + ' ' + (part === ac.parts[0] ? part.value : signed(part.value))).join(' · ');
    acInput.title = 'AC ' + ac.value + ': ' + breakdown;

    const adjustment = el('input', { type: 'number', min: '-10', max: '10', value: String(ac.adjustment || 0), className: 'inventory-qty', 'aria-label': 'Other AC bonus or penalty' });
    const saveAdjustment = el('button', {
      type: 'button', className: 'btn btn-small', text: 'Save',
      onclick: async () => {
        try {
          view = await request('POST', { action: 'adjustAc', value: Number(adjustment.value) || 0 });
          editingAdjustment = false;
          message = '';
          isError = false;
        } catch (error) {
          message = error.message;
          isError = true;
        }
        render();
      }
    });
    details.replaceChildren(...[
      el('p', { className: 'small ac-breakdown' }, [
        el('strong', { text: 'AC ' + ac.value + ' = ' }), breakdown, ' ',
        el('button', {
          type: 'button', className: 'link-button small', text: editingAdjustment ? 'cancel' : 'adjust',
          onclick: () => { editingAdjustment = !editingAdjustment; render(); }
        })
      ]),
      editingAdjustment
        ? el('div', { className: 'vitals-actions' }, [
          el('span', { className: 'muted small', text: 'Other bonus or penalty (spells, features the sheet does not track):' }),
          adjustment, saveAdjustment
        ])
        : null,
      ...ac.notes.map(note => el('p', { className: 'muted small ac-note', text: note }))
    ].filter(Boolean));
  }

  function renderAttacks() {
    const rows = view.attacks.map(attack => el('tr', {}, [
      el('td', { 'data-label': 'Name' }, [el('strong', { text: attack.name }), attack.weapon && attack.weapon !== attack.name ? el('span', { className: 'muted small', text: ' ' + attack.weapon }) : null]),
      el('td', { 'data-label': 'Attack', text: attack.attackBonus }),
      el('td', { 'data-label': 'Damage', text: attack.damage }),
      el('td', { 'data-label': 'Notes', className: 'muted small', text: attack.notes.join(' · ') })
    ]));
    root.replaceChildren(...[
      el('table', { className: 'sheet-attacks sheet-attacks-auto' }, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Name' }), el('th', { text: 'Atk Bonus' }), el('th', { text: 'Damage / Type' }), el('th', { text: 'Notes' })])),
        el('tbody', {}, rows)
      ]),
      el('p', { className: 'muted small', text: 'Weapons at hand in Equipment & Items (and magic weapons worn or held) appear here.' }),
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), text: message }) : null
    ].filter(Boolean));
  }

  function render() {
    if (!view) return;
    renderArmorClass();
    renderAttacks();
  }

  async function load() {
    try {
      view = await request('GET');
      message = '';
      isError = false;
    } catch (error) {
      message = error.message;
      isError = true;
      view = view || { armorClass: { manual: true, parts: [], notes: [] }, attacks: [] };
    }
    render();
  }

  window.refreshCharacterCombat = load;
  load();
})();
