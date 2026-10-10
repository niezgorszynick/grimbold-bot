// public/character-spells.js — Spellcasting on the character sheet: choosing
// cantrips and prepared spells, the Wizard's spellbook, casting (spending a
// slot, a free use or as a ritual) and concentration. The server enforces the
// rules; this page only offers what it allows.

(function () {
  const root = document.getElementById('cs_spells');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);
  const ABILITY = { int: 'INT', wis: 'WIS', cha: 'CHA' };
  const EVENT_TEXT = {
    concentrationReplaced: 'Your previous concentration ended.',
    freeCast: 'Free casting used (returns after a Long Rest).',
    atWill: 'Cast at will (no slot).',
    ritual: 'Cast as a Ritual (takes 10 minutes longer, no slot).'
  };

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
  const button = (text, onclick, className = 'btn btn-small') => el('button', { type: 'button', className, text, onclick });
  const signed = n => (n >= 0 ? '+' : '') + n;
  const levelLabel = level => (level === 0 ? 'Cantrips' : 'Level ' + level);

  // Minimal Markdown for spell text: paragraphs, **bold**, *italic*, bullets.
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
  let catalog = {};
  let message = '';
  let isError = false;
  let editing = null; // source key being edited
  let editingInvocations = false;
  let invocationTexts = {};
  let creationRules = null; // origin feats, skills and tools for Lessons of the First Ones
  const openDetails = new Set();

  function field(label, control) {
    return el('label', { className: 'creator-field' }, [el('span', { text: label }), control]);
  }

  function selectOf(values, placeholder, labels) {
    const select = el('select');
    select.add(new Option(placeholder, ''));
    values.forEach(value => select.add(new Option(labels ? labels[value] : value, value)));
    return select;
  }

  // Exactly `count` picks from `options`.
  function checkboxGroup(options, count, label) {
    const grid = el('div', { className: 'creator-choice-grid' });
    const status = el('small', { className: 'muted' });
    const inputs = options.map(option => {
      const input = el('input', { type: 'checkbox', value: option });
      grid.append(el('label', { className: 'creator-check' }, [input, el('span', { text: option })]));
      return input;
    });
    const value = () => inputs.filter(input => input.checked).map(input => input.value);
    const refresh = () => {
      const picked = value().length;
      inputs.forEach(input => { input.disabled = !input.checked && picked >= count; });
      status.textContent = label + ': ' + picked + ' / ' + count;
    };
    grid.addEventListener('change', refresh);
    refresh();
    return { element: el('div', { className: 'creator-choice' }, [status, grid]), value };
  }

  async function request(method, body) {
    const response = await fetch('/api/characters/' + characterId + '/spells', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update spells.');
    return result;
  }

  async function act(body, describe) {
    try {
      const result = await request('POST', body);
      view = result.spells;
      message = describe ? describe(result) : '';
      isError = false;
      if (window.refreshCharacterVitals) window.refreshCharacterVitals();
      return true;
    } catch (error) {
      message = error.message;
      isError = true;
      return false;
    } finally {
      render();
    }
  }

  // Ways to cast a leveled spell from this source right now.
  function castOptions(source, spell) {
    const options = [];
    const free = source.freeLeft[spell.name];
    if (free === 'atWill') options.push({ label: 'At will (no slot)', value: { free: true } });
    else if (free > 0) options.push({ label: 'Free (' + free + ' left until Long Rest)', value: { free: true } });
    // Invocation spells are only ever cast without a slot.
    if (source.slotless) return options;
    if (spell.ritual) options.push({ label: 'As a Ritual (no slot)', value: { ritual: true } });
    for (const slot of view.slots) {
      if (slot.level >= spell.level && slot.total - slot.spent > 0) {
        options.push({ label: 'Level ' + slot.level + ' slot (' + (slot.total - slot.spent) + ' left)', value: { slotLevel: slot.level } });
      }
    }
    if (view.pact && view.pact.slotLevel >= spell.level && view.pact.count - view.pact.spent > 0) {
      options.push({ label: 'Pact slot, level ' + view.pact.slotLevel + ' (' + (view.pact.count - view.pact.spent) + ' left)', value: { pact: true } });
    }
    return options;
  }

  function cast(source, spell, how) {
    act(Object.assign({ action: 'cast', source: source.key, spell: spell.name }, how), result => {
      const via = how.pact ? ' with a Pact slot' : how.slotLevel ? ' with a level ' + how.slotLevel + ' slot' : '';
      const parts = ['Cast ' + spell.name + via + '.'];
      result.events.forEach(event => { if (EVENT_TEXT[event]) parts.push(EVENT_TEXT[event]); });
      if (result.events.includes('concentrating')) parts.push('Concentrating on ' + spell.name + '.');
      return parts.join(' ');
    });
  }

  function spellRow(source, name, { canCast = true, extraTag } = {}) {
    const spell = catalog[name] || { name, level: 0, description: 'This spell is not in the spell list file.' };
    const key = source.key + '|' + name;
    const tags = [
      spell.ritual ? 'Ritual' : null,
      spell.concentration ? 'Concentration' : null,
      spell.castingTime ? spell.castingTime.split(',')[0] : null,
      extraTag
    ].filter(Boolean);
    const controls = el('span', { className: 'spell-cast' });
    if (canCast) {
      if (spell.level === 0) {
        controls.append(button('Cast', () => cast(source, spell, {})));
      } else {
        const options = castOptions(source, spell);
        if (options.length) {
          const select = el('select', { 'aria-label': 'How to cast ' + spell.name });
          options.forEach((option, index) => select.add(new Option(option.label, String(index))));
          controls.append(select, button('Cast', () => cast(source, spell, options[Number(select.value)].value)));
        } else {
          controls.append(el('span', { className: 'muted small', text: source.slotless ? 'Used — returns after a Long Rest' : 'No slots left' }));
        }
      }
    }
    const details = openDetails.has(key)
      ? el('div', { className: 'spell-details' }, [
        el('p', { className: 'muted small', text: [spell.school, spell.castingTime, spell.range, spell.components && spell.components.text, spell.duration].filter(Boolean).join(' · ') }),
        renderText(spell.description),
        spell.higherLevels ? el('p', {}, [el('strong', { text: 'Using a Higher-Level Spell Slot. ' }), spell.higherLevels]) : null,
        spell.cantripUpgrade ? el('p', {}, [el('strong', { text: 'Cantrip Upgrade. ' }), spell.cantripUpgrade]) : null
      ])
      : null;
    return el('div', { className: 'spell-row' }, [
      el('div', { className: 'spell-row-main' }, [
        el('button', {
          type: 'button', className: 'spell-name', 'aria-expanded': String(openDetails.has(key)), text: spell.name,
          onclick: () => { openDetails.has(key) ? openDetails.delete(key) : openDetails.add(key); render(); }
        }),
        el('span', { className: 'muted small', text: tags.join(' · ') }),
        controls
      ]),
      details
    ]);
  }

  function groupByLevel(names) {
    const groups = {};
    names.forEach(name => {
      const level = catalog[name] ? catalog[name].level : 0;
      (groups[level] = groups[level] || []).push(name);
    });
    return Object.keys(groups).map(Number).sort((a, b) => a - b).map(level => [level, groups[level].sort()]);
  }

  function renderSource(source) {
    const headerBits = [ABILITY[source.ability] || '', 'Save DC ' + source.saveDc, 'Spell attack ' + signed(source.attackBonus)];
    const choosable = Boolean(source.cantripLimit || source.preparedLimit);
    const counts = [];
    if (source.cantripLimit) counts.push('Cantrips ' + source.chosenCantrips.length + '/' + source.cantripLimit);
    if (source.preparedLimit) counts.push(preparedTitle(source) + ' ' + source.chosenPrepared.length + '/' + source.preparedLimit);
    if (source.kind === 'class') counts.push('up to level ' + source.maxSpellLevel);
    const badges = [];
    if (source.allowance.rework) badges.push('You can change your prepared spells now');
    if (source.allowance.swaps) badges.push(source.allowance.swaps + ' spell replacement' + (source.allowance.swaps > 1 ? 's' : '') + ' available');
    if (source.allowance.cantripSwaps) badges.push(source.allowance.cantripSwaps + ' cantrip replacement available');
    const missing = Math.max(0, (source.cantripLimit || 0) - source.chosenCantrips.length) +
      Math.max(0, (source.preparedLimit || 0) - source.chosenPrepared.length);

    const body = [];
    for (const [level, names] of groupByLevel([...source.cantrips, ...source.prepared])) {
      body.push(el('h5', { text: levelLabel(level) }), ...names.map(name => spellRow(source, name)));
    }
    if (!source.cantrips.length && !source.prepared.length) {
      body.push(el('p', { className: 'muted small', text: 'No spells chosen yet.' }));
    }
    if (source.spellbook) {
      const notPrepared = source.spellbook.map(entry => entry.name).filter(name => !source.prepared.includes(name));
      body.push(el('details', { className: 'spellbook' }, [
        el('summary', { text: 'Spellbook (' + source.spellbook.length + ' spells, ' + source.spellbookFreeLeft + ' free additions left)' }),
        notPrepared.length
          ? el('div', {}, notPrepared.sort().map(name => spellRow(source, name, {
            canCast: Boolean(catalog[name] && catalog[name].ritual), extraTag: 'not prepared'
          })))
          : el('p', { className: 'muted small', text: 'All spellbook spells are prepared.' })
      ]));
    }

    return el('div', { className: 'spell-source' }, [
      el('div', { className: 'spell-source-header' }, [
        el('div', {}, [el('strong', { text: source.label }), el('span', { className: 'muted', text: ' · ' + headerBits.join(' · ') })]),
        choosable ? button(editing === source.key ? 'Close' : 'Choose spells', () => { editing = editing === source.key ? null : source.key; render(); }) : null
      ]),
      counts.length ? el('p', { className: 'muted small', text: counts.join(' · ') + (missing > 0 ? ' — ' + missing + ' still to choose' : '') }) : null,
      source.changeRuleText ? el('p', { className: 'muted small', text: source.changeRuleText }) : null,
      badges.length ? el('div', { className: 'spell-badges' }, badges.map(text => el('span', { className: 'tag gold', text }))) : null,
      editing === source.key ? renderPicker(source) : null,
      ...body
    ]);
  }

  // Checkbox lists for choosing cantrips, prepared spells and spellbook additions.
  function preparedTitle(source) {
    if (source.kind === 'tome') return 'Rituals';
    if (source.kind === 'feat') return source.preparedLimit > 1 ? 'Chosen spells' : 'Chosen spell';
    return 'Prepared spells';
  }

  // What a source's leveled spells must be, in words (feats and Pact of the Tome).
  function filterText(source) {
    const filter = source.filter || {};
    return [
      'level ' + source.minSpellLevel,
      filter.schools ? filter.schools.join(' or ') : null,
      filter.ritual ? 'with the Ritual tag' : null
    ].filter(Boolean).join(', ');
  }

  function renderPicker(source) {
    const filter = source.filter || {};
    const all = Object.values(catalog).filter(spell => source.list === 'any' || spell.classes.includes(source.list));
    const fitsFilter = spell => (!filter.ritual || spell.ritual) && (!filter.schools || filter.schools.includes(spell.school));
    const bookNames = source.spellbook ? source.spellbook.map(entry => entry.name) : null;
    const search = el('input', { type: 'search', placeholder: 'Search spells…', 'aria-label': 'Search spells' });
    const groups = [];

    function group(title, spells, selected, limit) {
      const chosen = new Set(selected);
      const status = el('small', { className: 'muted' });
      const list = el('div', { className: 'spell-pick-list' });
      const inputs = spells.map(spell => {
        const input = el('input', { type: 'checkbox', value: spell.name });
        input.checked = chosen.has(spell.name);
        list.append(el('label', { className: 'creator-check', 'data-name': spell.name.toLowerCase() }, [
          input, el('span', { text: spell.name }),
          el('small', { className: 'muted', text: (spell.level ? 'L' + spell.level : 'C') + (spell.ritual ? ' · R' : '') + (spell.concentration ? ' · C' : '') })
        ]));
        return input;
      });
      const value = () => inputs.filter(input => input.checked).map(input => input.value);
      const refresh = () => {
        const count = value().length;
        inputs.forEach(input => { input.disabled = limit !== null && !input.checked && count >= limit; });
        status.textContent = title + ': ' + count + (limit !== null ? ' / ' + limit : '') + ' selected';
      };
      list.addEventListener('change', refresh);
      refresh();
      groups.push(list);
      return { element: el('div', { className: 'creator-choice' }, [el('h5', { text: title }), status, list]), value };
    }

    const cantrips = source.cantripLimit
      ? group('Cantrips', all.filter(spell => spell.level === 0), source.chosenCantrips, source.cantripLimit)
      : null;
    const preparable = all.filter(spell => spell.level >= (source.minSpellLevel || 1) && spell.level <= source.maxSpellLevel &&
      fitsFilter(spell) && (!bookNames || bookNames.includes(spell.name)));
    const prepared = source.preparedLimit
      ? group(preparedTitle(source), preparable, source.chosenPrepared, source.preparedLimit)
      : null;
    const book = source.spellbook
      ? group('Add to spellbook', all.filter(spell => spell.level >= 1 && spell.level <= source.maxSpellLevel && !bookNames.includes(spell.name)), [], null)
      : null;

    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      groups.forEach(list => list.querySelectorAll('label').forEach(label => {
        label.style.display = !query || label.dataset.name.includes(query) ? '' : 'none';
      }));
    });

    const save = button('Save choices', async () => {
      const body = { action: 'choose', source: source.key };
      if (cantrips) body.cantrips = cantrips.value();
      if (prepared) body.prepared = prepared.value();
      if (book) {
        body.addToSpellbook = book.value();
        const toCopy = body.addToSpellbook.slice(source.spellbookFreeLeft);
        if (toCopy.length) {
          const cost = toCopy.reduce((sum, name) => sum + 50 * catalog[name].level, 0);
          if (!window.confirm('Copying ' + toCopy.join(', ') + ' into your spellbook costs ' + cost + ' GP. Pay it?')) return;
          body.copyAddedSpells = true;
        }
      }
      const ok = await act(body, result => (result.copyCostGp ? 'Saved. Paid ' + result.copyCostGp + ' GP for copying.' : 'Spells saved.'));
      if (ok) { editing = null; render(); }
    }, 'btn btn-small btn-green');

    return el('div', { className: 'spell-picker' }, [
      el('p', { className: 'muted small', text: book
        ? 'Prepared spells come from your spellbook. New spellbook spells are free up to your Wizard level allowance; more must be copied for 50 GP per spell level.'
        : source.list === 'any'
          ? 'Spells from any class spell list (' + filterText(source) + '). Replacing existing choices follows the rule above.'
          : 'Spells from the ' + source.list + ' list. Replacing existing choices follows the rule above.' }),
      search,
      cantrips ? cantrips.element : null,
      book ? book.element : null,
      prepared ? prepared.element : null,
      el('div', { className: 'vitals-actions' }, [save]),
      book ? el('p', { className: 'muted small', text: 'Tip: save new spellbook spells first, then prepare them.' }) : null
    ]);
  }

  // ─── Eldritch Invocations ────────────────────────────────────────────────
  function renderInvocations(inv) {
    const rows = inv.chosen.map((entry, index) => {
      const key = 'invocation|' + index + '|' + entry.name;
      const text = invocationTexts[entry.name];
      return el('div', { className: 'spell-row' }, [
        el('div', { className: 'spell-row-main' }, [
          el('button', {
            type: 'button', className: 'spell-name', 'aria-expanded': String(openDetails.has(key)), text: entry.name,
            onclick: () => { openDetails.has(key) ? openDetails.delete(key) : openDetails.add(key); render(); }
          }),
          el('span', { className: 'muted small', text: [entry.cantrip, entry.feat && entry.feat.name].filter(Boolean).join(' · ') })
        ]),
        openDetails.has(key)
          ? el('div', { className: 'spell-details' }, [
            text && text.prerequisite ? el('p', { className: 'muted small', text: 'Prerequisite: ' + text.prerequisite }) : null,
            text ? renderText(text.description) : el('p', { className: 'muted small', text: 'This invocation is not in the invocations file.' })
          ])
          : null
      ]);
    });
    const missing = inv.limit - inv.chosen.length;
    return el('div', { className: 'spell-source' }, [
      el('div', { className: 'spell-source-header' }, [
        el('div', {}, [el('strong', { text: 'Eldritch Invocations' }), el('span', { className: 'muted', text: ' · ' + inv.chosen.length + '/' + inv.limit + ' known' })]),
        button(editingInvocations ? 'Close' : 'Choose invocations', () => { editingInvocations = !editingInvocations; render(); })
      ]),
      missing > 0 ? el('p', { className: 'muted small', text: missing + ' still to choose' }) : null,
      el('p', { className: 'muted small', text: 'Replace one invocation when you gain a Warlock level.' }),
      inv.allowance.swaps
        ? el('div', { className: 'spell-badges' }, [el('span', { className: 'tag gold', text: inv.allowance.swaps + ' invocation replacement available' })])
        : null,
      editingInvocations ? renderInvocationPicker(inv) : null,
      ...(rows.length ? rows : [el('p', { className: 'muted small', text: 'No invocations chosen yet.' })])
    ]);
  }

  // Origin feat for Lessons of the First Ones, with the choices that feat needs.
  function originFeatPicker(existing) {
    const feats = creationRules ? creationRules.originFeats : {};
    const select = selectOf(Object.keys(feats), '-- Origin feat --');
    if (existing && feats[existing.name]) select.value = existing.name;
    const extra = el('div', { className: 'creator-subchoice' });
    let changed = false;
    let readExtra = () => ({});

    function renderChoices() {
      const origin = feats[select.value];
      const parts = [];
      const getters = {};
      if (origin && existing && select.value === existing.name && !changed) {
        parts.push(el('p', { className: 'muted small' }, ['Keeps your earlier choices. ',
          button('Choose again', () => { changed = true; renderChoices(); })]));
      } else if (origin) {
        const grants = origin.grants || {};
        if (grants.spells) {
          const list = selectOf(origin.spellLists || [], '-- Spell list --');
          const ability = selectOf(['int', 'wis', 'cha'], '-- Spellcasting ability --', { int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' });
          parts.push(field('Spell list', list), field('Spellcasting ability', ability));
          getters.spellList = () => list.value;
          getters.spellAbility = () => ability.value;
        }
        if (grants.toolChoices) {
          const group = checkboxGroup(creationRules.toolCategories[grants.toolChoices.category] || [], grants.toolChoices.count, 'Tools');
          parts.push(group.element);
          getters.picks = group.value;
        }
        if (grants.skillOrToolChoices) {
          const group = checkboxGroup(creationRules.skills.concat(creationRules.toolCategories.any || []), grants.skillOrToolChoices, 'Skills or tools');
          parts.push(group.element);
          getters.picks = group.value;
        }
      }
      extra.replaceChildren(...parts);
      readExtra = () => Object.fromEntries(Object.entries(getters).map(([key, get]) => [key, get()]));
    }
    select.addEventListener('change', renderChoices);
    renderChoices();
    return {
      element: el('div', {}, [field('Origin feat', select), extra]),
      value: () => (select.value ? Object.assign({ name: select.value, changed: changed || !existing || existing.name !== select.value }, readExtra()) : {})
    };
  }

  function renderInvocationPicker(inv) {
    const byName = Object.fromEntries(inv.options.map(option => [option.name, option]));
    const problems = el('p', { className: 'sheet-message', role: 'status' });

    function makeRow(entry) {
      const select = el('select', { 'aria-label': 'Invocation' });
      select.add(new Option('-- Empty --', ''));
      inv.options.forEach(option => {
        const item = new Option(option.name + (option.unavailable ? ' — ' + option.unavailable : ''), option.name);
        item.disabled = Boolean(option.unavailable);
        select.add(item);
      });
      if (entry) select.value = entry.name;
      const extra = el('div', { className: 'creator-subchoice' });
      const row = { select, read: () => null };
      function renderExtra() {
        const option = byName[select.value];
        const same = entry && option && entry.name === option.name;
        let readExtra = () => ({});
        const parts = [];
        if (option && option.cantrip) {
          const cantrip = selectOf(inv.cantripOptions[option.cantrip] || [], '-- Cantrip to improve --');
          if (same && entry.cantrip) cantrip.value = entry.cantrip;
          parts.push(field('Cantrip', cantrip));
          readExtra = () => ({ cantrip: cantrip.value });
        }
        if (option && option.originFeat) {
          const feat = originFeatPicker(same ? entry.feat : null);
          parts.push(feat.element);
          readExtra = () => ({ feat: feat.value() });
        }
        extra.replaceChildren(...parts);
        row.read = () => (select.value ? Object.assign({ name: select.value }, readExtra()) : null);
      }
      select.addEventListener('change', () => { renderExtra(); check(); });
      renderExtra();
      row.element = el('div', { className: 'invocation-pick' }, [select, extra]);
      return row;
    }

    const rows = [];
    for (let index = 0; index < inv.limit; index++) rows.push(makeRow(inv.chosen[index]));

    // Quick checks before saving; the server enforces the same rules.
    function check() {
      const names = rows.map(row => row.select.value).filter(Boolean);
      const issues = [];
      names.forEach(name => {
        const missing = byName[name].requires.filter(required => !names.includes(required));
        if (missing.length) issues.push(name + ' requires ' + missing.join(' and ') + '.');
      });
      [...new Set(names.filter((name, index) => names.indexOf(name) !== index && !byName[name].repeatable))]
        .forEach(name => issues.push(name + ' can only be taken once.'));
      const remaining = [...names];
      let removed = 0;
      inv.chosen.forEach(old => {
        const index = remaining.indexOf(old.name);
        if (index >= 0) remaining.splice(index, 1);
        else removed += 1;
      });
      if (removed > inv.allowance.swaps) {
        issues.push(inv.allowance.swaps
          ? 'You can replace only ' + inv.allowance.swaps + ' invocation(s) now.'
          : 'Existing invocations can only be replaced when you gain a Warlock level.');
      }
      problems.textContent = issues.join(' ');
      problems.classList.toggle('is-error', issues.length > 0);
    }
    check();

    const save = button('Save invocations', async () => {
      const invocations = rows.map(row => row.read()).filter(Boolean);
      const ok = await act({ action: 'invocations', invocations }, () => 'Invocations saved.');
      if (!ok) return;
      // Lessons of the First Ones can add skills, tools or Hit Points shown elsewhere on the sheet.
      if (invocations.some(choice => byName[choice.name].originFeat)) { window.location.reload(); return; }
      editingInvocations = false;
      render();
    }, 'btn btn-small btn-green');

    return el('div', { className: 'spell-picker' }, [
      el('p', { className: 'muted small', text: 'Choose up to ' + inv.limit + ' invocations. Options you do not qualify for are disabled.' }),
      ...rows.map(row => row.element),
      problems,
      el('div', { className: 'vitals-actions' }, [save])
    ]);
  }

  function render() {
    if (!view) return;
    root.hidden = view.sources.length === 0 && !view.invocations;
    if (root.hidden) return;
    const classSources = view.sources.filter(source => source.kind === 'class');
    const otherSources = view.sources.filter(source => source.kind !== 'class');
    root.replaceChildren(...[
      el('h4', { text: 'Spellcasting' }),
      view.concentration
        ? el('div', { className: 'spell-concentration' }, [
          el('span', {}, ['Concentrating on ', el('strong', { text: view.concentration.spell })]),
          button('End concentration', () => act({ action: 'endConcentration' }, () => 'Concentration ended.'))
        ])
        : null,
      ...classSources.map(renderSource),
      view.invocations ? renderInvocations(view.invocations) : null,
      ...otherSources.map(renderSource),
      el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', 'aria-live': 'polite', text: message })
    ].filter(Boolean));
  }

  // Invocation texts and origin feat data, needed only by Warlocks.
  async function loadInvocationData() {
    const [texts, creation] = await Promise.all([
      fetch('/api/rules/invocations').then(r => (r.ok ? r.json() : { invocations: [] })),
      fetch('/api/rules/creation').then(r => (r.ok ? r.json() : null))
    ]);
    invocationTexts = Object.fromEntries((texts.invocations || []).map(entry => [entry.name, entry]));
    creationRules = creation;
  }

  async function load() {
    try {
      const [spellsView, catalogResult] = await Promise.all([
        request('GET'),
        Object.keys(catalog).length ? Promise.resolve(null) : fetch('/api/rules/spells').then(r => r.json())
      ]);
      if (catalogResult) catalog = Object.fromEntries(catalogResult.spells.map(spell => [spell.name, spell]));
      if (spellsView.invocations && !creationRules) await loadInvocationData();
      view = spellsView;
      render();
    } catch (error) {
      root.hidden = false;
      root.replaceChildren(el('p', { className: 'alert red', text: error.message }));
    }
  }

  window.refreshCharacterSpells = load;
  load();
})();
