// public/adventure-table.js — The live table of a running adventure: one card
// per party member (HP, AC, slots, saves, ...), refreshed every few seconds so
// changes players make on their sheets show up. The adventure's DM (and
// admins) put the party together and finish the adventure here.

(function () {
  const root = document.getElementById('adventure-table');
  if (!root) return;
  const adventureId = Number(root.dataset.adventureId);
  const viewerIsAdmin = root.dataset.isAdmin === 'true';
  const REFRESH_MS = 15000;
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

  function memberCard(member) {
    const classes = member.classes.map(row => row.className + ' ' + row.level + (row.subclassName ? ' (' + row.subclassName + ')' : '')).join(' / ');
    const flags = [];
    if (member.status !== 'alive') flags.push(el('span', { className: 'tag red', text: 'Dead' }));
    if (member.concentration) flags.push(el('span', { className: 'tag gold', text: 'Concentrating: ' + member.concentration }));
    if (member.exhaustion) flags.push(el('span', { className: 'tag red', text: 'Exhaustion ' + member.exhaustion }));
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
      member.hitDice.length ? el('div', { className: 'party-line' }, [
        el('span', { className: 'party-label', text: 'Hit Dice' }),
        member.hitDice.map(dice => (dice.total - dice.spent) + '/' + dice.total + ' ' + dice.die).join(', ')
      ]) : null,
      member.attacks.length ? el('div', { className: 'party-line party-attacks' }, [
        el('span', { className: 'party-label', text: 'Attacks' }),
        el('span', {}, member.attacks.map(attack => el('span', { className: 'party-attack' }, [
          el('strong', { text: attack.name }), ' ', rollIf('attack:' + attack.index + ':hit', attack.attackBonus, 'Roll to hit'), ', ',
          rollIf('attack:' + attack.index + ':damage', attack.damage, 'Roll damage')
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
          active ? 'Updates every ' + (REFRESH_MS / 1000) + ' s' : '',
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
      !active && adventure.notes ? el('div', { className: 'card' }, [el('h4', { text: 'Notes' }), el('p', { text: adventure.notes })]) : null,
      rollLog()
    ].filter(Boolean));
  }

  // A roll made here shows in the log straight away.
  document.addEventListener('grimbold-roll', () => load());
  load();
  // Live updates while the adventure runs and the page is visible.
  setInterval(() => {
    if (document.visibilityState === 'visible' && data && data.adventure.status === 'active') load();
  }, REFRESH_MS);
})();
