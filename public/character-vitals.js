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
    longRest: 'Long Rest finished: HP, Hit Point Dice and spell slots restored.'
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

  const button = (text, onclick, className = 'btn btn-small') =>
    el('button', { type: 'button', className, text, onclick });

  let vitals = null;
  let busy = false;
  let lastMessage = '';
  let lastIsError = false;

  async function send(action, params) {
    if (busy) return;
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
        parts.push('Rolled ' + result.rolls.map(r => r.die + ': ' + r.roll).join(', ') +
          (result.healed !== undefined ? ' → healed ' + result.healed + ' HP.' : '.'));
      }
      (result.events || []).forEach(event => parts.push(EVENT_MESSAGES[event] || ''));
      if (result.concentration) {
        parts.push(result.concentration.ended
          ? 'Concentration on ' + result.concentration.spell + ' ended.'
          : 'Concentration check for ' + result.concentration.spell + ': Constitution save DC ' + result.concentration.dc + '.');
      }
      lastMessage = parts.filter(Boolean).join(' ');
      // Rests restore slots and spell-change windows; damage can end concentration.
      if (window.refreshCharacterSpells) window.refreshCharacterSpells();
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
    const bonusInput = el('input', { type: 'number', min: '-1000', max: '1000', value: String(vitals.hpMaxBonus), 'aria-label': 'Max HP adjustment' });

    return el('div', { className: 'vitals-hp ' + state }, [
      el('div', { className: 'vitals-hp-numbers' }, [
        el('strong', { className: 'vitals-hp-current', text: String(vitals.hpCurrent) }),
        el('span', { className: 'muted', text: ' / ' + vitals.hpMax + ' HP' }),
        vitals.hpTemp ? el('span', { className: 'vitals-temp', text: '+' + vitals.hpTemp + ' temp' }) : null
      ]),
      el('div', { className: 'vitals-bar', role: 'presentation' }, el('span', { style: 'width:' + Math.max(0, Math.min(100, percent)) + '%' })),
      el('div', { className: 'vitals-actions' }, [
        amount,
        button('Damage', () => { const v = readAmount(amount); if (v !== null) send('damage', { amount: v, critical: critical.checked }); }, 'btn btn-small btn-red'),
        button('Heal', () => { const v = readAmount(amount); if (v !== null) send('heal', { amount: v }); }, 'btn btn-small btn-green'),
        button('Set Temp HP', () => { const v = readAmount(amount); if (v !== null) send('tempHp', { amount: v }); }),
        vitals.hpTemp ? button('Clear Temp', () => send('clearTempHp')) : null,
        el('label', { className: 'vitals-inline' }, [critical, ' Critical hit'])
      ]),
      el('details', { className: 'vitals-breakdown' }, [
        el('summary', { text: 'Max HP: ' + breakdown }),
        el('p', { className: 'muted small', text: 'Max HP follows the average-HP rule and updates with level and Constitution. Use an adjustment for effects such as the Aid spell.' }),
        el('div', { className: 'vitals-actions' }, [
          bonusInput,
          button('Set adjustment', () => {
            const value = Number(bonusInput.value);
            if (Number.isInteger(value)) send('maxHpBonus', { bonus: value });
          })
        ])
      ])
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

  function renderRests() {
    const spendInputs = {};
    const rows = vitals.hitDice.map(entry => {
      const remaining = entry.total - entry.spent;
      const input = el('input', { type: 'number', min: '0', max: String(remaining), value: '0', 'aria-label': 'Spend ' + entry.die });
      input.disabled = remaining === 0;
      spendInputs[entry.die] = input;
      return el('div', { className: 'vitals-hitdie' }, [
        el('strong', { text: entry.die }),
        el('span', { className: 'muted', text: remaining + ' / ' + entry.total + ' left' }),
        el('label', { className: 'vitals-inline' }, ['Spend ', input])
      ]);
    });
    return el('div', { className: 'vitals-rests' }, [
      el('h5', { text: 'Hit Point Dice & Rests' }),
      el('p', { className: 'muted small', text: 'Each die spent restores its roll ' + (vitals.conModifier >= 0 ? '+ ' : '− ') + Math.abs(vitals.conModifier) + ' (CON), minimum 1.' }),
      ...rows,
      el('div', { className: 'vitals-actions' }, [
        button('Short Rest', () => {
          const hitDice = Object.fromEntries(Object.entries(spendInputs).map(([die, input]) => [die, Number(input.value) || 0]));
          send('shortRest', { hitDice });
        }),
        button('Long Rest', () => {
          if (window.confirm('Finish a Long Rest? This restores HP, all Hit Point Dice and spell slots.')) send('longRest');
        })
      ])
    ]);
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

  function renderSlots() {
    const rows = vitals.spellSlots.map(slot => slotRow('Level ' + slot.level, slot.total, slot.spent, slot.level));
    if (vitals.pact) rows.push(slotRow('Pact (level ' + vitals.pact.slotLevel + ')', vitals.pact.count, vitals.pact.spent, 'pact'));
    if (!rows.length) return null;
    return el('div', { className: 'vitals-slots' }, [
      el('h5', { text: 'Spell Slots' }),
      el('p', { className: 'muted small', text: 'Tick a box to spend a slot. Pact Magic slots return on a Short Rest; all slots return on a Long Rest.' }),
      ...rows
    ]);
  }

  function render() {
    if (!vitals) return;
    // Optional sections return null; replaceChildren would render that as text.
    root.replaceChildren(...[
      renderHitPoints(),
      renderDying(),
      renderExhaustion(),
      renderRests(),
      renderSlots(),
      el('p', { className: 'sheet-message' + (lastIsError ? ' is-error' : ''), role: 'status', text: lastMessage })
    ].filter(Boolean));
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
