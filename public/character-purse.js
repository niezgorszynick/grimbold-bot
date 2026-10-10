// public/character-purse.js — The purse on the character sheet: gold, silver
// and copper, editable by the player (and DMs) with a reason. Every change is
// logged and Grimbold notes it in the character's Discord thread.

(function () {
  const root = document.getElementById('cs_purse');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);

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

  function format(cp) {
    const value = Math.max(0, Number(cp) || 0);
    const parts = [];
    if (Math.floor(value / 100)) parts.push(Math.floor(value / 100) + ' gp');
    if (Math.floor((value % 100) / 10)) parts.push(Math.floor((value % 100) / 10) + ' sp');
    if (value % 10) parts.push((value % 10) + ' cp');
    return parts.join(', ') || '0 cp';
  }

  let view = null;
  let editing = false;
  let message = '';
  let isError = false;

  async function request(method, body) {
    const response = await fetch('/api/characters/' + characterId + '/gold', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the purse.');
    return result;
  }

  function editor() {
    const coin = (name, value) => el('label', {}, [el('input', { type: 'number', min: '0', step: '1', value: String(value), name, 'aria-label': name.toUpperCase() }), ' ' + name]);
    const reason = el('input', { type: 'text', maxlength: '200', placeholder: 'Why? (shown in your Discord thread)', 'aria-label': 'Reason', className: 'dice-formula' });
    const form = el('form', { className: 'purse-edit' }, [
      el('span', { className: 'purse-inputs' }, [coin('gp', view.coins.gp), coin('sp', view.coins.sp), coin('cp', view.coins.cp)]),
      el('div', { className: 'dice-bar-row' }, [reason]),
      el('div', { className: 'vitals-actions' }, [
        el('button', { type: 'submit', className: 'btn btn-small btn-gold', text: 'Save purse' }),
        el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Cancel', onclick: () => { editing = false; render(); } })
      ])
    ]);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const value = name => form.querySelector('input[name="' + name + '"]').value;
      try {
        view = await request('POST', { gp: value('gp'), sp: value('sp'), cp: value('cp'), reason: reason.value });
        editing = false;
        const note = view.note || {};
        message = 'Purse saved: ' + view.formatted + '. ' + (note.ok ? 'Grimbold noted it in your thread.' : note.ok === null ? note.reason : 'Not posted to Discord: ' + (note.reason || 'unknown reason') + '.');
        isError = note.ok === false;
      } catch (error) {
        message = error.message;
        isError = true;
      }
      render();
    });
    return form;
  }

  function render() {
    if (!view) return;
    const history = view.changes.slice(0, 5).map(change => {
      const difference = change.new_cp - change.old_cp;
      const who = change.changed_by_admin ? 'DM' : (change.changed_by_tag || 'player');
      return el('li', { text: String(change.created_at || '').slice(0, 16) + ' · ' + (difference > 0 ? '+' : '−') + format(Math.abs(difference)) +
        ' · ' + who + (change.reason ? ' · ' + change.reason : '') });
    });
    root.replaceChildren(...[
      el('div', { className: 'dice-bar-row' }, [
        el('span', {}, [el('span', { className: 'muted small', text: 'Purse ' }), el('span', { className: 'purse-total', text: format(view.goldCp) })]),
        editing ? null : el('button', { type: 'button', className: 'btn btn-small', text: 'Edit purse', onclick: () => { editing = true; message = ''; render(); } })
      ]),
      editing ? editor() : null,
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null,
      history.length ? el('details', {}, [el('summary', { className: 'muted small', text: 'Recent purse changes' }), el('ul', { className: 'purse-history' }, history)]) : null
    ].filter(Boolean));
  }

  async function load() {
    try {
      view = await request('GET');
      render();
    } catch (error) {
      root.replaceChildren(el('p', { className: 'muted small', text: error.message }));
    }
  }

  // Purchases change the purse too.
  window.refreshCharacterPurse = load;
  load();
})();
