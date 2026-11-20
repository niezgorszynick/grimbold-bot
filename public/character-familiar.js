// public/character-familiar.js — "Familiar" card on the sheet of a character
// who can cast Find Familiar (or was given a familiar by the DM): cast it
// (form, name, Celestial / Fey / Fiend, feat choices), its own Hit Points,
// dismiss / recall / release, and its stat block, whose numbers roll
// (public/dice.js; ids "familiar:..."). Its initiative goes to its own row in
// a running fight. Admins can grant a familiar and allow any statblock.

(function () {
  const root = document.getElementById('cs_familiar');
  const body = document.getElementById('cs_familiar_body');
  if (!root || !body) return;
  const characterId = Number(root.dataset.characterId);
  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

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
  const mod = score => Math.floor(((score || 10) - 10) / 2);

  let view = null;
  let message = '';
  let isError = false;
  let picking = false;

  async function request(method, payload) {
    const response = await fetch('/api/characters/' + characterId + '/familiar', {
      method,
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
  }

  const EVENTS = {
    summoned: name => name + ' answers the call.',
    reshaped: name => name + ' takes its new form.',
    dismissed: name => name + ' slips into its pocket dimension.',
    recalled: name => name + ' is back.',
    released: name => name + ' is gone for good (until you cast Find Familiar again).',
    vanished: name => name + ' drops to 0 HP and disappears.'
  };

  async function act(payload, success) {
    try {
      const result = await request('POST', payload);
      view = result.familiar;
      const name = view.name || 'Your familiar';
      const events = (result.events || []).map(event => EVENTS[event] ? EVENTS[event](name) : '').filter(Boolean);
      message = events.join(' ') || success || '';
      isError = false;
      if (payload.action === 'summon') picking = false;
    } catch (error) {
      message = error.message;
      isError = true;
    }
    render();
  }

  const roll = (id, text, title) => (view && view.status === 'active'
    ? el('button', { type: 'button', className: 'roll-link', 'data-roll': 'familiar:' + id, title, text })
    : el('span', { text }));

  function features(title, list, section) {
    if (!list || !list.length) return null;
    return el('div', { className: 'beast-features' }, [
      el('h6', { text: title }),
      ...list.map((entry, index) => {
        const attack = entry.attack && view.block.canAttack ? el('span', { className: 'beast-rolls' }, [
          roll(section + ':' + index + ':hit', signed(entry.attack.bonus) + ' to hit', 'Roll to hit'),
          entry.attack.damage ? ' · ' : null,
          entry.attack.damage ? roll(section + ':' + index + ':damage:0', entry.attack.damage.formula + ' ' + entry.attack.damage.type, 'Roll damage') : null
        ]) : null;
        const pulse = entry.roll && view.status === 'active'
          ? el('button', { type: 'button', className: 'roll-link', 'data-roll': entry.roll.id, title: 'Roll the damage', text: entry.roll.formula + ' ' + entry.roll.type })
          : null;
        return el('p', {}, [el('strong', { text: entry.name + '. ' }), attack, pulse, attack || pulse ? el('br') : null, el('span', { className: 'muted small', text: entry.text })]);
      })
    ]);
  }

  function statBlock(block) {
    const skills = Object.entries(block.skills || {});
    const perception = (block.skills || {}).Perception ?? mod(block.abilities.wis);
    return el('div', { className: 'beast-block' }, [
      el('p', { className: 'muted small', text: block.typeLine + (block.hpBonus ? ' · +' + block.hpBonus + ' HP from Familiar Friend' : '') }),
      el('div', { className: 'beast-stats' }, [
        el('div', {}, [el('small', { text: 'AC' }), el('strong', { text: String(block.armorClass ?? '—') })]),
        el('div', {}, [el('small', { text: 'Initiative' }), roll('initiative', signed(block.initiative), 'Roll its initiative (it joins a running fight)')]),
        el('div', {}, [el('small', { text: 'Speed' }), el('span', { text: block.speed })]),
        el('div', {}, [el('small', { text: 'Passive Perception' }), el('span', { text: String(10 + perception) })])
      ]),
      el('table', { className: 'beast-abilities' }, [
        el('thead', {}, el('tr', {}, [el('th', { text: '' }), ...ABILITIES.map(ability => el('th', { text: ability.toUpperCase() }))])),
        el('tbody', {}, [
          el('tr', {}, [el('th', { text: 'Score' }), ...ABILITIES.map(ability => el('td', {}, [
            String(block.abilities[ability] ?? '—'), ' ', roll('check:' + ability, '(' + signed(mod(block.abilities[ability])) + ')', ability.toUpperCase() + ' check')
          ]))]),
          el('tr', {}, [el('th', { text: 'Save' }), ...ABILITIES.map(ability => el('td', {}, roll('save:' + ability, signed(block.saves[ability] ?? mod(block.abilities[ability])), ability.toUpperCase() + ' save')))])
        ])
      ]),
      skills.length ? el('p', { className: 'small' }, [el('strong', { text: 'Skills ' }), ...skills.flatMap(([skill, bonus], index) => [index ? ', ' : '', roll('skill:' + skill, skill + ' ' + signed(bonus), skill + ' check')])]) : null,
      block.senses ? el('p', { className: 'small' }, [el('strong', { text: 'Senses ' }), block.senses]) : null,
      block.resistances ? el('p', { className: 'small' }, [el('strong', { text: 'Resistances ' }), block.resistances]) : null,
      block.immunities ? el('p', { className: 'small' }, [el('strong', { text: 'Immunities ' }), block.immunities]) : null,
      block.languages ? el('p', { className: 'small' }, [el('strong', { text: 'Languages ' }), block.languages]) : null,
      features('Traits', block.traits, 'traits'),
      features('Actions', block.actions, 'actions'),
      features('Bonus Actions', block.bonusActions, 'bonusActions'),
      features('Reactions', block.reactions, 'reactions')
    ]);
  }

  function select(options, current, label) {
    const node = el('select', { 'aria-label': label });
    options.forEach(option => {
      const value = typeof option === 'string' ? option : option.value;
      const text = typeof option === 'string' ? option : option.text;
      node.append(el('option', { value, text, selected: value === current ? true : null }));
    });
    return node;
  }

  // Casting Find Familiar: a form (by group), a name, its creature type and
  // the feat choices. Casting again while it is here changes its form.
  function castForm() {
    const formSelect = el('select', { 'aria-label': 'Form' });
    const groups = {};
    view.forms.forEach(form => { (groups[form.group] = groups[form.group] || []).push(form); });
    Object.entries(groups).forEach(([group, forms]) => {
      const optgroup = el('optgroup', { label: group });
      forms.forEach(form => optgroup.append(el('option', { value: form.name, text: form.name + ' · ' + form.size + (form.type !== 'Beast' ? ' ' + form.type : '') + ' · CR ' + form.crText, selected: form.name === view.form ? true : null })));
      formSelect.append(optgroup);
    });
    const name = el('input', { type: 'text', maxlength: '60', placeholder: 'Name (optional)', value: view.name && view.name !== view.form ? view.name : '', 'aria-label': 'Familiar name' });
    const type = select(view.types, view.creatureType || 'Fey', 'Creature type');
    const extra = [];
    const options = {};
    if (view.elementalTypes.length) {
      const pick = select([{ value: '', text: 'Elemental Familiar: damage type…' }, ...view.elementalTypes.map(t => ({ value: t, text: t }))], view.options.elementalType || '', 'Elemental damage type');
      extra.push(pick);
      options.elementalType = () => pick.value || null;
    }
    if (view.otherworldlyTypes.length) {
      const pick = select([{ value: '', text: 'Otherworldly Familiar: resistance…' }, ...view.otherworldlyTypes.map(t => ({ value: t, text: t }))], view.options.otherworldlyType || '', 'Otherworldly resistance');
      extra.push(pick);
      options.otherworldlyType = () => pick.value || null;
    }
    if (view.chainMasterMoves.length) {
      const pick = select([{ value: '', text: 'Chain Master: Fly or Swim 40 ft.…' }, { value: 'fly', text: 'Fly 40 ft.' }, { value: 'swim', text: 'Swim 40 ft.' }], view.options.chainMasterMove || '', 'Chain Master speed');
      extra.push(pick);
      options.chainMasterMove = () => pick.value || null;
    }
    const cast = el('button', {
      type: 'button', className: 'btn btn-small btn-green', text: '✨ Cast Find Familiar',
      onclick: () => act({
        action: 'summon', form: formSelect.value, name: name.value, creatureType: type.value,
        options: Object.fromEntries(Object.entries(options).map(([key, read]) => [key, read()]))
      })
    });
    return el('div', { className: 'spell-picker familiar-cast' }, [
      el('p', { className: 'muted small', text: 'Find Familiar: 1 hour, or 10 minutes longer as a Ritual' +
        (view.rules.chain ? '; Pact of the Chain casts it as a Magic action without a slot' : '') +
        (view.rules.friend ? '; Familiar Friend casts it once per Long Rest without a slot' : '') +
        (view.rules.wildCompanionOnly ? '; Wild Companion: a Magic action and a spell slot or Wild Shape use, and it leaves at your next Long Rest' : '') +
        '. Spend the slot or use on the sheet yourself. Casting it while you have a familiar changes its form (back to full HP).' }),
      el('div', { className: 'familiar-cast-row' }, [formSelect, name, type, ...extra, cast]),
      view.status !== 'gone' ? el('button', { type: 'button', className: 'link-button small', text: 'Cancel', onclick: () => { picking = false; render(); } }) : null
    ]);
  }

  function hpControls() {
    const hp = view.hp;
    const ratio = hp.max ? Math.max(0, Math.min(1, hp.current / hp.max)) : 0;
    const amount = el('input', { type: 'number', min: '1', max: '1000', inputmode: 'numeric', placeholder: 'HP', 'aria-label': 'Amount' });
    const change = action => {
      const value = Number(amount.value);
      if (!Number.isInteger(value) || value <= 0) { message = 'Enter a positive whole number first.'; isError = true; render(); return; }
      act({ action, amount: value }, { damage: 'Took ' + value + ' damage.', heal: 'Healed ' + value + ' HP.', tempHp: value + ' temporary HP.' }[action]);
    };
    amount.addEventListener('keydown', event => { if (event.key === 'Enter') change('damage'); });
    return el('div', { className: 'familiar-hp' }, [
      el('div', { className: 'vitals-hp-line' }, [
        el('strong', { text: 'HP ' + hp.current + ' / ' + hp.max + (hp.temp ? ' (+' + hp.temp + ' temp)' : '') }),
        el('span', { className: 'vitals-bar' }, el('span', { style: 'width:' + Math.round(ratio * 100) + '%; background:' + (ratio > 0.5 ? '#23a55a' : ratio > 0 ? '#f0b232' : '#f23f43') }))
      ]),
      view.canEdit ? el('div', { className: 'party-hp-actions' }, [
        amount,
        el('button', { type: 'button', className: 'btn btn-small btn-red', text: 'Damage', onclick: () => change('damage') }),
        el('button', { type: 'button', className: 'btn btn-small btn-green', text: 'Heal', onclick: () => change('heal') }),
        el('button', { type: 'button', className: 'btn btn-small', text: 'Temp HP', onclick: () => change('tempHp') })
      ]) : null
    ]);
  }

  function adminTools() {
    if (!view.canGrant) return null;
    const grant = el('input', { type: 'checkbox', checked: view.dmGranted ? true : null });
    grant.addEventListener('change', () => act({ action: 'grant', on: grant.checked }, grant.checked ? 'Familiar granted.' : 'Grant removed.'));
    const tools = [el('label', { className: 'small' }, [grant, ' DM: grant a familiar (even without Find Familiar)'])];
    if (view.available) {
      const any = el('input', { type: 'checkbox', checked: view.anyForm ? true : null });
      any.addEventListener('change', () => act({ action: 'anyForm', on: any.checked }, any.checked ? 'Any statblock allowed.' : 'Forms by the rules again.'));
      tools.push(el('label', { className: 'small' }, [any, ' DM: allow any statblock as its form']));
    }
    return el('div', { className: 'familiar-admin muted' }, tools);
  }

  function render() {
    if (!view || (!view.available && !view.canGrant)) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const status = message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null;
    if (!view.available) {
      body.replaceChildren(...[el('p', { className: 'muted small', text: 'No Find Familiar on this character.' }), adminTools(), status].filter(Boolean));
      return;
    }
    const parts = [el('p', { className: 'muted small', text: 'From ' + view.rules.ways.join(', ') + (view.rules.spellcasting ? ' · ' + view.rules.spellcasting.label + ' DC ' + view.rules.spellcasting.saveDc : '') })];
    if (view.missing) parts.push(el('p', { className: 'sheet-message is-error', text: view.form + ' is not in the monster list on this server any more. Cast Find Familiar again.' }));
    if (view.status === 'gone' || !view.block) {
      parts.push(el('p', { className: 'small', text: view.form ? (view.name + ' is gone. Cast Find Familiar to call it back.') : 'You have no familiar yet.' }));
      if (view.canEdit) parts.push(castForm());
    } else {
      const block = view.block;
      parts.push(el('div', { className: 'familiar-head' }, [
        el('strong', { text: '🐾 ' + view.name }),
        el('span', { className: 'muted small', text: ' ' + (view.name !== block.form ? block.form + ', ' : '') + view.creatureType }),
        view.status === 'dismissed' ? el('span', { className: 'tag', text: 'In its pocket dimension' }) : null
      ]));
      if (view.status === 'active') parts.push(hpControls());
      if (view.canEdit) {
        parts.push(el('div', { className: 'vitals-actions' }, [
          view.status === 'active'
            ? el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Dismiss', title: 'Magic action: into its pocket dimension (it drops what it carries)', onclick: () => act({ action: 'dismiss' }) })
            : el('button', { type: 'button', className: 'btn btn-small btn-green', text: 'Recall', title: 'Magic action: it reappears within 30 ft.', onclick: () => act({ action: 'recall' }) }),
          el('button', { type: 'button', className: 'btn btn-small', text: 'Change form', title: 'Cast Find Familiar again', onclick: () => { picking = true; render(); } }),
          el('button', { type: 'button', className: 'btn btn-small btn-red', text: 'Release', title: 'Dismiss it forever', onclick: () => { if (window.confirm('Dismiss ' + view.name + ' forever? Casting Find Familiar brings a familiar again.')) act({ action: 'release' }); } }),
          el('button', { type: 'button', className: 'link-button small', text: 'Rename', onclick: () => { const name = window.prompt('Name your familiar', view.name || ''); if (name !== null) act({ action: 'update', name }, 'Renamed.'); } })
        ]));
      }
      if (picking && view.canEdit) parts.push(castForm());
      (block.notes || []).forEach(note => parts.push(el('p', { className: 'muted small', text: '⚠ ' + note })));
      parts.push(statBlock(block));
    }
    parts.push(adminTools(), status);
    body.replaceChildren(...parts.filter(Boolean));
  }

  async function load() {
    try {
      view = await request('GET');
    } catch (error) {
      view = null;
    }
    render();
  }

  window.refreshCharacterFamiliar = load;
  load();
})();
