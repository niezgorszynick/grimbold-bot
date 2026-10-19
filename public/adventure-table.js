// public/adventure-table.js — The live table of a running adventure: one card
// per party member (HP, AC, slots, saves, ...), refreshed every few seconds so
// changes players make on their sheets show up. The adventure's DM (and
// admins) put the party together and finish the adventure here.

(function () {
  const root = document.getElementById('adventure-table');
  if (!root) return;
  const adventureId = Number(root.dataset.adventureId);
  const viewerIsAdmin = root.dataset.isAdmin === 'true';
  // Changes arrive at once over /live; this poll is only a safety net.
  const REFRESH_MS = 60000;
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
  const signed = n => (n === null || n === undefined ? '—' : (n >= 0 ? '+' : '') + n);
  const button = (text, onclick, className = 'btn btn-small', extra = {}) => el('button', Object.assign({ type: 'button', className, text, onclick }, extra));

  let data = null;
  let message = '';
  let isError = false;
  let updatedAt = null;
  let finishing = false;
  let live = false;

  async function api(path, body) {
    const response = await fetch('/api/adventures/' + adventureId + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the adventure.');
    return result;
  }

  async function load() {
    try {
      data = await api('/table');
      updatedAt = new Date();
      if (isError && /load/.test(message)) message = '';
    } catch (error) {
      if (!data) {
        root.replaceChildren(el('p', { className: 'alert red', text: error.message === 'Forbidden.' ? 'Only the DM, admins and players in the party can see this adventure.' : error.message }));
        return;
      }
      message = 'Could not refresh: ' + error.message;
      isError = true;
    }
    render();
  }

  async function act(path, body, success) {
    try {
      const result = await api(path, body);
      if (result && result.party) data = result;
      message = typeof success === 'function' ? success(result) : (success || '');
      isError = false;
      return result;
    } catch (error) {
      message = error.message;
      isError = true;
      return null;
    } finally {
      render();
    }
  }

  // ─── One party member ──────────────────────────────────────────────────────
  function hpBlock(hp) {
    if (!hp) return el('p', { className: 'muted small', text: 'Hit Points unknown' });
    const ratio = hp.max ? Math.max(0, Math.min(1, hp.current / hp.max)) : 0;
    const state = hp.current === 0 ? 'down' : ratio <= 0.5 ? 'hurt' : 'ok';
    const tags = [];
    if (hp.temp) tags.push(el('span', { className: 'tag', text: '+' + hp.temp + ' temp' }));
    if (hp.current === 0) {
      tags.push(el('span', { className: 'tag red', text: hp.stable ? 'Stable' : 'Down' }));
      if (!hp.stable && hp.deathSaves) {
        tags.push(el('span', { className: 'muted small', text: 'Death saves ✔' + hp.deathSaves.successes + ' ✖' + hp.deathSaves.failures }));
      }
    }
    return el('div', { className: 'party-hp' }, [
      el('div', { className: 'party-hp-numbers' }, [
        el('span', { className: 'roster-hp roster-hp-' + state + ' party-hp-current', text: String(hp.current) }),
        el('span', { className: 'muted', text: ' / ' + hp.max + ' HP' }), ' ', ...tags
      ]),
      el('div', { className: 'vitals-bar' }, el('span', { style: 'width:' + Math.round(ratio * 100) + '%; background:' + (state === 'ok' ? '#23a55a' : state === 'hurt' ? '#f0b232' : '#f23f43') }))
    ]);
  }

  // roll: a roll id (public/dice.js), clickable only for those who run the adventure.
  function stat(label, value, title, roll) {
    const rollable = roll && data.canManage;
    return el('div', { className: 'party-stat' + (rollable ? ' is-rollable' : ''), title: rollable ? title + ' — click to roll' : title, 'data-roll': rollable ? roll : null },
      [el('span', { text: label }), el('strong', { text: value === null || value === undefined ? '—' : String(value) })]);
  }
  const rollIf = (roll, text, title) => (data.canManage
    ? el('button', { type: 'button', className: 'roll-link', 'data-roll': roll, title, text })
    : document.createTextNode(text));

  function slotsLine(member) {
    const parts = member.spellSlots.map(slot => {
      const left = slot.total - slot.spent;
      return el('span', { className: 'party-slot' + (left === 0 ? ' is-empty' : ''), title: 'Level ' + slot.level + ': ' + left + ' of ' + slot.total + ' left' }, [
        el('small', { text: 'L' + slot.level + ' ' }), '●'.repeat(left) + '○'.repeat(slot.spent)
      ]);
    });
    if (member.pact) {
      const left = member.pact.count - member.pact.spent;
      parts.push(el('span', { className: 'party-slot' + (left === 0 ? ' is-empty' : ''), title: 'Pact Magic, level ' + member.pact.slotLevel + ' slots' }, [
        el('small', { text: 'Pact L' + member.pact.slotLevel + ' ' }), '●'.repeat(left) + '○'.repeat(member.pact.spent)
      ]));
    }
    return parts.length ? el('div', { className: 'party-line' }, [el('span', { className: 'party-label', text: 'Slots' }), ...parts]) : null;
  }

  // DM: damage, healing and temporary HP for a party member, through the same
  // route as the character sheet (so the sheet shows it too).
  const HP_EVENTS = {
    droppedToZero: 'drops to 0 HP: unconscious and dying.',
    instantDeath: 'dies outright from massive damage.',
    dead: 'has died.',
    revived: 'is back on their feet.',
    wildShapeEnded: 'is back in their true form.',
    starryFormEnded: 'leaves their Starry Form.'
  };
  async function changeHp(member, action, params) {
    try {
      const response = await fetch('/api/characters/' + member.id + '/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ action }, params))
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not change Hit Points.');
      const parts = action === 'inspiration'
        ? [member.name + (params.on ? ' gains Heroic Inspiration.' : ' no longer has Heroic Inspiration.')]
        : action === 'revertWildShape' || action === 'dismissStarryForm'
          ? []
          : [member.name + ' ' + { damage: 'takes ' + params.amount + ' damage', heal: 'heals ' + params.amount + ' HP', tempHp: 'gains ' + params.amount + ' temporary HP' }[action] +
          ': ' + result.vitals.hpCurrent + ' / ' + result.vitals.hpMax + ' HP.'];
      (result.events || []).forEach(event => { if (HP_EVENTS[event]) parts.push(member.name + ' ' + HP_EVENTS[event]); });
      if (result.concentration) {
        parts.push(result.concentration.ended
          ? 'Concentration on ' + result.concentration.spell + ' ended.'
          : 'Concentration check for ' + result.concentration.spell + ': Constitution save DC ' + result.concentration.dc + '.');
      }
      message = parts.join(' ');
      isError = false;
    } catch (error) {
      message = member.name + ': ' + error.message;
      isError = true;
    }
    await load();
  }

  function hpActions(member) {
    const amount = el('input', { type: 'number', min: '1', max: '10000', inputmode: 'numeric', placeholder: 'HP', 'aria-label': 'Amount for ' + member.name });
    const read = () => {
      const value = Number(amount.value);
      if (Number.isInteger(value) && value > 0) return value;
      message = 'Enter a positive whole number for ' + member.name + ' first.';
      isError = true;
      render();
      return null;
    };
    amount.addEventListener('keydown', event => {
      if (event.key === 'Enter') { const value = read(); if (value !== null) changeHp(member, 'damage', { amount: value }); }
    });
    return el('div', { className: 'party-hp-actions' }, [
      amount,
      button('Damage', () => { const value = read(); if (value !== null) changeHp(member, 'damage', { amount: value }); }, 'btn btn-small btn-red'),
      button('Heal', () => { const value = read(); if (value !== null) changeHp(member, 'heal', { amount: value }); }, 'btn btn-small btn-green'),
      button('Temp HP', () => { const value = read(); if (value !== null) changeHp(member, 'tempHp', { amount: value }); }),
      // The DM awards Heroic Inspiration (or takes it back).
      button(member.heroicInspiration ? '★ Inspired' : '☆ Inspire', () => changeHp(member, 'inspiration', { on: !member.heroicInspiration }),
        'btn btn-small' + (member.heroicInspiration ? ' btn-gold' : ''), { title: member.heroicInspiration ? 'Take Heroic Inspiration back' : 'Give Heroic Inspiration' })
    ]);
  }

  function memberCard(member) {
    const classes = member.classes.map(row => row.className + ' ' + row.level + (row.subclassName ? ' (' + row.subclassName + ')' : '')).join(' / ');
    const flags = [];
    if (member.status !== 'alive') flags.push(el('span', { className: 'tag red', text: 'Dead' }));
    if (member.concentration) flags.push(el('span', { className: 'tag gold', text: 'Concentrating: ' + member.concentration }));
    if (member.exhaustion) flags.push(el('span', { className: 'tag red', text: 'Exhaustion ' + member.exhaustion }));
    if (member.heroicInspiration) flags.push(el('span', { className: 'tag gold', text: '★ Heroic Inspiration' }));
    if (member.starryForm) {
      flags.push(el('span', { className: 'tag gold' }, [
        '✨ Starry Form: ' + member.starryForm,
        data.canManage && data.adventure.status === 'active'
          ? button('End', () => changeHp(member, 'dismissStarryForm', {}), 'link-button small', { title: 'End the Starry Form (e.g. Incapacitated)' })
          : null
      ]));
    }
    if (member.cosmicOmen) {
      flags.push(el('span', { className: 'tag', title: 'Reaction: roll 1d6 and ' + (member.cosmicOmen === 'weal' ? 'add it to' : 'subtract it from') + ' a D20 Test of a creature within 30 ft.' }, [
        'Cosmic Omen: ' + (member.cosmicOmen === 'weal' ? 'Weal (+1d6)' : 'Woe (−1d6)') + ' ',
        rollIf('omen:d6', '🎲', 'Roll the omen d6')
      ]));
    }
    if (member.wildShape) {
      flags.push(el('span', { className: 'tag green' }, [
        '🐾 Wild Shape: ' + member.wildShape.name,
        data.canManage && data.adventure.status === 'active'
          ? button('Revert', () => changeHp(member, 'revertWildShape', {}), 'link-button small', { title: 'End the Wild Shape (e.g. Incapacitated)' })
          : null
      ]));
    }
    const remove = data.canManage && data.adventure.status === 'active'
      ? button('✕', () => {
        if (window.confirm('Take ' + member.name + ' out of the party?')) act('/party', { characterId: member.id, inParty: false }, member.name + ' left the party.');
      }, 'btn btn-small btn-secondary party-remove', { title: 'Remove from party', 'aria-label': 'Remove ' + member.name + ' from the party' })
      : null;
    const nameNode = viewerIsAdmin
      ? el('a', { className: 'roster-name', href: '/admin?tab=character-sheet&edit_char=' + member.id, target: '_blank', rel: 'noopener', text: member.name })
      : el('strong', { text: member.name });
    const casting = member.spellcasting.map(source => source.label + ' DC ' + source.saveDc + ' · ' + signed(source.attackBonus));
    return el('article', { className: 'party-card' + (member.hp && member.hp.current === 0 ? ' is-down' : ''), 'data-roll-character': data.canManage ? String(member.id) : null }, [
      el('header', { className: 'party-card-header' }, [
        member.portraitUrl ? el('img', { className: 'party-portrait', src: member.portraitUrl, alt: '', loading: 'lazy' }) : null,
        el('div', { className: 'party-card-title' }, [nameNode, el('div', { className: 'muted small', text: member.player + ' · ' + (member.species || '') + ' · ' + classes })]),
        remove
      ]),
      hpBlock(member.hp),
      data.canManage && data.adventure.status === 'active' && member.hp && member.status === 'alive' ? hpActions(member) : null,
      el('div', { className: 'party-stats' }, [
        stat('AC', member.armorClass, 'Armor Class'),
        stat('Init', signed(member.initiative), 'Initiative', 'initiative'),
        stat('Speed', member.speed),
        stat('PP', member.passivePerception, 'Passive Perception', 'skill:Perception'),
        stat('Prof', signed(member.proficiencyBonus), 'Proficiency Bonus')
      ]),
      flags.length ? el('div', { className: 'party-flags' }, flags) : null,
      member.saves ? el('div', { className: 'party-line' }, [
        el('span', { className: 'party-label', text: 'Saves' }),
        ...ABILITIES.map(ability => el('span', { className: 'party-save' }, [el('small', { text: ability.toUpperCase() + ' ' }), rollIf('save:' + ability, signed(member.saves[ability]), ability.toUpperCase() + ' save')]))
      ]) : null,
      casting.length ? el('div', { className: 'party-line' }, [el('span', { className: 'party-label', text: 'Spells' }), casting.join(' / ')]) : null,
      slotsLine(member),
      member.resources && member.resources.length ? el('div', { className: 'party-line' }, [
        el('span', { className: 'party-label', text: 'Features' }),
        member.resources.map(resource => resource.name + ' ' + resource.left + '/' + resource.max).join(' · ')
      ]) : null,
      member.hitDice.length ? el('div', { className: 'party-line' }, [
        el('span', { className: 'party-label', text: 'Hit Dice' }),
        member.hitDice.map(dice => (dice.total - dice.spent) + '/' + dice.total + ' ' + dice.die).join(', ')
      ]) : null,
      member.attacks.length ? el('div', { className: 'party-line party-attacks' }, [
        el('span', { className: 'party-label', text: 'Attacks' }),
        el('span', {}, member.attacks.map(attack => el('span', { className: 'party-attack' }, [
          el('strong', { text: attack.name }), ' ', rollIf((attack.roll || 'attack:' + attack.index) + ':hit', attack.attackBonus, 'Roll to hit'), ', ',
          rollIf((attack.roll || 'attack:' + attack.index) + ':damage', attack.damage, 'Roll damage')
        ])))
      ]) : null
    ]);
  }

  // ─── Managing the adventure ────────────────────────────────────────────────
  function partyPicker() {
    const select = el('select', { 'aria-label': 'Character to add to the party' });
    select.add(new Option('Add a character to the party…', ''));
    const byPlayer = new Map();
    data.candidates.forEach(candidate => {
      if (!byPlayer.has(candidate.player)) byPlayer.set(candidate.player, []);
      byPlayer.get(candidate.player).push(candidate);
    });
    byPlayer.forEach((characters, player) => {
      const group = el('optgroup', { label: player });
      characters.forEach(candidate => group.append(new Option(candidate.name + ' (Lvl ' + candidate.level + ' ' + candidate.class + ')', String(candidate.id))));
      select.append(group);
    });
    select.addEventListener('change', () => {
      if (!select.value) return;
      const chosen = data.candidates.find(candidate => String(candidate.id) === select.value);
      act('/party', { characterId: Number(select.value), inParty: true }, (chosen ? chosen.name : 'Character') + ' joined the party.');
    });
    return select;
  }

  // ─── Notable NPCs on the table ─────────────────────────────────────────────
  function npcPicker() {
    const select = el('select', { 'aria-label': 'NPC to add to the adventure' });
    select.add(new Option('Add a notable NPC…', ''));
    data.npcCandidates.forEach(npc => select.add(new Option(npc.name + (npc.affiliation ? ' (' + npc.affiliation + ')' : '') + (npc.reservedBy ? ' 🔒 reserved by ' + npc.reservedBy : ''), String(npc.id))));
    select.addEventListener('change', () => {
      if (!select.value) return;
      const chosen = data.npcCandidates.find(npc => String(npc.id) === select.value);
      // Reserved: the owning DM has long-term plans for this NPC.
      if (chosen && chosen.reservedBy && !window.confirm(chosen.name + ' is reserved by ' + chosen.reservedBy + ', who has long-term plans for them. Check with them first. Add ' + chosen.name + ' anyway?')) {
        select.value = '';
        return;
      }
      act('/npcs', { npcId: Number(select.value), inAdventure: true, hidden: addHidden }, (chosen ? chosen.name : 'NPC') + (addHidden ? ' joined the table, hidden from the party.' : ' joined the table.'));
    });
    return select;
  }

  async function changeNpcHp(npc, action, amount) {
    try {
      const result = await api('/npcs/' + npc.id + '/hp', { action, amount });
      const verb = { damage: 'takes ' + amount + ' damage', heal: 'heals ' + amount + ' HP', tempHp: 'gains ' + amount + ' temporary HP' }[action];
      message = npc.name + ' ' + verb + ': ' + result.npc.hpCurrent + ' / ' + result.npc.hpMax + ' HP.' + (result.npc.hpCurrent === 0 ? ' ' + npc.name + ' is down.' : '');
      isError = false;
    } catch (error) {
      message = npc.name + ': ' + error.message;
      isError = true;
    }
    await load();
  }

  // NPC stats, HP and hidden NPCs: the adventure's DM (and the Root DM) only.
  const secretsOpen = () => data.canSeeSecrets && data.adventure.status === 'active';
  let addHidden = false;

  function npcCard(npc) {
    const manage = secretsOpen();
    const stats = npc.stats;
    const hp = stats && Number.isInteger(stats.hpMax)
      ? { current: Number.isInteger(stats.hpCurrent) ? stats.hpCurrent : stats.hpMax, max: stats.hpMax, temp: stats.hpTemp }
      : null;
    let actions = null;
    if (manage && hp) {
      const amount = el('input', { type: 'number', min: '1', max: '10000', inputmode: 'numeric', placeholder: 'HP', 'aria-label': 'Amount for ' + npc.name });
      const read = () => {
        const value = Number(amount.value);
        if (Number.isInteger(value) && value > 0) return value;
        message = 'Enter a positive whole number for ' + npc.name + ' first.';
        isError = true;
        render();
        return null;
      };
      amount.addEventListener('keydown', event => { if (event.key === 'Enter') { const value = read(); if (value !== null) changeNpcHp(npc, 'damage', value); } });
      actions = el('div', { className: 'party-hp-actions' }, [
        amount,
        button('Damage', () => { const value = read(); if (value !== null) changeNpcHp(npc, 'damage', value); }, 'btn btn-small btn-red'),
        button('Heal', () => { const value = read(); if (value !== null) changeNpcHp(npc, 'heal', value); }, 'btn btn-small btn-green'),
        button('Temp HP', () => { const value = read(); if (value !== null) changeNpcHp(npc, 'tempHp', value); })
      ]);
    }
    const remove = manage
      ? button('✕', () => {
        if (window.confirm('Take ' + npc.name + ' off the table? They stay in the NPC list.')) act('/npcs', { npcId: npc.id, inAdventure: false }, npc.name + ' left the table.');
      }, 'btn btn-small btn-secondary party-remove', { title: 'Remove from the adventure', 'aria-label': 'Remove ' + npc.name + ' from the adventure' })
      : null;
    const abilities = stats ? ABILITIES.filter(ability => stats.abilities[ability]) : [];
    return el('article', { className: 'party-card npc-table-card' + (hp && hp.current === 0 ? ' is-down' : '') + (npc.hidden ? ' is-hidden' : '') + (npc.condition === 'Down' ? ' is-down' : '') }, [
      el('header', { className: 'party-card-header' }, [
        npc.portraitUrl ? el('img', { className: 'npc-portrait npc-portrait-small', src: npc.portraitUrl, alt: '', loading: 'lazy' }) : null,
        el('div', { className: 'npc-table-name' }, [
          el('a', { className: 'roster-name', href: '/admin?tab=npcs#npc-' + npc.id, target: '_blank', rel: 'noopener', text: npc.name }),
          el('div', { className: 'muted small', text: ['NPC', npc.affiliation].filter(Boolean).join(' · ') })
        ]),
        remove
      ]),
      manage ? el('div', { className: 'npc-visibility' }, [
        npc.hidden ? el('span', { className: 'tag gold', text: 'Hidden from the party' }) : el('span', { className: 'muted small', text: 'Visible to the party' }),
        button(npc.hidden ? 'Reveal' : 'Hide', () => act('/npcs/' + npc.id + '/hidden', { hidden: !npc.hidden }, npc.name + (npc.hidden ? ' is now visible to the party.' : ' is hidden from the party.')), 'btn btn-small btn-secondary')
      ]) : null,
      !stats && npc.condition ? el('div', { className: 'party-line' }, [el('span', { className: 'party-label', text: 'Condition' }), el('span', { className: 'npc-condition npc-condition-' + npc.condition.toLowerCase(), text: npc.condition })]) : null,
      stats ? hpBlock(hp) : (npc.description ? el('p', { className: 'muted small npc-table-description', text: npc.description }) : null),
      actions,
      stats ? el('div', { className: 'party-stats' }, [
        stat('AC', stats.armorClass ?? '—', 'Armor Class'),
        stats.speed ? stat('Speed', stats.speed) : null
      ].filter(Boolean)) : null,
      stats && stats.baseMonster ? el('div', { className: 'party-line' }, [
        el('span', { className: 'party-label', text: 'Statblock' }),
        stats.baseMonster.found
          ? el('a', { href: '/admin?tab=monsters&monster=' + encodeURIComponent(stats.baseMonster.name), target: '_blank', rel: 'noopener', text: stats.baseMonster.name + ' (CR ' + stats.baseMonster.crText + ')' })
          : stats.baseMonster.name
      ]) : null,
      abilities.length ? el('div', { className: 'party-line' }, [
        el('span', { className: 'party-label', text: 'Scores' }),
        abilities.map(ability => ability.toUpperCase() + ' ' + stats.abilities[ability].score + ' (' + signed(stats.abilities[ability].modifier) + ')').join(' · ')
      ]) : null,
      npc.personality ? el('div', { className: 'party-line' }, [el('span', { className: 'party-label', text: 'Personality' }), npc.personality]) : null
    ]);
  }

  function npcSection() {
    const manage = secretsOpen();
    const hiddenNote = data.hiddenNpcs ? el('p', { className: 'muted small', text: data.hiddenNpcs + ' NPC' + (data.hiddenNpcs === 1 ? ' is' : 's are') + " hidden by this adventure's DM." }) : null;
    if (!data.npcs.length && !(manage && data.npcCandidates.length)) return hiddenNote;
    const hiddenBox = el('input', { type: 'checkbox' });
    hiddenBox.checked = addHidden;
    hiddenBox.addEventListener('change', () => { addHidden = hiddenBox.checked; });
    return el('section', { className: 'adventure-npcs' }, [
      el('div', { className: 'sheet-section-heading' }, [el('h3', { text: 'Notable NPCs' }), manage && data.npcCandidates.length ? el('span', { className: 'npc-add' }, [npcPicker(), el('label', { className: 'muted small', title: 'Prepare the NPC without the party seeing it; reveal it later.' }, [hiddenBox, ' add hidden'])]) : null]),
      hiddenNote,
      data.npcs.length ? el('div', { className: 'party-grid' }, data.npcs.map(npcCard)) : el('p', { className: 'muted small', text: 'No NPCs at the table.' })
    ]);
  }

  // ─── Encounters ────────────────────────────────────────────────────────────
  // The DM plans them (monsters × count and NPCs against the party's XP
  // budget), runs one, and tracks it here: initiative, HP and statblock dice
  // (rolled through the dice bar, for the DM's eyes only). The party sees the
  // running fight's creatures in turn order with a word for their state.
  const thousands = n => Number(n || 0).toLocaleString('en-US');
  const openStatblocks = new Set();
  let monsterList = null;
  let monsterListLoading = false;
  const DIFFICULTY_TAGS = { None: 'tag', Low: 'tag green', Moderate: 'tag gold', High: 'tag red', 'Beyond High': 'tag red' };

  // The catalog for the "add a monster" boxes, loaded once.
  function monsterDatalist() {
    let list = document.getElementById('encounter-monster-list');
    if (!list) {
      list = el('datalist', { id: 'encounter-monster-list' });
      document.body.append(list);
    }
    if (!monsterList && !monsterListLoading) {
      monsterListLoading = true;
      api('/monsters').then(result => {
        monsterList = result.monsters;
        list.replaceChildren(...monsterList.map(monster => el('option', { value: monster.name, text: 'CR ' + monster.crText + ' · ' + thousands(monster.xp) + ' XP · ' + monster.typeText })));
      }).catch(error => {
        monsterListLoading = false;
        message = 'Monster list: ' + error.message;
        isError = true;
        render();
      });
    }
    return list;
  }

  function difficultyTag(encounter) {
    if (!encounter.difficulty) return el('span', { className: 'muted small', text: thousands(encounter.xp) + ' XP (add the party for a budget)' });
    const without = encounter.npcsWithoutXp;
    return el('span', {}, [
      el('span', { className: DIFFICULTY_TAGS[encounter.difficulty] || 'tag', text: encounter.difficulty }),
      el('span', { className: 'muted small', text: ' ' + thousands(encounter.xp) + ' XP' + (without ? ' (+' + without + ' NPC' + (without === 1 ? '' : 's') + ' without a statblock)' : '') })
    ]);
  }

  // Add monsters (a catalog name × count) or a Notable NPC.
  function addControls(encounter) {
    monsterDatalist();
    const name = el('input', { type: 'text', list: 'encounter-monster-list', placeholder: 'Monster, e.g. Goblin Warrior', 'aria-label': 'Monster to add', className: 'encounter-monster-input' });
    const count = el('input', { type: 'number', min: '1', max: '20', value: '1', className: 'inventory-qty', 'aria-label': 'How many' });
    const add = () => {
      if (!name.value.trim()) { message = 'Type a monster name first.'; isError = true; render(); return; }
      const many = Number(count.value) || 1;
      act('/encounters/' + encounter.id + '/add', { monster: name.value.trim(), count: many }, many + ' × ' + name.value.trim() + ' added to ' + encounter.name + '.');
    };
    name.addEventListener('keydown', event => { if (event.key === 'Enter') add(); });
    const inEncounter = new Set(encounter.combatants.filter(combatant => combatant.npcId).map(combatant => combatant.npcId));
    const npcs = [...(data.npcs || []), ...(data.npcCandidates || [])]
      .filter((npc, index, all) => all.findIndex(other => other.id === npc.id) === index && !inEncounter.has(npc.id));
    const npcSelect = el('select', { 'aria-label': 'NPC to add to the encounter' }, [
      el('option', { value: '', text: '+ Notable NPC…' }),
      ...npcs.map(npc => el('option', { value: String(npc.id), text: npc.name }))
    ]);
    npcSelect.addEventListener('change', () => {
      if (!npcSelect.value) return;
      const chosen = npcs.find(npc => String(npc.id) === npcSelect.value);
      act('/encounters/' + encounter.id + '/add', { npcId: Number(npcSelect.value) }, (chosen ? chosen.name : 'The NPC') + ' joins ' + encounter.name + '.');
    });
    return el('div', { className: 'table-filter encounter-add' }, [name, el('label', { className: 'small' }, ['× ', count]), button('Add', add, 'btn btn-small'), npcs.length ? npcSelect : null]);
  }

  // Rename a creature (e.g. to match its token in Owlbear) or change its AC and HP.
  const editingCombatants = new Set();
  function editButton(combatant) {
    return button('✎', () => {
      if (editingCombatants.has(combatant.id)) editingCombatants.delete(combatant.id); else editingCombatants.add(combatant.id);
      render();
    }, 'link-button small', { title: 'Rename ' + combatant.label + ' or change its AC and HP', 'aria-label': 'Edit ' + combatant.label });
  }
  function combatantEditor(combatant) {
    if (!editingCombatants.has(combatant.id)) return null;
    const name = el('input', { type: 'text', maxlength: '100', value: combatant.customName || '', placeholder: combatant.defaultLabel, 'aria-label': 'Name' });
    const number = (value, min, max, label) => el('input', { type: 'number', min, max, value: value ?? '', className: 'inventory-qty', 'aria-label': label });
    const ac = number(combatant.armorClass, '0', '40', 'AC');
    const hpMax = number(combatant.hpMax, '1', '5000', 'Max HP');
    const hpCurrent = number(combatant.hpCurrent, '0', '5000', 'Current HP');
    const save = () => act('/combatants/' + combatant.id, {
      name: name.value, armorClass: ac.value, hpMax: hpMax.value || undefined, hpCurrent: hpCurrent.value
    }, result => {
      editingCombatants.delete(combatant.id);
      const after = result.encounters.list.flatMap(item => item.combatants).find(item => item.id === combatant.id);
      return (after ? after.label : combatant.label) + ' updated.';
    });
    [name, ac, hpMax, hpCurrent].forEach(input => input.addEventListener('keydown', event => { if (event.key === 'Enter') save(); }));
    return el('div', { className: 'combatant-editor' }, [
      el('label', {}, ['Name ', name]),
      el('label', {}, ['AC ', ac]),
      el('label', {}, ['HP ', hpCurrent, ' / ', hpMax]),
      el('span', { className: 'vitals-actions' }, [
        button('Save', save, 'btn btn-small btn-green'),
        button('Cancel', () => { editingCombatants.delete(combatant.id); render(); }, 'btn btn-small btn-secondary')
      ]),
      el('p', { className: 'muted small', text: combatant.kind === 'npc'
        ? 'An empty name goes back to the NPC\'s. AC and HP are the NPC\'s own, so they change on the NPC too.'
        : 'An empty name goes back to "' + combatant.defaultLabel + '", an empty AC to the statblock\'s. Use the token\'s name in Owlbear to match it.' })
    ]);
  }

  function plannedCard(encounter) {
    const notes = el('textarea', { rows: '2', maxlength: '2000', placeholder: 'Notes: terrain, tactics, treasure…', 'aria-label': 'Notes for ' + encounter.name });
    notes.value = encounter.notes || '';
    notes.addEventListener('change', () => act('/encounters/' + encounter.id, { notes: notes.value }, 'Notes saved.'));
    const rows = encounter.combatants.map(combatant => el('li', {}, [
      el('strong', { text: combatant.label }),
      el('span', {
        className: 'muted small',
        text: ' ' + [
          combatant.crText ? 'CR ' + combatant.crText : (combatant.kind === 'npc' ? 'NPC' : null),
          Number.isInteger(combatant.hpMax) ? combatant.hpMax + ' HP' : null,
          combatant.armorClass ? 'AC ' + combatant.armorClass : null
        ].filter(Boolean).join(' · ')
      }),
      ' ', editButton(combatant),
      ' ', button('✕', () => act('/combatants/' + combatant.id + '/remove', {}, combatant.label + ' removed.'), 'link-button small', { title: 'Remove ' + combatant.label, 'aria-label': 'Remove ' + combatant.label }),
      combatant.customName ? el('span', { className: 'muted small', text: ' (' + combatant.defaultLabel + ')' }) : null,
      combatantEditor(combatant)
    ]));
    const count = encounter.combatants.length;
    return el('details', { className: 'sheet-card encounter-card', open: count === 0 || openPlans.has(encounter.id) ? true : null, 'data-encounter': String(encounter.id) }, [
      el('summary', {}, [el('strong', { text: encounter.name }), ' ', difficultyTag(encounter), el('span', { className: 'muted small', text: ' · ' + count + ' creature' + (count === 1 ? '' : 's') })]),
      rows.length ? el('ul', { className: 'encounter-roster' }, rows) : el('p', { className: 'muted small', text: 'Nothing here yet: add monsters or NPCs below.' }),
      addControls(encounter),
      notes,
      el('div', { className: 'vitals-actions' }, [
        button('▶ Run encounter', () => {
          if (window.confirm('Run "' + encounter.name + '"? The party will see who is in the fight (not their numbers), and its NPCs join the table.')) {
            act('/encounters/' + encounter.id + '/run', {}, encounter.name + ' has begun. Roll initiative!');
          }
        }, 'btn btn-small btn-green'),
        button('Rename', () => {
          const name = window.prompt('Encounter name', encounter.name);
          if (name && name.trim()) act('/encounters/' + encounter.id, { name }, 'Renamed.');
        }, 'btn btn-small btn-secondary'),
        button('Delete', () => { if (window.confirm('Delete "' + encounter.name + '"?')) act('/encounters/' + encounter.id + '/delete', {}, encounter.name + ' deleted.'); }, 'btn btn-small btn-red')
      ])
    ]);
  }

  // A statblock with its dice: the dice bar rolls them (Shift: advantage, Ctrl: disadvantage).
  function statblockNode(monster) {
    const rolls = new Map((monster.rolls || []).map(roll => [roll.id, roll]));
    const rollButton = (id, text) => (rolls.has(id)
      ? el('button', { type: 'button', className: 'roll-link', 'data-creature-roll': id, title: rolls.get(id).label + ' (' + rolls.get(id).formula + ')', text })
      : document.createTextNode(text));
    const mod = score => Math.floor((score - 10) / 2);
    const entryRolls = (section, index) => (monster.rolls || []).filter(roll => roll.id.startsWith(section + ':' + index + ':')).map(roll => el('button', {
      type: 'button', className: 'btn btn-small encounter-roll', 'data-creature-roll': roll.id, title: roll.label,
      text: '🎲 ' + (roll.kind === 'attack' ? 'Hit ' + (roll.formula.replace('1d20', '') || '+0') : roll.formula + ' ' + ((roll.label.match(/\(([^)]+)\)$/) || [])[1] || ''))
    }));
    const sections = [['traits', 'Traits'], ['actions', 'Actions'], ['bonusActions', 'Bonus Actions'], ['reactions', 'Reactions'], ['legendaryActions', 'Legendary Actions']];
    const lines = [['Vulnerabilities', monster.vulnerabilities], ['Resistances', monster.resistances], ['Immunities', monster.immunities], ['Senses', monster.senses], ['Languages', monster.languages]]
      .filter(([, value]) => value).map(([label, value]) => el('div', {}, [el('strong', { text: label + ' ' }), value]));
    const skills = Object.entries(monster.skills || {});
    return el('div', { className: 'statblock encounter-statblock' }, [
      el('div', { className: 'muted small' }, [el('em', { text: monster.typeLine }), ' · CR ' + monster.crText + ' · ', rollButton('initiative', 'Initiative ' + signed(monster.initiative ?? mod(monster.abilities.dex || 10)))]),
      el('div', { className: 'statblock-lines' }, [
        el('div', {}, [el('strong', { text: 'Speed ' }), monster.speed]),
        el('div', { className: 'encounter-abilities' }, ABILITIES.filter(ability => monster.abilities[ability]).map(ability => el('span', {}, [
          el('small', { text: ability.toUpperCase() + ' ' }),
          rollButton('check:' + ability, monster.abilities[ability] + ' (' + signed(mod(monster.abilities[ability])) + ')'),
          el('small', { text: ' save ' }),
          rollButton('save:' + ability, signed(monster.saves[ability] ?? mod(monster.abilities[ability])))
        ]))),
        skills.length ? el('div', {}, [el('strong', { text: 'Skills ' }), ...skills.flatMap(([skill, bonus], index) => [index ? ', ' : '', rollButton('skill:' + skill, skill + ' ' + signed(bonus))])]) : null,
        ...lines
      ]),
      ...sections.flatMap(([key, title]) => ((monster[key] || []).length ? [
        el('h4', { className: 'statblock-section', text: title }),
        key === 'legendaryActions' && monster.legendaryIntro ? el('p', { className: 'statblock-entry', text: monster.legendaryIntro }) : null,
        ...monster[key].map((entry, index) => el('p', { className: 'statblock-entry' + (entry.sub ? ' is-sub' : '') }, [
          el('strong', {}, el('em', { text: entry.name + '. ' })), entry.text, ' ', ...entryRolls(key, index)
        ]))
      ] : []))
    ]);
  }

  function combatantCard(combatant) {
    const statblock = combatant.monster ? (data.encounters.statblocks || {})[combatant.monster] : null;
    const hp = Number.isInteger(combatant.hpMax) ? { current: combatant.hpCurrent, max: combatant.hpMax, temp: combatant.hpTemp } : null;
    const initiative = el('input', {
      type: 'number', min: '-10', max: '50', value: combatant.initiative ?? '', placeholder: '—', className: 'encounter-initiative',
      'aria-label': 'Initiative of ' + combatant.label, title: 'Initiative (' + signed(combatant.initiativeBonus) + '); empty to clear'
    });
    initiative.addEventListener('change', () => act('/combatants/' + combatant.id + '/initiative', { initiative: initiative.value }, ''));
    let actions = null;
    if (hp) {
      const amount = el('input', { type: 'number', min: '1', max: '10000', inputmode: 'numeric', placeholder: 'HP', 'aria-label': 'Amount for ' + combatant.label });
      const change = action => {
        const value = Number(amount.value);
        if (!Number.isInteger(value) || value <= 0) { message = 'Enter a positive whole number for ' + combatant.label + ' first.'; isError = true; render(); return; }
        act('/combatants/' + combatant.id + '/hp', { action, amount: value }, result => {
          const after = result.encounters.list.flatMap(item => item.combatants).find(item => item.id === combatant.id);
          const verb = { damage: 'takes ' + value + ' damage', heal: 'heals ' + value + ' HP', tempHp: 'gains ' + value + ' temporary HP' }[action];
          return combatant.label + ' ' + verb + (after ? ': ' + after.hpCurrent + ' / ' + after.hpMax + ' HP.' + (after.hpCurrent === 0 ? ' ' + combatant.label + ' is down.' : '') : '.');
        });
      };
      amount.addEventListener('keydown', event => { if (event.key === 'Enter') change('damage'); });
      actions = el('div', { className: 'party-hp-actions' }, [
        amount,
        button('Damage', () => change('damage'), 'btn btn-small btn-red'),
        button('Heal', () => change('heal'), 'btn btn-small btn-green'),
        button('Temp HP', () => change('tempHp'))
      ]);
    }
    let statblockPart;
    if (statblock) {
      statblockPart = el('details', { className: 'encounter-statblock-toggle', open: openStatblocks.has(combatant.id) ? true : null }, [el('summary', { text: 'Statblock & dice' }), statblockNode(statblock)]);
      // Open statblocks stay open when the table reloads.
      statblockPart.addEventListener('toggle', () => { if (statblockPart.open) openStatblocks.add(combatant.id); else openStatblocks.delete(combatant.id); });
    } else {
      statblockPart = el('p', { className: 'muted small', text: combatant.kind === 'npc' ? 'No statblock: base the NPC on one on the Notable NPCs tab.' : 'This monster is not in the list on this server.' });
    }
    const sub = [
      combatant.kind === 'npc' ? 'NPC' : null,
      combatant.kind === 'npc' && combatant.monster ? combatant.monster : null,
      combatant.crText ? 'CR ' + combatant.crText : null
    ].filter(Boolean).join(' · ');
    return el('article', { className: 'party-card encounter-combatant' + (hp && hp.current === 0 ? ' is-down' : ''), 'data-roll-combatant': String(combatant.id) }, [
      el('header', { className: 'party-card-header' }, [
        initiative,
        el('div', { className: 'party-card-title' }, [
          el('strong', { text: combatant.label }), ' ', editButton(combatant),
          sub || combatant.customName ? el('div', { className: 'muted small', text: [combatant.customName ? combatant.defaultLabel : null, sub].filter(Boolean).join(' · ') }) : null
        ]),
        button('✕', () => { if (window.confirm('Take ' + combatant.label + ' out of the fight?')) act('/combatants/' + combatant.id + '/remove', {}, combatant.label + ' left the fight.'); },
          'btn btn-small btn-secondary party-remove', { title: 'Remove from the encounter', 'aria-label': 'Remove ' + combatant.label })
      ]),
      combatantEditor(combatant),
      hpBlock(hp),
      actions,
      el('div', { className: 'party-stats' }, [
        stat('AC', combatant.armorClass ?? '—', 'Armor Class'),
        statblock ? stat('Speed', statblock.speed.split(',')[0]) : null
      ].filter(Boolean)),
      statblockPart
    ]);
  }

  // The fight that is on: the DM's working view, or the party's.
  function runningSection() {
    const encounters = data.encounters || {};
    if (secretsOpen()) {
      const encounter = (encounters.list || []).find(item => item.status === 'running');
      if (!encounter) return null;
      return el('section', { className: 'encounter-running' }, [
        el('div', { className: 'sheet-section-heading' }, [
          el('h3', {}, ['⚔ ' + encounter.name + ' ', difficultyTag(encounter)]),
          el('span', { className: 'vitals-actions' }, [
            button('🎲 Roll initiative', () => act('/encounters/' + encounter.id + '/initiative', {}, 'Initiative rolled for every creature that had none.'), 'btn btn-small',
              { title: 'Rolls for each creature without an initiative; type a number in to set one yourself.' }),
            button('End encounter', () => { if (window.confirm('End "' + encounter.name + '"?')) act('/encounters/' + encounter.id + '/end', {}, encounter.name + ' is over.'); }, 'btn btn-small btn-gold')
          ])
        ]),
        encounter.notes ? el('p', { className: 'muted small', text: encounter.notes }) : null,
        el('p', { className: 'muted small', text: 'In initiative order. Monster rolls show in the dice bar for you only (Shift-click: advantage, Ctrl-click: disadvantage). The party sees the names and how hurt they look.' }),
        el('div', { className: 'party-grid' }, encounter.combatants.map(combatantCard)),
        el('details', { className: 'encounter-reinforcements' }, [el('summary', { className: 'small', text: '+ Reinforcements' }), addControls(encounter)])
      ]);
    }
    const running = encounters.running;
    if (!running) return null;
    return el('section', { className: 'encounter-running' }, [
      el('h3', { text: '⚔ ' + running.name }),
      el('ol', { className: 'encounter-order' }, running.combatants.map(combatant => el('li', { className: combatant.condition === 'Down' ? 'is-down' : null }, [
        el('strong', { text: combatant.label }), ' ',
        combatant.condition ? el('span', { className: 'npc-condition npc-condition-' + combatant.condition.toLowerCase(), text: combatant.condition }) : null
      ])))
    ]);
  }

  // Planned encounters that stay open when the table reloads.
  const openPlans = new Set();
  function encounterPlanner() {
    const encounters = data.encounters || {};
    if (!secretsOpen()) {
      const prepared = encounters.prepared || 0;
      return prepared ? el('p', { className: 'muted small', text: prepared + ' encounter' + (prepared === 1 ? ' is' : 's are') + " prepared by this adventure's DM." }) : null;
    }
    const budget = encounters.budget || { low: 0, moderate: 0, high: 0 };
    const levels = encounters.partyLevels || [];
    const name = el('input', { type: 'text', maxlength: '100', placeholder: 'New encounter, e.g. Ambush at the ford', 'aria-label': 'New encounter name' });
    const create = () => { if (name.value.trim()) act('/encounters', { name: name.value }, 'Encounter "' + name.value.trim() + '" created.'); };
    name.addEventListener('keydown', event => { if (event.key === 'Enter') create(); });
    const planned = (encounters.list || []).filter(item => item.status === 'planned');
    const done = (encounters.list || []).filter(item => item.status === 'done');
    const section = el('section', { className: 'adventure-encounters' }, [
      el('div', { className: 'sheet-section-heading' }, [el('h3', { text: 'Encounters' }), el('span', { className: 'muted small', text: 'Only you (and the Root DM) see these until you run one.' })]),
      el('p', { className: 'small' }, levels.length
        ? ['XP budget for the party (level' + (levels.length === 1 ? ' ' : 's ') + levels.join(', ') + '): ',
          el('span', { className: 'tag green', text: 'Low ' + thousands(budget.low) }), ' ',
          el('span', { className: 'tag gold', text: 'Moderate ' + thousands(budget.moderate) }), ' ',
          el('span', { className: 'tag red', text: 'High ' + thousands(budget.high) })]
        : [el('span', { className: 'muted', text: 'Add the party to see the XP budget.' })]),
      el('div', { className: 'table-filter' }, [name, button('Create', create, 'btn btn-small btn-green')]),
      ...planned.map(plannedCard),
      done.length ? el('details', { className: 'encounter-done' }, [
        el('summary', { className: 'small', text: done.length + ' finished encounter' + (done.length === 1 ? '' : 's') }),
        el('ul', {}, done.map(item => el('li', {}, [item.name + ' · ' + thousands(item.xp) + ' XP ', button('Delete', () => act('/encounters/' + item.id + '/delete', {}, item.name + ' deleted.'), 'link-button small')])))
      ]) : null
    ]);
    section.querySelectorAll('.encounter-card').forEach(card => card.addEventListener('toggle', () => {
      const id = Number(card.dataset.encounter);
      if (card.open) openPlans.add(id); else openPlans.delete(id);
    }));
    return section;
  }

  function finishForm() {
    const xp = el('input', { type: 'number', min: '1', max: '20', value: String(data.adventure.xp || 1), className: 'inventory-qty', 'aria-label': 'XP for each party member' });
    const reward = el('select', { 'aria-label': 'DM reward' });
    reward.add(new Option(data.adventure.dm ? 'Bank +1 DM point with ' + data.adventure.dm : 'No DM reward (DM not linked to a player)', ''));
    data.dmCharacters.forEach(character => reward.add(new Option('+1 XP to ' + character.name + ' (Lvl ' + character.level + ', ' + character.xp + ' XP)', String(character.id))));
    const title = el('input', { type: 'text', maxlength: '200', value: data.adventure.title, 'aria-label': 'Adventure title' });
    const notes = el('textarea', { rows: '3', maxlength: '4000', placeholder: 'What happened? (shown in the adventure history)', 'aria-label': 'Session notes' });
    notes.value = data.adventure.notes || '';
    const finish = button('Finish adventure & award XP', async () => {
      const count = data.party.length;
      if (!window.confirm('Finish "' + title.value + '"? ' + count + ' character' + (count === 1 ? '' : 's') + ' get ' + xp.value + ' XP each.')) return;
      const result = await act('/finish', { xp: Number(xp.value), dmCharacterId: reward.value ? Number(reward.value) : null, notes: notes.value, title: title.value },
        res => 'Adventure finished: ' + res.party + ' character(s) got ' + res.xp + ' XP.');
      if (result) {
        finishing = false;
        load();
      }
    }, 'btn btn-green');
    return el('div', { className: 'spell-picker adventure-finish' }, [
      el('h4', { text: 'Finish the adventure' }),
      el('div', { className: 'table-filter' }, [
        el('label', { className: 'table-filter-level' }, ['Title ', title]),
        el('label', { className: 'table-filter-level' }, ['XP each ', xp]),
        reward
      ]),
      notes,
      el('div', { className: 'vitals-actions' }, [finish, button('Not yet', () => { finishing = false; render(); }, 'btn btn-small btn-secondary')])
    ]);
  }

  // An adventure made in the panel: pick one of the open threads to tie it to.
  let threadPicker = null;
  function threadSection() {
    if (threadPicker) return threadPicker;
    const select = el('select', { 'aria-label': 'Discord thread' }, [el('option', { value: '', text: 'Loading open threads…' })]);
    const status = el('small', { className: 'muted', role: 'status' });
    const link = button('Link thread', async () => {
      if (!select.value) { status.textContent = 'Choose a thread first.'; return; }
      link.disabled = true;
      try {
        await api('/thread', { threadId: select.value });
        threadPicker = null;
        message = 'Linked to the Discord thread.';
        isError = false;
        load();
      } catch (error) {
        status.textContent = error.message;
        link.disabled = false;
      }
    }, 'btn btn-small btn-gold');
    threadPicker = el('div', { className: 'table-filter thread-link' }, [
      el('span', { className: 'muted small', text: 'No Discord thread yet:' }), select, link, status
    ]);
    api('/threads').then(result => {
      select.replaceChildren(el('option', { value: '', text: result.threads.length ? 'Choose an open thread…' : 'No open threads without an adventure' }),
        ...result.threads.map(thread => el('option', { value: thread.id, text: thread.name + (thread.createdAt ? ' (' + thread.createdAt.slice(0, 10) + ')' : '') })));
    }).catch(error => {
      select.replaceChildren(el('option', { value: '', text: 'Could not load threads' }));
      status.textContent = error.message;
    });
    return threadPicker;
  }

  // The DM speaks in the adventure's Discord thread under any name (Grimbrandt,
  // an NPC, "The Narrator"...). Built once, so a reload does not wipe a
  // half-written message; the last name and picture are remembered.
  let speakBox = null;
  const remember = (key, value) => { try { if (value === undefined) return localStorage.getItem(key) || ''; localStorage.setItem(key, value); } catch (error) { /* private window */ } return ''; };
  function speakSection() {
    if (!speakBox) {
      const speaker = el('select', { 'aria-label': 'Speak as' });
      const text = el('textarea', { rows: '3', maxlength: '2000', placeholder: 'What do they say? Markdown and @mentions work as in Discord.', 'aria-label': 'Message' });
      const status = el('small', { className: 'muted', role: 'status' });
      const send = button('Send to thread', async () => {
        if (!text.value.trim()) { status.textContent = 'Write a message first.'; return; }
        send.disabled = true;
        status.textContent = 'Sending…';
        try {
          const result = await api('/message', { npcId: speaker.value ? Number(speaker.value) : null, text: text.value });
          remember('speak-npc-' + adventureId, speaker.value);
          text.value = '';
          status.textContent = 'Sent as ' + result.as + (result.webhook ? '.' : ' (by the bot: it needs the Manage Webhooks permission to use the name itself).');
        } catch (error) {
          status.textContent = error.message;
        } finally {
          send.disabled = false;
        }
      }, 'btn btn-small btn-gold');
      text.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send.click(); });
      speakBox = el('details', { className: 'sheet-card speak-box' }, [
        el('summary', { text: '💬 Speak in the Discord thread' }),
        el('div', { className: 'table-filter' }, [
          el('label', { className: 'table-filter-level' }, ['Speak as ', speaker])
        ]),
        text,
        el('div', { className: 'vitals-actions' }, [send, status])
      ]);
      speakBox.speaker = speaker;
    }
    // Grimbrandt, the NPCs at the table, then the other Notable NPCs. The
    // choice survives reloads (and is remembered per adventure).
    const select = speakBox.speaker;
    const chosen = select.options.length ? select.value : remember('speak-npc-' + adventureId);
    const option = npc => el('option', { value: String(npc.id), text: npc.name });
    const atTable = data.npcs || [];
    const others = (data.npcCandidates || []).filter(npc => !atTable.some(entry => entry.id === npc.id));
    select.replaceChildren(...[
      el('option', { value: '', text: 'Grimbrandt (the chronicler)' }),
      atTable.length ? el('optgroup', { label: 'At the table' }, atTable.map(option)) : null,
      others.length ? el('optgroup', { label: 'Other Notable NPCs' }, others.map(option)) : null
    ].filter(Boolean));
    select.value = [...select.options].some(entry => entry.value === chosen) ? chosen : '';
    return speakBox;
  }

  // The party's latest rolls (made on their sheets or here by the DM).
  function rollLog() {
    const rolls = data.rolls || [];
    if (!rolls.length) return el('p', { className: 'muted small', text: 'No rolls yet. Rolls made on the party\'s character sheets show up here.' });
    return el('section', { className: 'sheet-card roll-log' }, [
      el('h4', { text: 'Latest rolls' }),
      el('ol', {}, rolls.map(roll => el('li', { className: roll.natural === 20 ? 'nat20' : roll.natural === 1 ? 'nat1' : null }, [
        el('span', { className: 'roll-log-total', text: roll.total === null ? '🔒' : String(roll.total) }),
        el('strong', { text: roll.character }), ' — ' + roll.label,
        roll.mode && roll.mode !== 'normal' ? el('span', { className: 'muted small', text: ' (' + roll.mode + ')' }) : null,
        roll.private ? el('span', { className: 'tag gold', text: 'GM only' }) : null,
        el('span', { className: 'muted small', text: ' ' + (roll.text || '').replace(/~~(\d+)~~/g, '($1)') + ' · ' + String(roll.createdAt || '').slice(11, 16) })
      ])))
    ]);
  }

  function render() {
    if (!data) return;
    const adventure = data.adventure;
    const active = adventure.status === 'active';
    const statusTag = active
      ? el('span', { className: 'tag green', text: 'Running' })
      : el('span', { className: 'tag' + (adventure.status === 'cancelled' ? ' red' : ''), text: adventure.status === 'cancelled' ? 'Cancelled' : 'Finished' });
    const controls = [];
    if (data.canTakeOver) {
      controls.push(button('Take over as DM', async () => {
        if (!window.confirm('Become the DM of "' + adventure.title + '"? You will see its NPC stats and hidden NPCs, and ' + (adventure.dm || 'everyone') + ' will see that you took over.')) return;
        await act('/takeover', {}, 'You are now the DM of this adventure.');
      }, 'btn btn-small btn-secondary', { title: "Only the adventure's DM sees its NPC stats and hidden NPCs." }));
    }
    if (data.canManage && active) {
      if (data.candidates.length) controls.push(partyPicker());
      controls.push(button('Finish adventure…', () => { finishing = true; render(); }, 'btn btn-small btn-gold'));
      controls.push(button('Cancel adventure', async () => {
        if (!window.confirm('Cancel "' + adventure.title + '"? Nobody gets XP for it.')) return;
        const result = await act('/cancel', {}, 'Adventure cancelled.');
        if (result) load();
      }, 'btn btn-small btn-red'));
    }
    root.replaceChildren(...[
      el('header', { className: 'adventure-table-header' }, [
        el('div', {}, [
          el('h2', {}, [adventure.title, ' ', statusTag]),
          el('p', { className: 'muted small' }, [
            'DM: ' + (adventure.dm || 'not linked to a player') + ' · started ' + String(adventure.startedAt || '').slice(0, 16),
            adventure.threadUrl ? ' · ' : null,
            adventure.threadUrl ? el('a', { href: adventure.threadUrl, target: '_blank', rel: 'noopener', text: 'Discord thread ↗' }) : null
          ]),
          (data.dmChanges || []).length ? el('p', { className: 'muted small' }, data.dmChanges.map(change => 'Taken over by ' + change.to + (change.from ? ' from ' + change.from : '') + ' on ' + String(change.at).slice(0, 10) + '. ')) : null
        ]),
        el('div', { className: 'muted small adventure-refresh' }, [
          active ? (live ? '● Live' : 'Reconnecting… (checks every ' + (REFRESH_MS / 1000) + ' s)') : '',
          updatedAt ? ' · ' + updatedAt.toLocaleTimeString() : '',
          ' ', button('Refresh', load, 'btn btn-small btn-secondary')
        ])
      ]),
      controls.length ? el('div', { className: 'table-filter' }, controls) : null,
      finishing && data.canManage && active ? finishForm() : null,
      data.canManage && !adventure.threadUrl ? threadSection() : null,
      data.canManage && adventure.threadUrl ? speakSection() : null,
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null,
      runningSection(),
      data.party.length
        ? el('div', { className: 'party-grid' }, data.party.map(memberCard))
        : el('p', { className: 'muted', text: data.canManage && active ? 'No one in the party yet: add the characters taking part above.' : 'No characters in this adventure.' }),
      npcSection(),
      encounterPlanner(),
      !active && adventure.notes ? el('div', { className: 'card' }, [el('h4', { text: 'Notes' }), el('p', { text: adventure.notes })]) : null,
      rollLog()
    ].filter(Boolean));
  }

  // A roll made here shows in the log straight away.
  document.addEventListener('grimbold-roll', () => load());
  load();
  // Not while the DM is typing (e.g. a damage amount): a reload rebuilds the
  // cards, so it waits until they leave the field.
  const typing = () => root.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  let reloadTimer = null;
  let reloadWaiting = false;
  function reloadSoon() {
    if (typing()) { reloadWaiting = true; return; }
    clearTimeout(reloadTimer);
    // Several changes at once (a long rest, a level-up) make one reload.
    reloadTimer = setTimeout(load, 250);
  }
  root.addEventListener('focusout', () => {
    setTimeout(() => { if (reloadWaiting && !typing()) { reloadWaiting = false; load(); } }, 0);
  });

  // Live updates: the server says when a party member, the party or the adventure changes.
  if (window.EventSource) {
    const source = new EventSource('/api/adventures/' + adventureId + '/live');
    source.onopen = () => { live = true; render(); };
    source.onerror = () => { live = false; render(); };
    source.onmessage = () => reloadSoon();
  }
  // Safety net while the adventure runs and the page is visible.
  setInterval(() => {
    if (document.visibilityState === 'visible' && data && data.adventure.status === 'active') reloadSoon();
  }, REFRESH_MS);
})();
