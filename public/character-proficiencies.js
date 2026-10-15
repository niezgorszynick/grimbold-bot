// public/character-proficiencies.js — "Proficiencies & Languages" on the
// character sheet: armor training, weapons, tools and languages. Everyone sees
// them; a DM can edit the lists (one entry per line or comma-separated).

(function () {
  const root = document.getElementById('cs_proficiencies');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);
  const ROWS = [
    ['armor', 'Armor'],
    ['weapons', 'Weapons'],
    ['tools', 'Tools'],
    ['languages', 'Languages']
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
      if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  let view = null;
  let editing = false;
  let message = '';
  let isError = false;

  async function request(method, body) {
    const response = await fetch('/api/characters/' + characterId + '/proficiencies', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load proficiencies.');
    return result;
  }

  function renderEditor() {
    const inputs = {};
    const fields = ROWS.map(([key, label]) => {
      inputs[key] = el('textarea', { rows: '2', 'aria-label': label });
      inputs[key].value = view[key].join(', ');
      return el('label', { className: 'prof-edit-field' }, [el('span', { className: 'muted small', text: label }), inputs[key]]);
    });
    const save = el('button', {
      type: 'button', className: 'btn btn-small btn-green', text: 'Save',
      onclick: async () => {
        const lists = Object.fromEntries(ROWS.map(([key]) => [key, inputs[key].value.split(/[,\n]/).map(entry => entry.trim()).filter(Boolean)]));
        try {
          view = await request('POST', lists);
          editing = false;
          message = 'Proficiencies saved.';
          isError = false;
        } catch (error) {
          message = error.message;
          isError = true;
        }
        render();
      }
    });
    const cancel = el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Cancel', onclick: () => { editing = false; render(); } });
    return el('div', { className: 'prof-editor' }, [
      el('p', { className: 'muted small', text: 'Separate entries with commas or new lines, e.g. "Light armor, Shields" or "Thieves’ Tools".' }),
      ...fields,
      el('div', { className: 'vitals-actions' }, [save, cancel])
    ]);
  }

  function render() {
    if (!view) return;
    const heading = el('div', { className: 'sheet-section-heading' }, [
      el('span', {}),
      view.canEdit && !editing ? el('button', { type: 'button', className: 'btn btn-small', text: 'Edit (DM)', onclick: () => { editing = true; message = ''; render(); } }) : null
    ]);
    const body = editing
      ? renderEditor()
      : el('dl', { className: 'prof-list' }, ROWS.flatMap(([key, label]) => [
        el('dt', { text: label }),
        el('dd', {}, view[key].length
          ? view[key].map(name => el('span', { className: 'tag prof-tag', text: name }))
          : [el('span', { className: 'muted small', text: 'None' })])
      ]));
    root.replaceChildren(...[
      el('h4', { text: 'Proficiencies & Languages' }),
      view.canEdit ? heading : null,
      body,
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null
    ].filter(Boolean));
  }

  async function load() {
    try {
      view = await request('GET');
      render();
    } catch (error) {
      root.replaceChildren(el('h4', { text: 'Proficiencies & Languages' }), el('p', { className: 'alert red', text: error.message }));
    }
  }

  window.refreshCharacterProficiencies = load;
  load();
})();
