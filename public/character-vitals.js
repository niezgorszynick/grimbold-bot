// public/character-vitals.js — Hit Points, rests, death saves, exhaustion and
// spell slots on the character sheet. All changes go through
// POST /api/characters/:id/vitals; the server applies the rules and rolls dice.

(function () {
  const root = document.getElementById('cs_vitals');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);

  const EVENT_MESSAGES = {
    droppedToZero: 'Dropped to 0 Hit Points: unconscious and dying.',
    instantDeath: 'Massive damage: the character dies outright. Ask the DM to record the death.',
    dead: 'The character has died. Ask the DM to record the death.',
    revived: 'Back on their feet.',
    stabilized: 'Stable at 0 Hit Points.',
    deathSaveSucceeded: 'Death save succeeded.',
    deathSaveFailed: 'Death save failed.',
    shortRest: 'Short Rest finished.',
    longRest: 'Long Rest finished: HP, Hit Point Dice and spell slots restored.',
    wildShapeEnded: 'Your Wild Shape ended.',
    starryFormEnded: 'Your Starry Form ended.',
    cosmicOmenWeal: 'Cosmic Omen: Weal (even) until your next Long Rest: add 1d6 to a D20 Test.',
    cosmicOmenWoe: 'Cosmic Omen: Woe (odd) until your next Long Rest: subtract 1d6 from a D20 Test.'
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

  const button = (text, onclick, className = 'btn btn-small', extra = {}) =>
    el('button', Object.assign({ type: 'button', className, text, onclick }, extra));

  let vitals = null;
  let busy = false;
  let lastMessage = '';
  let lastIsError = false;
  let editingHp = false;

  async function send(action, params) {
    if (busy) return;
    // Which card reports the outcome.
    lastArea = RESOURCE_ACTIONS.includes(action) ? 'resources' : 'hp';
    busy = true;
    root.classList.add('is-busy');
    try {
      const response = await fetch('/api/characters/' + characterId + '/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ action }, params))
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update hit points.');
      vitals = result.vitals;
      const parts = [];
      if (result.rolls && result.rolls.length) {
        parts.push('Rolled ' + result.rolls.map(r => r.die + ': ' + r.roll + (r.bonus === undefined ? '' : ' + ' + r.bonus)).join(', ') +
          (result.healed !== undefined ? ' → healed ' + result.healed + ' HP.' : '.'));
      }
      (result.events || []).forEach(event => parts.push(EVENT_MESSAGES[event] || effectMessage(event)));
      if (result.concentration) {
        parts.push(result.concentration.ended
          ? 'Concentration on ' + result.concentration.spell + ' ended.'
          : 'Concentration save for ' + result.concentration.spell + ': DC ' + result.concentration.dc + (' (roll it under Spellcasting).'));
      }
      (result.magicItemsRegained || []).forEach(item => {
        parts.push(item.name + ' regained ' + item.restored + ' charge' + (item.restored === 1 ? '' : 's') + ' (' + item.roll + ').');
      });
      lastMessage = parts.filter(Boolean).join(' ');
      // Rests restore slots and spell-change windows; damage can end concentration.
      if (window.refreshCharacterSpells) window.refreshCharacterSpells();
      // A Long Rest is the dawn when magic items regain charges.
      if (window.refreshCharacterMagicItems) window.refreshCharacterMagicItems();
      // Rage and Sacred Weapon change the attacks.
      if (window.refreshCharacterCombat && (result.events || []).some(event => /^effect/.test(event))) window.refreshCharacterCombat();
      lastIsError = false;
    } catch (error) {
      lastMessage = error.message;
      lastIsError = true;
    } finally {
      busy = false;
      root.classList.remove('is-busy');
      render();
    }
  }

  // "effectStarted:rage" → "Rage is on: the attacks include it."
  const RESOURCE_ACTIONS = ['shortRest', 'longRest', 'setHitDice', 'useResource', 'restoreResource', 'secondWind', 'spendSlot', 'restoreSlot', 'startEffect', 'endEffect'];
  let lastArea = 'hp';
  // Damage / heal / temp HP behind "± HP"; remembered in this browser.
  let hpActionsOpen = (() => { try { return localStorage.getItem('grimbold.hpActions') !== 'closed'; } catch { return true; } })();
  function rememberHpActions() {
    try { localStorage.setItem('grimbold.hpActions', hpActionsOpen ? 'open' : 'closed'); } catch { /* private window */ }
  }

  function effectMessage(event) {
    const match = /^effect(Started|Ended):(\w+)$/.exec(event);
    if (!match) return '';
    const effect = (vitals.effects || []).find(entry => entry.key === match[2]);
    const name = effect ? effect.name : match[2];
    return match[1] === 'Started' ? name + ' is on: the attacks include it.' : name + ' ended.';
  }

  function amountInput() {
    return el('input', { type: 'number', min: '0', max: '10000', inputmode: 'numeric', 'aria-label': 'Amount', placeholder: 'Amount' });
  }

  function readAmount(input) {
    const value = Number(input.value);
    if (!Number.isInteger(value) || value <= 0) {
      lastMessage = 'Enter a positive whole number first.';
      lastIsError = true;
      render();
      return null;
    }
    return value;
  }

  // Clicking the HP numbers opens this: set current and max HP directly
  // (e.g. the Aid spell raises both). Max is stored as an adjustment to the rules value.
  function renderHpEditor() {
    const current = el('input', { type: 'number', min: '0', max: '5000', value: String(vitals.hpCurrent), 'aria-label': 'Current HP' });
    const max = el('input', { type: 'number', min: '1', max: '5000', value: String(vitals.hpMax), 'aria-label': 'Max HP' });
    // Raising the maximum raises current HP too, unless current was typed in.
    let currentTouched = false;
    let lastMax = vitals.hpMax;
    current.addEventListener('input', () => { currentTouched = true; });
    max.addEventListener('input', () => {
      const value = Number(max.value);
      if (!currentTouched && Number.isInteger(value)) current.value = String(Math.max(0, Number(current.value) + value - lastMax));
      if (Number.isInteger(value)) lastMax = value;
    });
    const save = () => {
      const currentValue = Number(current.value);
      const maxValue = Number(max.value);
      if (!Number.isInteger(currentValue) || !Number.isInteger(maxValue) || currentValue < 0 || maxValue < 1) {
        lastMessage = 'Enter whole numbers: current HP 0 or more, max HP 1 or more.';
        lastIsError = true;
        render();
        return;
      }
      editingHp = false;
      send('setHp', { current: currentValue, max: maxValue });
    };
    [current, max].forEach(input => input.addEventListener('keydown', event => {
      if (event.key === 'Enter') save();
      if (event.key === 'Escape') { editingHp = false; render(); }
    }));
    setTimeout(() => current.focus(), 0);
    return el('div', { className: 'vitals-hp-numbers vitals-hp-editor' }, [
      current,
      el('span', { className: 'muted', text: ' / ' }),
      max,
      el('span', { className: 'muted', text: ' HP ' }),
      button('Save', save, 'btn btn-small btn-green'),
      button('Cancel', () => { editingHp = false; render(); }, 'btn btn-small btn-secondary'),
      // Rules maximum again: no adjustments, no temporary HP.
      vitals.hpMaxBonus || vitals.hpTemp
        ? button('Reset to ' + (vitals.hpMax - vitals.hpMaxBonus) + ' max', () => {
          editingHp = false;
          send('resetHp');
        }, 'btn btn-small btn-gold', { title: 'Remove HP adjustments (e.g. Aid) and temporary HP; current HP only drops if above the new max.' })
        : null
    ]);
  }

  function renderHitPoints() {
    const percent = Math.round((vitals.hpCurrent / vitals.hpMax) * 100);
    const state = vitals.hpCurrent === 0 ? 'is-down' : percent <= 50 ? 'is-bloodied' : '';
    const b = vitals.hpBreakdown;
    const breakdown = [
      b.fromHitDice + ' from Hit Dice',
      (b.fromConstitution >= 0 ? '+' : '') + b.fromConstitution + ' CON',
      b.fromSpecies ? '+' + b.fromSpecies + ' species' : null,
      b.fromFeats ? '+' + b.fromFeats + ' feats' : null,
      b.fromSubclass ? '+' + b.fromSubclass + ' subclass' : null,
      vitals.hpMaxBonus ? (vitals.hpMaxBonus > 0 ? '+' : '') + vitals.hpMaxBonus + ' adjustment' : null
    ].filter(Boolean).join(' ');

    const amount = amountInput();
    const critical = el('input', { type: 'checkbox' });

    return el('div', { className: 'vitals-hp ' + state }, [
      el('div', { className: 'vitals-hp-top' }, [
      editingHp
        ? renderHpEditor()
        : el('button', {
          type: 'button',
          className: 'vitals-hp-numbers vitals-hp-edit',
          title: 'Max HP: ' + breakdown + '.\nClick to set current and max HP (e.g. Aid).',
          onclick: () => { editingHp = true; render(); }
        }, [
          el('strong', { className: 'vitals-hp-current', text: String(vitals.hpCurrent) }),
          el('span', { className: 'muted', text: ' / ' + vitals.hpMax + ' HP' }),
          vitals.hpTemp ? el('span', { className: 'vitals-temp', text: '+' + vitals.hpTemp + ' temp' }) : null,
          el('span', { className: 'vitals-hp-pencil', 'aria-hidden': 'true', text: '✎' })
        ]),
        button(hpActionsOpen ? '× Close' : '± HP', () => { hpActionsOpen = !hpActionsOpen; rememberHpActions(); render(); },
          'btn btn-small ' + (hpActionsOpen ? 'btn-secondary' : ''), { title: 'Damage, healing and temporary HP', 'aria-expanded': String(hpActionsOpen) })
      ]),
      el('div', { className: 'vitals-bar', role: 'presentation' }, el('span', { style: 'width:' + Math.max(0, Math.min(100, percent)) + '%' })),
      hpActionsOpen ? el('div', { className: 'vitals-actions' }, [
        amount,
        button('Damage', () => { const v = readAmount(amount); if (v !== null) send('damage', { amount: v, critical: critical.checked }); }, 'btn btn-small btn-red'),
        button('Heal', () => { const v = readAmount(amount); if (v !== null) send('heal', { amount: v }); }, 'btn btn-small btn-green'),
        button('Set Temp HP', () => { const v = readAmount(amount); if (v !== null) send('tempHp', { amount: v }); }),
        vitals.hpTemp ? button('Clear Temp', () => send('clearTempHp')) : null,
        el('label', { className: 'vitals-inline' }, [critical, ' Critical hit'])
      ]) : null
    ]);
  }

  function pips(count, filled, className) {
    return el('span', { className: 'vitals-pips ' + className },
      Array.from({ length: count }, (_, i) => el('span', { className: 'vitals-pip' + (i < filled ? ' is-filled' : '') })));
  }

  function renderDying() {
    if (vitals.hpCurrent > 0) return null;
    if (vitals.stable) {
      return el('div', { className: 'vitals-dying is-stable' }, [
        el('strong', { text: 'Stable' }),
        el('span', { className: 'muted', text: ' — unconscious at 0 HP; regains 1 HP after 1d4 hours, or when healed.' })
      ]);
    }
    return el('div', { className: 'vitals-dying' }, [
      el('strong', { text: 'Dying' }),
      el('div', { className: 'vitals-saves' }, [
        el('span', { text: 'Successes ' }), pips(3, vitals.deathSaves.successes, 'is-success'),
        el('span', { text: ' Failures ' }), pips(3, vitals.deathSaves.failures, 'is-failure')
      ]),
      el('div', { className: 'vitals-actions' }, [
        button('Roll Death Save', () => send('deathSave')),
        button('Stabilize', () => send('stabilize'))
      ])
    ]);
  }

  // The Hit Point Die whose "left" count is being set by hand (its die), or null.
  let editingHitDie = null;

  function renderRests() {
    const spendInputs = {};
    const rows = vitals.hitDice.map(entry => {
      const remaining = entry.total - entry.spent;
      if (editingHitDie === entry.die) {
        const left = el('input', { type: 'number', min: '0', max: String(entry.total), value: String(remaining), 'aria-label': entry.die + ' Hit Point Dice left' });
        const save = () => {
          const value = Number(left.value);
          editingHitDie = null;
          send('setHitDice', { die: entry.die, remaining: value });
        };
        left.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); save(); } });
        return el('div', { className: 'vitals-hitdie' }, [
          el('strong', { text: entry.die }),
          el('label', { className: 'vitals-inline' }, [left, ' / ' + entry.total + ' left']),
          button('Save', save),
          button('Cancel', () => { editingHitDie = null; render(); })
        ]);
      }
      const input = el('input', { type: 'number', min: '0', max: String(remaining), value: '0', 'aria-label': 'Spend ' + entry.die });
      input.disabled = remaining === 0;
      spendInputs[entry.die] = input;
      return el('div', { className: 'vitals-hitdie' }, [
        el('strong', { text: entry.die }),
        // Click to set how many are left (spent outside a rest, or put back); no healing.
        el('button', {
          type: 'button', className: 'link-button vitals-hitdie-count', text: remaining + ' / ' + entry.total + ' left',
          title: 'Change how many ' + entry.die + ' Hit Point Dice are left (no healing)',
          onclick: () => { editingHitDie = entry.die; render(); }
        }),
        el('label', { className: 'vitals-inline' }, ['Spend ', input])
      ]);
    });
    return el('div', { className: 'vitals-rests' }, [
      el('h5', { text: 'Hit Point Dice & Rests' }),
      el('p', { className: 'muted small sheet-help', text: 'Each die spent restores its roll ' + (vitals.conModifier >= 0 ? '+ ' : '− ') + Math.abs(vitals.conModifier) + ' (CON), minimum 1.' }),
      ...rows,
      el('div', { className: 'vitals-actions' }, [
        button('Short Rest', () => {
          const hitDice = Object.fromEntries(Object.entries(spendInputs).map(([die, input]) => [die, Number(input.value) || 0]));
          send('shortRest', { hitDice });
        }),
        button('Long Rest', () => {
          if (window.confirm('Finish a Long Rest? This restores HP, all Hit Point Dice, spell slots and class feature uses.')) send('longRest');
        })
      ])
    ]);
  }

  // Heroic Inspiration (2024 rules): the tile next to Proficiency Bonus, kept in
  // step with the vitals. Ticking saves at once; ⓘ shows the rule (no hover on tablets).
  const inspirationBox = document.getElementById('cs_inspiration');
  const inspirationInfo = document.getElementById('cs_inspiration_info');
  const inspirationText = document.getElementById('cs_inspiration_text');
  if (inspirationBox) inspirationBox.addEventListener('change', () => send('inspiration', { on: inspirationBox.checked }));
  if (inspirationInfo && inspirationText) {
    inspirationInfo.addEventListener('click', event => {
      event.preventDefault(); // inside the label: don't tick the box
      inspirationText.hidden = !inspirationText.hidden;
      inspirationInfo.setAttribute('aria-expanded', String(!inspirationText.hidden));
    });
  }
  function syncInspiration() {
    if (!inspirationBox) return;
    inspirationBox.disabled = false;
    inspirationBox.checked = Boolean(vitals.heroicInspiration);
    inspirationBox.closest('.sheet-inspiration').classList.toggle('is-inspired', inspirationBox.checked);
    if (inspirationText) inspirationText.dataset.resourceful = vitals.resourceful ? '1' : '';
  }

  function renderExhaustion() {
    const select = el('select', { 'aria-label': 'Exhaustion level' });
    for (let level = 0; level <= 6; level += 1) {
      select.add(new Option(level === 0 ? 'None' : level === 6 ? '6 (death)' : String(level), String(level)));
    }
    select.value = String(vitals.exhaustion);
    select.addEventListener('change', () => send('exhaustion', { level: Number(select.value) }));
    const effect = vitals.exhaustion
      ? '−' + 2 * vitals.exhaustion + ' to d20 Tests, −' + 5 * vitals.exhaustion + ' ft. Speed.'
      : 'No penalties.';
    return el('div', { className: 'vitals-exhaustion' }, [
      el('label', { className: 'vitals-inline' }, ['Exhaustion ', select]),
      el('span', { className: 'muted small', text: effect })
    ]);
  }

  function slotRow(label, total, spent, level) {
    const boxes = Array.from({ length: total }, (_, i) => {
      const box = el('input', { type: 'checkbox', 'aria-label': label + ' slot ' + (i + 1) });
      box.checked = i < spent;
      box.addEventListener('change', () => send(box.checked ? 'spendSlot' : 'restoreSlot', { level }));
      return box;
    });
    return el('div', { className: 'vitals-slot-row' }, [
      el('span', { className: 'vitals-slot-label', text: label }),
      el('span', { className: 'vitals-slot-boxes' }, boxes),
      el('span', { className: 'muted small', text: (total - spent) + ' left' })
    ]);
  }

  // Limited-use class features: Channel Divinity, Rage, Second Wind, ...
  const RECOVERY_TEXT = {
    short: 'Back on a Short or Long Rest',
    shortOne: 'One back on a Short Rest, all on a Long Rest',
    long: 'Back on a Long Rest'
  };
  function renderResources() {
    if (!vitals.resources || !vitals.resources.length) return null;
    const rows = vitals.resources.map(resource => {
      const left = resource.max - resource.used;
      let control;
      // Dice of the feature (Infernal Wound, Hellfire Orb, Soul Siphon, ...).
      const rolls = (resource.rolls || []).length
        ? el('p', { className: 'small vitals-resource-rolls' }, resource.rolls.flatMap((roll, index) => [
          index ? ' · ' : '',
          el('button', { type: 'button', className: 'roll-link', 'data-roll': 'resource:' + resource.key + ':' + roll.key, title: 'Roll ' + roll.label, text: roll.label + ' ' + roll.formula })
        ]))
        : null;
      if (!resource.max) {
        // No uses to count: only what it does, and its dice.
        return el('div', { className: 'vitals-resource' }, [
          el('div', { className: 'vitals-slot-row' }, [el('span', { className: 'vitals-slot-label' }, [el('strong', { text: resource.name })])]),
          el('p', { className: 'muted small vitals-resource-text sheet-help', text: resource.text }),
          rolls
        ]);
      }
      if (resource.pool) {
        const amount = el('input', { type: 'number', min: '1', max: String(resource.max), value: '1', 'aria-label': resource.name + ' amount' });
        const read = () => Number(amount.value) || 1;
        control = el('span', { className: 'vitals-inline' }, [
          amount,
          button('Use', () => send('useResource', { key: resource.key, amount: read() }), 'btn btn-small', { disabled: left === 0 ? true : null }),
          button('Restore', () => send('restoreResource', { key: resource.key, amount: read() }), 'btn btn-small btn-secondary', { disabled: resource.used === 0 ? true : null })
        ]);
      } else {
        control = el('span', { className: 'vitals-slot-boxes' }, Array.from({ length: resource.max }, (_, i) => {
          const box = el('input', { type: 'checkbox', 'aria-label': resource.name + ' use ' + (i + 1) });
          box.checked = i < resource.used;
          box.addEventListener('change', () => send(box.checked ? 'useResource' : 'restoreResource', { key: resource.key }));
          return box;
        }));
      }
      // Rage, Sacred Weapon: Start spends a use and turns the bonus on.
      const effects = (vitals.effects || []).filter(effect => effect.resource === resource.key).map(effect => el('p', {
        className: 'small vitals-effect' + (effect.active ? ' is-active' : '')
      }, effect.active
        ? [el('strong', { text: '✨ ' + effect.name + ' is on. ' }), button('End', () => send('endEffect', { effect: effect.key }), 'btn btn-small btn-secondary')]
        : [button('Start ' + effect.name, () => send('startEffect', { effect: effect.key }), 'btn btn-small', {
          disabled: left === 0 ? true : null, title: effect.text + ' Spends one use; ends with End, a rest or 0 HP.'
        })]));
      // Second Wind heals; a plain tick spends a use without healing (Tactical Mind).
      const secondWind = resource.key === 'secondWind'
        ? el('p', { className: 'small vitals-effect' }, [button('Heal (Second Wind)', () => send('secondWind'), 'btn btn-small', {
          disabled: left === 0 || vitals.hpCurrent === 0 ? true : null, title: resource.text + ' Spends one use.'
        })])
        : null;
      return el('div', { className: 'vitals-resource' }, [
        el('div', { className: 'vitals-slot-row' }, [
          el('span', { className: 'vitals-slot-label' }, [el('strong', { text: resource.name })]),
          control,
          el('span', { className: 'muted small', text: left + ' / ' + resource.max + ' left' })
        ]),
        el('p', { className: 'muted small vitals-resource-text sheet-help', text: resource.text + ' ' + RECOVERY_TEXT[resource.recovery] + '.' }),
        secondWind,
        ...effects,
        rolls
      ]);
    });
    return el('div', { className: 'vitals-slots vitals-resources' }, [
      el('h5', { text: 'Class Features' }),
      el('p', { className: 'muted small sheet-help', text: 'Tick a box to spend a use; rests bring them back.' }),
      ...rows
    ]);
  }

  function renderSlots() {
    const rows = vitals.spellSlots.map(slot => slotRow('Level ' + slot.level, slot.total, slot.spent, slot.level));
    if (vitals.pact) rows.push(slotRow('Pact (level ' + vitals.pact.slotLevel + ')', vitals.pact.count, vitals.pact.spent, 'pact'));
    if (!rows.length) return null;
    return el('div', { className: 'vitals-slots' }, [
      el('h5', { text: 'Spell Slots' }),
      el('p', { className: 'muted small sheet-help', text: 'Tick a box to spend a slot. Pact Magic slots return on a Short Rest; all slots return on a Long Rest.' }),
      ...rows
    ]);
  }

  // Resistances, immunities, senses, creature type, save Advantages.
  const DEFENSE_LABELS = [
    ['type', 'Creature type'], ['resistance', 'Resistances'], ['immunity', 'Immunities'], ['condition', 'Condition immunities'],
    ['sense', 'Senses'], ['advantage', 'Advantage on'], ['note', 'Also']
  ];
  function renderDefenses() {
    const defenses = vitals.defenses || [];
    if (!defenses.length) return null;
    const rows = DEFENSE_LABELS.map(([kind, label]) => {
      const items = defenses.filter(item => item.kind === kind);
      if (!items.length) return null;
      return el('p', { className: 'small vitals-defense-row' }, [
        el('strong', { text: label + ': ' }),
        ...items.flatMap((item, index) => [
          index ? ', ' : '',
          el('span', { className: item.when && !item.active ? 'muted' : '', title: item.source, text: item.text + (item.when ? ' (' + item.when + (item.active ? ', now' : '') + ')' : '') })
        ])
      ]);
    }).filter(Boolean);
    return el('div', { className: 'vitals-defenses' }, [el('h5', { text: 'Defenses' }), ...rows]);
  }
  // In the Senses strip: one line, without the senses (the strip lists them).
  function renderDefensesInline() {
    const defenses = (vitals.defenses || []).filter(item => item.kind !== 'sense');
    if (!defenses.length) return null;
    const SHORT = { type: '', resistance: 'Resist', immunity: 'Immune', condition: 'Immune', advantage: 'Advantage on', note: '' };
    return el('p', { className: 'small sheet-defenses-inline' }, DEFENSE_LABELS.filter(([kind]) => kind !== 'sense').flatMap(([kind]) => {
      const items = defenses.filter(item => item.kind === kind);
      if (!items.length) return [];
      return [el('span', { className: 'sheet-defense' }, [
        SHORT[kind] ? el('strong', { text: SHORT[kind] + ' ' }) : null,
        ...items.flatMap((item, index) => [index ? ', ' : '', el('span', {
          className: item.when && !item.active ? 'muted' : '', title: item.source,
          text: item.text + (item.when ? ' (' + item.when + (item.active ? ', now' : '') + ')' : '')
        })])
      ])];
    }));
  }

  // Buff spells on this character, from themselves or a party member.
  function renderSpellEffects() {
    const list = vitals.spellEffects || [];
    if (!list.length) return null;
    return el('div', { className: 'vitals-spell-effects' }, [
      el('h5', { text: 'Spells on you' }),
      ...list.map(effect => el('div', { className: 'vitals-spell-effect' }, [
        el('strong', { text: '✨ ' + effect.spell }),
        el('span', { className: 'muted small', text: 'from ' + effect.casterName + (effect.concentration ? ' (Concentration)' : '') + '. ' + effect.text }),
        button('End', () => endSpellEffect(effect), 'btn btn-small btn-secondary')
      ]))
    ]);
  }

  async function endSpellEffect(effect) {
    try {
      const response = await fetch('/api/characters/' + characterId + '/spell-effects/end', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effectId: effect.id })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not end the spell.');
      vitals = Object.assign({}, vitals, { spellEffects: result.spellEffects });
      lastMessage = effect.spell + ' ended.';
      lastIsError = false;
      if (window.refreshCharacterCombat) window.refreshCharacterCombat();
    } catch (error) {
      lastMessage = error.message;
      lastIsError = true;
    }
    render();
  }

  function render() {
    if (!vitals) return;
    syncInspiration();
    // Optional sections return null; replaceChildren would render that as text.
    const message = area => (lastArea === area && lastMessage
      ? el('p', { className: 'sheet-message' + (lastIsError ? ' is-error' : ''), role: 'status', text: lastMessage })
      : null);
    // Hit points, rests and uses: two cards when the sheet has a Resources card.
    const resourcesRoot = document.getElementById('cs_resources_body');
    const defensesRoot = document.getElementById('cs_defenses');
    const resources = [renderRests(), renderResources(), renderSlots()];
    root.replaceChildren(...[
      renderHitPoints(),
      renderDying(),
      renderExhaustion(),
      defensesRoot ? null : renderDefenses(),
      renderSpellEffects(),
      ...(resourcesRoot ? [] : resources),
      message(resourcesRoot ? 'hp' : lastArea)
    ].filter(Boolean));
    if (resourcesRoot) resourcesRoot.replaceChildren(...[...resources, message('resources')].filter(Boolean));
    if (defensesRoot) defensesRoot.replaceChildren(...[renderDefensesInline()].filter(Boolean));
  }

  async function load() {
    try {
      const response = await fetch('/api/characters/' + characterId);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load hit points.');
      if (!result.vitals) {
        root.textContent = 'Hit points cannot be calculated: this character has no valid class levels.';
        return;
      }
      vitals = result.vitals;
      render();
    } catch (error) {
      root.textContent = error.message;
    }
  }

  window.refreshCharacterVitals = load;
  load();
})();
