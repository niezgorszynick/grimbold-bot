// public/gift-form.js — "Give as a gift" on the character sheet: the form the
// equipment list (character-inventory.js) and Magic Items
// (character-magic-items.js) open under an item. Grimbold logs the gift and
// posts it in both characters' Discord threads.

(function () {
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

  // Every living character, loaded once per page.
  let recipients = null;
  function loadRecipients() {
    if (!recipients) {
      recipients = fetch('/api/gift-recipients').then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load the characters.');
        return data.recipients;
      });
      recipients.catch(() => { recipients = null; });
    }
    return recipients;
  }

  // options: { characterId, kind: 'item' | 'magic', index, name (equipment) or
  // uid (magic), itemName, max (how many there are), onDone(result), onCancel() }
  window.grimboldGiftForm = function giftForm(options) {
    const select = el('select', { 'aria-label': 'Who the gift is for' }, [el('option', { value: '', text: 'Loading characters…' })]);
    // Always shown, so it is clear how many go and how many there are.
    const quantity = el('input', { type: 'number', min: '1', max: String(options.max), value: '1', className: 'inventory-qty', 'aria-label': 'How many to give' });
    if (options.max <= 1) quantity.disabled = true;
    const note = el('input', { type: 'text', maxlength: '300', placeholder: 'A note with it (optional)', 'aria-label': 'Gift note', className: 'gift-note' });
    const status = el('p', { className: 'muted small', role: 'status' });
    const give = el('button', { type: 'button', className: 'btn btn-small btn-green', text: '🎁 Give' });
    const cancel = el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Cancel', onclick: () => options.onCancel && options.onCancel() });

    loadRecipients().then(list => {
      const others = list.filter(entry => entry.id !== options.characterId);
      const byPlayer = new Map();
      others.forEach(entry => {
        if (!byPlayer.has(entry.player)) byPlayer.set(entry.player, []);
        byPlayer.get(entry.player).push(entry);
      });
      select.replaceChildren(el('option', { value: '', text: others.length ? 'Give to…' : 'No one else to give to' }),
        ...[...byPlayer.entries()].map(([player, characters]) => el('optgroup', { label: player },
          characters.map(entry => el('option', { value: String(entry.id), text: entry.name + ' (Lvl ' + entry.level + ')' })))));
    }).catch(error => {
      select.replaceChildren(el('option', { value: '', text: 'Characters unavailable' }));
      status.textContent = error.message;
    });

    give.addEventListener('click', async () => {
      if (!select.value) { status.textContent = 'Choose who the gift is for.'; return; }
      const count = Number(quantity.value);
      if (!Number.isInteger(count) || count < 1 || count > options.max) { status.textContent = 'Give from 1 to ' + options.max + '.'; return; }
      const to = select.options[select.selectedIndex].text.replace(/ \(Lvl \d+\)$/, '');
      if (!window.confirm('Give ' + (count > 1 ? count + ' × ' : '') + options.itemName + ' to ' + to + '? It leaves this sheet.')) return;
      give.disabled = true;
      status.textContent = 'Wrapping the parcel…';
      try {
        const body = { toCharacterId: Number(select.value), kind: options.kind, quantity: count, note: note.value };
        if (options.kind === 'magic') body.uid = options.uid;
        else Object.assign(body, { index: options.index, name: options.name });
        const response = await fetch('/api/characters/' + options.characterId + '/gift', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not give the gift.');
        const posted = result.note && result.note.ok === false ? ' (Grimbold\'s note: ' + result.note.reason + ')' : '';
        options.onDone && options.onDone({ ...result, message: '🎁 ' + result.message + ' Grimbold has noted it.' + posted });
      } catch (error) {
        status.textContent = error.message;
        give.disabled = false;
      }
    });

    return el('div', { className: 'gift-form' }, [
      el('strong', { className: 'small', text: '🎁 Give ' + options.itemName + ' as a gift' }),
      el('div', { className: 'vitals-actions' }, [select, el('label', { className: 'small' }, ['give ', quantity, ' of ' + options.max])]),
      note,
      el('div', { className: 'vitals-actions' }, [give, cancel]),
      status
    ]);
  };
})();
