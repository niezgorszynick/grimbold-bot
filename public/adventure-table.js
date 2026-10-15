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
        el('div', {}, [nameNode, el('div', { className: 'muted small', text: member.player + ' · ' + (member.species || '') + ' · ' + classes })]),
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
      act('/npcs', { npcId: Number(select.value), inAdventure: true }, (chosen ? chosen.name : 'NPC') + ' joined the table.');
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

  function npcCard(npc) {
    const manage = data.canManage && data.adventure.status === 'active';
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
    return el('article', { className: 'party-card npc-table-card' + (hp && hp.current === 0 ? ' is-down' : '') }, [
      el('header', { className: 'party-card-header' }, [
        npc.portraitUrl ? el('img', { className: 'npc-portrait npc-portrait-small', src: npc.portraitUrl, alt: '', loading: 'lazy' }) : null,
        el('div', { className: 'npc-table-name' }, [
          el('a', { className: 'roster-name', href: '/admin?tab=npcs#npc-' + npc.id, target: '_blank', rel: 'noopener', text: npc.name }),
          el('div', { className: 'muted small', text: ['NPC', npc.affiliation].filter(Boolean).join(' · ') })
        ]),
        remove
      ]),
      stats ? hpBlock(hp) : (npc.description ? el('p', { className: 'muted small npc-table-description', text: npc.description }) : null),
      actions,
      stats ? el('div', { className: 'party-stats' }, [
        stat('AC', stats.armorClass ?? '—', 'Armor Class'),
        stats.speed ? stat('Speed', stats.speed) : null
      ].filter(Boolean)) : null,
      abilities.length ? el('div', { className: 'party-line' }, [
        el('span', { className: 'party-label', text: 'Scores' }),
        abilities.map(ability => ability.toUpperCase() + ' ' + stats.abilities[ability].score + ' (' + signed(stats.abilities[ability].modifier) + ')').join(' · ')
      ]) : null,
      npc.personality ? el('div', { className: 'party-line' }, [el('span', { className: 'party-label', text: 'Personality' }), npc.personality]) : null
    ]);
  }

  function npcSection() {
    const manage = data.canManage && data.adventure.status === 'active';
    if (!data.npcs.length && !(manage && data.npcCandidates.length)) return null;
    return el('section', { className: 'adventure-npcs' }, [
      el('div', { className: 'sheet-section-heading' }, [el('h3', { text: 'Notable NPCs' }), manage && data.npcCandidates.length ? npcPicker() : null]),
      data.npcs.length ? el('div', { className: 'party-grid' }, data.npcs.map(npcCard)) : el('p', { className: 'muted small', text: 'No NPCs at the table.' })
    ]);
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
          ])
        ]),
        el('div', { className: 'muted small adventure-refresh' }, [
          active ? (live ? '● Live' : 'Reconnecting… (checks every ' + (REFRESH_MS / 1000) + ' s)') : '',
          updatedAt ? ' · ' + updatedAt.toLocaleTimeString() : '',
          ' ', button('Refresh', load, 'btn btn-small btn-secondary')
        ])
      ]),
      controls.length ? el('div', { className: 'table-filter' }, controls) : null,
      finishing && data.canManage && active ? finishForm() : null,
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null,
      data.party.length
        ? el('div', { className: 'party-grid' }, data.party.map(memberCard))
        : el('p', { className: 'muted', text: data.canManage && active ? 'No one in the party yet: add the characters taking part above.' : 'No characters in this adventure.' }),
      npcSection(),
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
