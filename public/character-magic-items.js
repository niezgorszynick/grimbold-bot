// public/character-magic-items.js — Magic items on the character sheet:
// wearing, attunement (up to 3 items), charges and consumables, plus giving
// items to a character for the DM. The server enforces the rules.

(function () {
  const root = document.getElementById('cs_magic_items');
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
  const button = (text, onclick, className = 'btn btn-small', title) => el('button', { type: 'button', className, text, onclick, title });

  // Minimal Markdown for item text: paragraphs, **bold**, *italic*.
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

  let view = null;
  let itemNames = null; // for the DM's "give item" list
  let message = '';
  let isError = false;
  const open = new Set();

  async function request(method, body) {
    const response = await fetch('/api/characters/' + characterId + '/magic-items', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update magic items.');
    return result;
  }

  async function act(body) {
    try {
      const result = await request('POST', body);
      view = result.magicItems;
      message = result.message || '';
      isError = false;
      // Items can change Hit Points (Constitution) and spell save DCs.
      if (window.refreshCharacterVitals) window.refreshCharacterVitals();
      if (window.refreshCharacterSpells) window.refreshCharacterSpells();
      // Magic armor, shields and weapons change Armor Class and attacks.
      if (window.refreshCharacterCombat) window.refreshCharacterCombat();
      return true;
    } catch (error) {
      message = error.message;
      isError = true;
      return false;
    } finally {
      render();
    }
  }

  function signed(n) {
    return (n >= 0 ? '+' : '') + n;
  }

  function effectsSummary(effects) {
    const parts = effects.scores.map(score => score.name + ' ' + score.from + ' → ' + score.to + ' (' + score.items.join(', ') + ')');
    if (effects.ac) parts.push(signed(effects.ac) + ' AC');
    if (effects.saves) parts.push(signed(effects.saves) + ' saving throws');
    if (effects.checks) parts.push(signed(effects.checks) + ' ability checks');
    if (effects.spellAttack) parts.push(signed(effects.spellAttack) + ' spell attacks');
    if (effects.spellDc) parts.push(signed(effects.spellDc) + ' spell save DC');
    Object.entries(effects.classBonuses || {}).forEach(([className, bonus]) => {
      parts.push(signed(bonus.spellAttack) + ' spell attacks and ' + signed(bonus.spellDc) + ' save DC for ' + className + ' spells');
    });
    return parts;
  }

  function itemRow(item) {
    const tags = [
      item.rulesName && item.rulesName !== item.name ? item.rulesName : null,
      item.rarity,
      item.kind + (item.baseItem ? ' (' + item.baseItem + ')' : ''),
      item.attunement.required ? 'Requires attunement' + (item.attunement.by ? ' by ' + item.attunement.by : '') : null,
      item.source === 'shop' ? 'bought' : null
    ].filter(Boolean);
    const badges = [];
    if (item.attuned) badges.push(el('span', { className: 'tag gold', text: 'Attuned' }));
    if (item.equipped && !item.consumable) badges.push(el('span', { className: 'tag', text: 'Worn / held' }));
    if (item.quantity > 1) badges.push(el('span', { className: 'tag', text: '×' + item.quantity }));

    const controls = el('span', { className: 'spell-cast' });
    if (item.consumable) {
      controls.append(button('Use one', () => {
        if (window.confirm('Use up one ' + item.name + '?')) act({ action: 'consume', uid: item.uid });
      }));
    } else {
      controls.append(item.equipped
        ? button('Put away', () => act({ action: 'unequip', uid: item.uid }))
        : button('Wear / hold', () => act({ action: 'equip', uid: item.uid })));
      if (item.attunement.required) {
        if (item.attuned) {
          controls.append(button('End attunement', () => act({ action: 'unattune', uid: item.uid })));
        } else {
          const full = view.attuned >= view.attunementLimit;
          const reason = item.attuneBlocked || (full ? 'You are already attuned to ' + view.attunementLimit + ' items.' : null);
          const attune = button('Attune', () => act({ action: 'attune', uid: item.uid }), 'btn btn-small btn-green', reason || 'Attuning takes a Short Rest spent focused on the item.');
          attune.disabled = Boolean(reason);
          controls.append(attune);
        }
      }
    }
    if (item.charges) {
      const canUse = item.charges.left > 0 && (!item.attunement.required || item.attuned);
      const use = button('Use charge', () => act({ action: 'useCharges', uid: item.uid, count: 1 }), 'btn btn-small',
        item.attunement.required && !item.attuned ? 'Attune to the item to use its charges.' : undefined);
      use.disabled = !canUse;
      controls.append(el('span', { className: 'muted small', text: 'Charges ' + item.charges.left + '/' + item.charges.max }), use);
    }
    if (view.canGrant) {
      if (item.charges && item.charges.left < item.charges.max) {
        controls.append(button('Restore charges', () => act({ action: 'restoreCharges', uid: item.uid })));
      }
      controls.append(button('Remove', () => {
        if (window.confirm('Take ' + item.name + ' away from this character?')) act({ action: 'remove', uid: item.uid });
      }, 'btn btn-small btn-red'));
    }

    const key = item.uid;
    const details = open.has(key)
      ? el('div', { className: 'spell-details' }, [
        item.effects.length ? el('p', {}, [el('strong', { text: 'On the sheet: ' }), item.effects.join(', ') + (item.attunement.required ? ' (while attuned)' : ' (while worn or held)')]) : null,
        item.charges ? el('p', { className: 'muted small', text: item.charges.max + ' charges' + (item.charges.regain
          ? '; regains ' + item.charges.regain + ' daily at ' + item.charges.at + ' (applied on a Long Rest).'
          : '; they do not come back on their own.') }) : null,
        renderText(item.description)
      ])
      : null;

    return el('div', { className: 'spell-row' }, [
      el('div', { className: 'spell-row-main' }, [
        el('button', {
          type: 'button', className: 'spell-name', 'aria-expanded': String(open.has(key)), text: item.name,
          onclick: () => { open.has(key) ? open.delete(key) : open.add(key); render(); }
        }),
        el('span', { className: 'muted small', text: tags.join(' · ') }),
        ...badges,
        controls
      ]),
      details
    ]);
  }

  function renderGrant() {
    const listId = 'magic-item-names-' + characterId;
    const name = el('input', { type: 'text', list: listId, placeholder: 'Magic item name…', 'aria-label': 'Magic item to give' });
    const quantity = el('input', { type: 'number', min: '1', max: '99', value: '1', 'aria-label': 'Quantity', style: 'width: 5em' });
    const datalist = el('datalist', { id: listId }, (itemNames || []).map(option => el('option', { value: option })));
    const give = button('Give item', async () => {
      if (!name.value.trim()) return;
      const ok = await act({ action: 'grant', name: name.value.trim(), quantity: Number(quantity.value) || 1 });
      if (ok) name.value = '';
    }, 'btn btn-small btn-green');
    return el('div', { className: 'spell-picker' }, [
      el('p', { className: 'muted small', text: 'DM: give this character a magic item (for example adventure loot). Items with versions need the full name, e.g. "Weapon +1" or "Belt of Giant Strength (Hill)". Name the base weapon or armor where the item allows several, e.g. "+1 Longsword", "Frost Brand (Longsword)" or "Elven Chain (Chain Shirt)", so it shows in AC and attacks.' }),
      el('div', { className: 'vitals-actions' }, [name, quantity, give]),
      datalist
    ]);
  }

  function render() {
    if (!view) return;
    root.hidden = !view.items.length && !view.canGrant;
    if (root.hidden) return;
    const summary = effectsSummary(view.effects);
    root.replaceChildren(...[
      el('div', { className: 'spell-source-header' }, [
        el('h4', { text: 'Magic Items' }),
        el('span', { className: 'muted', text: 'Attuned ' + view.attuned + '/' + view.attunementLimit })
      ]),
      summary.length ? el('p', { className: 'small' }, [el('strong', { text: 'Active effects: ' }), summary.join(' · ')]) : null,
      view.effects.notes.length ? el('p', { className: 'muted small', text: view.effects.notes.join(' ') }) : null,
      summary.length && view.effects.ac ? el('p', { className: 'muted small', text: 'AC bonuses are not added to the Armor Class field automatically; add them there if they apply.' }) : null,
      view.items.length
        ? el('div', {}, view.items.map(itemRow))
        : el('p', { className: 'muted small', text: 'No magic items yet.' }),
      view.canGrant ? renderGrant() : null,
      el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', 'aria-live': 'polite', text: message })
    ].filter(Boolean));
  }

  async function loadNames() {
    try {
      const response = await fetch('/api/rules/magic-items');
      if (!response.ok) return;
      const result = await response.json();
      itemNames = result.items.flatMap(item => (item.variants.length ? item.variants.map(variant => variant.name) : [item.name])).sort();
    } catch {
      itemNames = [];
    }
  }

  async function load() {
    try {
      view = await request('GET');
      if (view.canGrant && !itemNames) await loadNames();
      render();
    } catch (error) {
      root.hidden = false;
      root.replaceChildren(el('p', { className: 'alert red', text: error.message }));
    }
  }

  window.refreshCharacterMagicItems = load;
  load();
})();
