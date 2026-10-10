// public/character-inventory.js — The equipment list on the character sheet:
// items from the shop catalog or custom items, each with its description
// (click the name; hovering shows a preview). The server checks every change.

(function () {
  const root = document.getElementById('cs_inventory');
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
  const button = (text, onclick, className = 'btn btn-small', extra = {}) => el('button', Object.assign({ type: 'button', className, text, onclick }, extra));

  // Paragraphs with **bold** and *italic*.
  function renderText(text) {
    const wrap = el('div', { className: 'spell-text' });
    String(text || '').split(/\n{2,}/).forEach(block => {
      const p = el('p');
      block.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).forEach(part => {
        if (/^\*\*[^*]+\*\*$/.test(part)) p.append(el('strong', { text: part.slice(2, -2) }));
        else if (/^\*[^*]+\*$/.test(part)) p.append(el('em', { text: part.slice(1, -1) }));
        else if (part) p.append(document.createTextNode(part));
      });
      wrap.append(p);
    });
    return wrap;
  }
  const preview = text => {
    const plain = String(text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > 240 ? plain.slice(0, 237) + '...' : plain;
  };

  let view = null;
  let catalog = null;
  let mode = null; // 'catalog' | 'custom' | null
  let query = '';
  let message = '';
  let isError = false;
  const open = new Set();
  const openResults = new Set();

  async function request(method, body) {
    const response = await fetch('/api/characters/' + characterId + '/inventory', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update items.');
    return result;
  }

  async function act(body) {
    try {
      const result = await request('POST', body);
      view = result.inventory;
      message = result.message || '';
      isError = false;
      // A DM adding a magic item from the catalog puts it in Magic Items.
      if (body.action === 'add' && window.refreshCharacterMagicItems) window.refreshCharacterMagicItems();
      return true;
    } catch (error) {
      message = error.message;
      isError = true;
      return false;
    } finally {
      render();
    }
  }

  function itemRow(item) {
    const key = item.index + '|' + item.name;
    const quantity = el('input', {
      type: 'number', min: '1', max: '9999', value: String(item.quantity),
      className: 'inventory-qty', 'aria-label': 'Quantity of ' + item.name
    });
    quantity.addEventListener('change', () => {
      const value = Number(quantity.value);
      if (!Number.isInteger(value) || value < 1) {
        quantity.value = String(item.quantity);
        return;
      }
      act({ action: 'update', index: item.index, name: item.name, quantity: value });
    });
    const remove = button('✕', () => {
      if (window.confirm('Remove ' + item.name + ' from the equipment list?')) act({ action: 'remove', index: item.index, name: item.name });
    }, 'btn btn-small btn-secondary inventory-remove', { 'aria-label': 'Remove ' + item.name, title: 'Remove' });
    return el('li', { className: 'inventory-row' }, [
      el('div', { className: 'inventory-row-main' }, [
        el('button', {
          type: 'button', className: 'spell-name', text: item.name, 'aria-expanded': String(open.has(key)),
          title: item.description ? preview(item.description) : 'No description',
          onclick: () => { open.has(key) ? open.delete(key) : open.add(key); render(); }
        }),
        item.category ? el('span', { className: 'muted small', text: item.category }) : null,
        item.source === 'custom' ? el('span', { className: 'tag', text: 'Custom' }) : null,
        el('span', { className: 'inventory-controls' }, [quantity, remove])
      ]),
      open.has(key)
        ? el('div', { className: 'spell-details' }, [item.description
          ? renderText(item.description)
          : el('p', { className: 'muted small', text: 'No description. Custom items can have one when you add them.' })])
        : null
    ]);
  }

  function renderCatalogPicker() {
    const search = el('input', { type: 'search', placeholder: 'Search the shop catalog…', 'aria-label': 'Search the shop catalog', value: query });
    const quantity = el('input', { type: 'number', min: '1', max: '9999', value: '1', className: 'inventory-qty', 'aria-label': 'Quantity' });
    const results = el('ul', { className: 'inventory-results' });

    function showResults() {
      const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      results.replaceChildren();
      if (!catalog) {
        results.append(el('li', { className: 'muted small', text: 'Loading catalog…' }));
        return;
      }
      if (!words.length) {
        results.append(el('li', { className: 'muted small', text: 'Type to search ' + catalog.length + ' catalog items.' }));
        return;
      }
      const matches = catalog.filter(item => words.every(word => (item.name + ' ' + item.category).toLowerCase().includes(word))).slice(0, 12);
      if (!matches.length) {
        results.append(el('li', { className: 'muted small', text: 'No catalog item matches. Add it as a custom item instead.' }));
        return;
      }
      matches.forEach(item => {
        const blocked = item.magic && !view.canAddMagicItems;
        const add = button(item.magic && view.canAddMagicItems ? 'Add to Magic Items' : 'Add', () => {
          act({ action: 'add', catalogId: item.id, quantity: Number(quantity.value) || 1 });
        }, 'btn btn-small btn-green', blocked ? { disabled: true, title: 'Magic items come from the shop or the DM.' } : {});
        const key = String(item.id);
        results.append(el('li', { className: 'inventory-row' }, [
          el('div', { className: 'inventory-row-main' }, [
            el('button', {
              type: 'button', className: 'spell-name', text: item.name, 'aria-expanded': String(openResults.has(key)),
              title: item.description ? preview(item.description) : 'No description',
              onclick: () => { openResults.has(key) ? openResults.delete(key) : openResults.add(key); showResults(); }
            }),
            el('span', { className: 'muted small', text: item.category + (item.magic ? ' · magic item' : '') }),
            el('span', { className: 'inventory-controls' }, [add])
          ]),
          openResults.has(key) ? el('div', { className: 'spell-details' }, [renderText(item.description || 'No description.')]) : null
        ]));
      });
    }

    search.addEventListener('input', () => { query = search.value; showResults(); });
    showResults();
    if (!catalog) {
      fetch('/api/catalog/sheet-items')
        .then(response => (response.ok ? response.json() : { items: [] }))
        .then(result => { catalog = result.items || []; showResults(); })
        .catch(() => { catalog = []; showResults(); });
    }
    setTimeout(() => search.focus(), 0);
    return el('div', { className: 'inventory-add' }, [
      el('div', { className: 'inventory-add-fields' }, [search, el('label', { className: 'inventory-qty-label' }, ['Qty ', quantity])]),
      results
    ]);
  }

  function renderCustomForm() {
    const name = el('input', { type: 'text', maxlength: '100', placeholder: 'Item name', 'aria-label': 'Item name' });
    const quantity = el('input', { type: 'number', min: '1', max: '9999', value: '1', className: 'inventory-qty', 'aria-label': 'Quantity' });
    const description = el('textarea', { rows: '3', maxlength: '2000', placeholder: 'Description (optional): what it is, what it does…', 'aria-label': 'Description' });
    const add = button('Add custom item', async () => {
      if (!name.value.trim()) {
        name.focus();
        return;
      }
      const ok = await act({ action: 'add', name: name.value, quantity: Number(quantity.value) || 1, description: description.value });
      if (ok) mode = null;
      render();
    }, 'btn btn-small btn-green');
    setTimeout(() => name.focus(), 0);
    return el('div', { className: 'inventory-add' }, [
      el('div', { className: 'inventory-add-fields' }, [name, el('label', { className: 'inventory-qty-label' }, ['Qty ', quantity])]),
      description,
      el('div', { className: 'vitals-actions' }, [add])
    ]);
  }

  function render() {
    if (!view) return;
    const toggle = (value, text) => button(text, () => { mode = mode === value ? null : value; render(); },
      'btn btn-small' + (mode === value ? ' btn-gold' : ''), { 'aria-pressed': String(mode === value) });
    root.replaceChildren(...[
      view.items.length
        ? el('ul', { className: 'inventory-list' }, view.items.map(itemRow))
        : el('p', { className: 'muted small', text: 'No items yet.' }),
      el('div', { className: 'vitals-actions inventory-modes' }, [toggle('catalog', '+ From catalog'), toggle('custom', '+ Custom item')]),
      mode === 'catalog' ? renderCatalogPicker() : null,
      mode === 'custom' ? renderCustomForm() : null,
      el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', 'aria-live': 'polite', text: message })
    ].filter(Boolean));
  }

  async function load() {
    try {
      view = await request('GET');
      render();
    } catch (error) {
      root.replaceChildren(el('p', { className: 'alert red', text: error.message }));
    }
  }

  window.refreshCharacterInventory = load;
  load();
})();
