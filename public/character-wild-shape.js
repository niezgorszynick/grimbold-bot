// public/character-wild-shape.js — "Wild Shape" card on a druid's sheet: the
// beast forms learned (up to the druid's limit), Transform / Revert, and the
// combined stat block of each form. In a form, the stat block's numbers roll
// (public/dice.js); the server rolls STR, DEX and CON for the beast then.
// Circle of the Stars druids also get Starry Form (Archer, Chalice, Dragon)
// and their Cosmic Omen here.

(function () {
  const root = document.getElementById('cs_wild_shape');
  const body = document.getElementById('cs_wild_shape_body');
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

  let view = null;
  let message = '';
  let isError = false;
  const open = new Set();

  async function request(url, method, payload) {
    const response = await fetch(url, {
      method,
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
  }

  async function act(run, success) {
    try {
      await run();
      message = success;
      isError = false;
    } catch (error) {
      message = error.message;
      isError = true;
    }
    await load();
    // HP, uses and attacks changed elsewhere on the sheet too.
    if (window.refreshCharacterVitals) window.refreshCharacterVitals();
  }

  const vitals = payload => request('/api/characters/' + characterId + '/vitals', 'POST', payload);
  const forms = payload => request('/api/characters/' + characterId + '/wild-shape', 'POST', payload);

  // A number that rolls while in this form; plain text otherwise.
  const roller = live => (id, text, title) => (live
    ? el('button', { type: 'button', className: 'roll-link', 'data-roll': id, title, text })
    : el('span', { text }));

  function featureList(title, features, block, live) {
    if (!features || !features.length) return null;
    const roll = roller(live);
    return el('div', { className: 'beast-features' }, [
      el('h6', { text: title }),
      ...features.map(feature => {
        const attackIndex = block.attacks.findIndex(attack => attack.name === feature.name);
        const attack = attackIndex >= 0 ? block.attacks[attackIndex] : null;
        const rolls = attack ? el('span', { className: 'beast-rolls' }, [
          roll('beast:' + attackIndex + ':hit', signed(attack.attackBonus) + ' to hit', 'Roll to hit'), ' · ',
          roll('beast:' + attackIndex + ':damage', attack.damage.formula + ' ' + attack.damage.type, 'Roll damage'),
          ...attack.damage.others.flatMap((other, index) => [' · ', roll('beast:' + attackIndex + ':other:' + index,
            (other.kind === 'or' ? 'or ' : '+ ') + other.formula + ' ' + other.type, other.kind === 'or' ? 'Roll the other damage' : 'Roll the extra damage')])
        ]) : null;
        return el('p', {}, [el('strong', { text: feature.name + '. ' }), rolls, rolls ? el('br') : null, el('span', { className: 'muted small', text: feature.text })]);
      })
    ]);
  }

  function statBlock(block, live) {
    const roll = roller(live);
    const skills = block.proficientSkills.map((skill, index) => [index ? ', ' : '', roll('skill:' + skill, skill + ' ' + signed(block.skills[skill]), skill + ' check')]).flat();
    return el('div', { className: 'beast-block' }, [
      el('p', { className: 'muted small', text: block.typeLine + ' · CR ' + block.cr }),
      el('div', { className: 'beast-stats' }, [
        el('div', {}, [el('small', { text: 'AC' }), el('strong', { text: String(block.armorClass) })]),
        el('div', {}, [el('small', { text: 'Initiative' }), roll('initiative', signed(block.initiative), 'Roll initiative')]),
        el('div', {}, [el('small', { text: 'Speed' }), el('span', { text: block.speed })]),
        el('div', {}, [el('small', { text: 'Passive Perception' }), el('span', { text: String(block.passivePerception) })])
      ]),
      block.armorClassNote ? el('p', { className: 'muted small', text: block.armorClassNote }) : null,
      el('table', { className: 'beast-abilities' }, [
        el('thead', {}, el('tr', {}, [el('th', { text: '' }), ...ABILITIES.map(ability => el('th', { text: ability.toUpperCase() }))])),
        el('tbody', {}, [
          el('tr', {}, [el('th', { text: 'Score' }), ...ABILITIES.map(ability => el('td', {}, [
            String(block.scores[ability]), ' ', roll('check:' + ability, '(' + signed(block.mods[ability]) + ')', ability.toUpperCase() + ' check')
          ]))]),
          el('tr', {}, [el('th', { text: 'Save' }), ...ABILITIES.map(ability => el('td', {}, roll('save:' + ability, signed(block.saves[ability]), ability.toUpperCase() + ' save')))])
        ])
      ]),
      el('p', { className: 'muted small', text: 'STR, DEX and CON are the beast\'s; INT, WIS and CHA, your proficiencies and Hit Points stay yours.' }),
      skills.length ? el('p', { className: 'small' }, [el('strong', { text: 'Skills ' }), ...skills]) : null,
      block.senses ? el('p', { className: 'small' }, [el('strong', { text: 'Senses ' }), block.senses]) : null,
      featureList('Traits', block.traits, block, live),
      featureList('Actions', block.actions, block, live),
      featureList('Bonus Actions', block.bonusActions, block, live),
      featureList('Reactions', block.reactions, block, live)
    ]);
  }

  function formRow(form) {
    const active = view.active === form.name;
    if (form.missing) {
      return el('li', { className: 'beast-form' }, [
        el('div', { className: 'beast-form-head' }, [
          el('strong', { text: form.name }), el('span', { className: 'muted small', text: ' not in the beast list' }),
          el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Forget', onclick: () => act(() => forms({ forget: form.name }), form.name + ' forgotten.') })
        ])
      ]);
    }
    const shown = active || open.has(form.name);
    return el('li', { className: 'beast-form' + (active ? ' is-active' : '') }, [
      el('div', { className: 'beast-form-head' }, [
        el('div', {}, [
          el('strong', { text: form.name }),
          el('span', { className: 'muted small', text: ' CR ' + form.cr + ' · ' + form.size + ' · AC ' + form.block.armorClass + ' · ' + form.block.speed })
        ]),
        el('div', { className: 'beast-form-buttons' }, [
          active
            ? el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Revert', onclick: () => act(() => vitals({ action: 'revertWildShape' }), 'You are back in your true form.') })
            : el('button', {
              type: 'button', className: 'btn btn-small btn-green', text: 'Transform', disabled: view.uses.left < 1 || view.hp.current === 0,
              title: view.uses.left < 1 ? 'No Wild Shape uses left: one comes back on a Short Rest, all on a Long Rest.' : 'Bonus Action: spend one use of Wild Shape',
              onclick: () => act(() => vitals({ action: 'wildShape', form: form.name }), 'You take the form of a ' + form.name + ' and gain ' + view.rules.tempHp + ' temporary HP.')
            }),
          active ? null : el('button', {
            type: 'button', className: 'btn btn-small btn-secondary', text: shown ? 'Hide stats' : 'Stats', 'aria-expanded': String(shown),
            onclick: () => { if (open.has(form.name)) open.delete(form.name); else open.add(form.name); render(); }
          }),
          active ? null : el('button', {
            type: 'button', className: 'btn btn-small btn-secondary', text: '✕', title: 'Forget this form', 'aria-label': 'Forget ' + form.name,
            onclick: () => { if (window.confirm('Forget ' + form.name + '? You can learn another form in its place.')) act(() => forms({ forget: form.name }), form.name + ' forgotten.'); }
          })
        ])
      ]),
      shown ? statBlock(form.block, active) : null
    ]);
  }

  function learnPicker() {
    if (view.known.length >= view.rules.knownLimit) {
      return el('p', { className: 'muted small', text: 'You know as many forms as you can. Forget one to learn another (the rules allow one swap per Long Rest).' });
    }
    if (!view.learnable.length) return el('p', { className: 'muted small', text: 'No more beasts within your limits.' });
    const select = el('select', { 'aria-label': 'Beast to learn' });
    select.add(new Option('-- Learn a form --', ''));
    const byCr = new Map();
    view.learnable.forEach(beast => {
      if (!byCr.has(beast.cr)) byCr.set(beast.cr, []);
      byCr.get(beast.cr).push(beast);
    });
    byCr.forEach((beasts, cr) => {
      const group = el('optgroup', { label: 'CR ' + cr });
      beasts.forEach(beast => group.append(new Option(beast.name + ' (' + beast.size + (beast.fly ? ', flies' : '') + (beast.swim ? ', swims' : '') + ')', beast.name)));
      select.append(group);
    });
    const learn = el('button', {
      type: 'button', className: 'btn btn-small', text: 'Learn',
      onclick: () => { if (select.value) act(() => forms({ learn: select.value }), 'You can now take the form of a ' + select.value + '.'); }
    });
    return el('div', { className: 'vitals-actions' }, [select, learn]);
  }

  // Circle of the Stars: Starry Form (a Wild Shape use, 10 minutes) and Cosmic Omen.
  function starrySection() {
    const starry = view.starry;
    const r = starry.rules;
    const roll = roller(true);
    const notes = [r.resistance ? 'Full of Stars: Resistance to Bludgeoning, Piercing and Slashing damage.' : null, 'Bright Light 10 ft., Dim Light 10 ft. more.'].filter(Boolean);
    const card = constellation => {
      const active = starry.active === constellation.name;
      const take = starry.active && !active && r.canSwitch
        ? el('button', {
          type: 'button', className: 'btn btn-small', text: 'Switch', title: 'Twinkling Constellations: change at the start of your turn (no use spent)',
          onclick: () => act(() => vitals({ action: 'starryForm', constellation: constellation.name, switch: true }), 'The ' + constellation.name + ' now glimmers on you.')
        })
        : active ? null : el('button', {
          type: 'button', className: 'btn btn-small btn-green', text: starry.active ? 'Take again' : 'Take form',
          disabled: view.uses.left < 1 || view.hp.current === 0,
          title: view.uses.left < 1 ? 'No Wild Shape uses left: one comes back on a Short Rest, all on a Long Rest.' : 'Bonus Action: spend one use of Wild Shape',
          onclick: () => act(() => vitals({ action: 'starryForm', constellation: constellation.name }), 'You take your Starry Form: the ' + constellation.name + '.')
        });
      const rolls = active && constellation.attack
        ? el('p', { className: 'beast-rolls' }, [el('strong', { text: constellation.attack.name + ' ' }),
          roll('starry:archer:hit', signed(constellation.attack.attackBonus) + ' to hit', 'Roll the ranged spell attack'), ' · ',
          roll('starry:archer:damage', constellation.attack.damage.formula + ' Radiant', 'Roll damage')])
        : active && constellation.healing
          ? el('p', { className: 'beast-rolls' }, [el('strong', { text: 'Healing ' }), roll('starry:chalice:heal', constellation.healing + ' HP', 'Roll the Chalice healing')])
          : null;
      return el('li', { className: 'beast-form' + (active ? ' is-active' : '') }, [
        el('div', { className: 'beast-form-head' }, [
          el('div', {}, [el('strong', { text: constellation.name }), active ? el('span', { className: 'muted small', text: ' · active' }) : null]),
          el('div', { className: 'beast-form-buttons' }, [take])
        ]),
        el('p', { className: 'muted small', text: constellation.text }),
        rolls
      ]);
    };
    const omen = starry.cosmicOmen
      ? el('p', { className: 'small' }, [
        el('strong', { text: 'Cosmic Omen: ' + (starry.cosmicOmen === 'weal' ? 'Weal' : 'Woe') + '. ' }),
        'Reaction, when a creature you can see within 30 ft. is about to make a D20 Test: ',
        roll('omen:d6', (starry.cosmicOmen === 'weal' ? 'add' : 'subtract') + ' 1d6', 'Roll the omen d6'),
        '. Rolled again after each Long Rest.'
      ])
      : r.cosmicOmen ? el('p', { className: 'muted small', text: 'Cosmic Omen: your omen is rolled when you finish a Long Rest.' }) : null;
    return el('div', { className: 'starry-form' }, [
      el('h5', { text: 'Starry Form' }),
      el('p', { className: 'muted small', text: 'Instead of a beast: Bonus Action, spends a Wild Shape use, lasts 10 minutes; you keep your own statistics. ' +
        (r.canSwitch ? 'At the start of each of your turns you can switch constellation. ' : '') + notes.join(' ') }),
      starry.active
        ? el('p', { className: 'beast-active' }, ['✨ The ', el('strong', { text: starry.active }), ' glimmers on you. ',
          el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Dismiss', onclick: () => act(() => vitals({ action: 'dismissStarryForm' }), 'Your Starry Form fades.') })])
        : null,
      el('ul', { className: 'beast-forms' }, starry.constellations.map(card)),
      omen,
      el('h5', { text: 'Beast forms' })
    ]);
  }

  function render() {
    if (!view || !view.available) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const r = view.rules;
    const summary = el('p', { className: 'small' }, [
      el('strong', { text: 'Uses ' + view.uses.left + ' / ' + view.uses.max }),
      ' · Bonus Action · a beast form lasts up to ' + r.hours + (r.hours === 1 ? ' hour' : ' hours') + ' and gives ' + r.tempHp + ' temporary HP' +
      ' · Forms ' + view.known.length + ' / ' + r.knownLimit + ' · Max CR ' + r.maxCr + (r.canFly ? '' : ' · no Fly Speed yet') +
      (r.moon ? ' · Circle Forms (AC at least 13 + WIS)' : '')
    ]);
    const active = view.active
      ? el('p', { className: 'beast-active' }, ['🐾 You are in ', el('strong', { text: view.active }), ' form. It ends when you revert (Bonus Action), drop to 0 HP, or take a Long Rest.'])
      : null;
    body.replaceChildren(...[
      summary,
      view.starry ? starrySection() : null,
      active,
      view.hasBeastList ? null : el('p', { className: 'sheet-message is-error', text: 'The beast list (rules/content/beasts.md) is not on this server yet. Ask the DM.' }),
      view.known.length ? el('ul', { className: 'beast-forms' }, view.known.map(formRow)) : el('p', { className: 'muted small', text: 'No forms learned yet.' }),
      view.hasBeastList ? learnPicker() : null,
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null
    ].filter(Boolean));
  }

  async function load() {
    try {
      view = await request('/api/characters/' + characterId + '/wild-shape', 'GET');
    } catch (error) {
      message = error.message;
      isError = true;
    }
    render();
  }

  window.refreshCharacterWildShape = load;
  load();
})();
