// public/campaigns.js — The Sessions tab's Campaigns card: the campaigns this
// account runs (every one for DMs and Root). Book, move and cancel their
// sessions and add or remove players; each change is announced in the
// campaign's Discord channel, as /campaign there does.

(function () {
  const root = document.getElementById('campaigns-panel');
  if (!root) return;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).flat().forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }
  const button = (text, onclick, className = 'btn btn-small') => el('button', { type: 'button', className, text, onclick });

  let data = null;
  let message = '';
  let isError = false;

  async function api(path, body) {
    const response = await fetch('/api/campaigns' + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the campaigns.');
    return result;
  }

  async function act(path, body, done) {
    try {
      const result = await api(path, body);
      data = result;
      const note = result.note;
      message = done + (note
        ? (note.posted ? " Announced in the campaign's channel." : " (Discord not reached: announce it yourself.)") +
          (note.eventProblem ? ' Server event: ' + note.eventProblem + '.' : '') +
          (note.clashes && note.clashes.length ? ' ⚠️ You are also in ' + note.clashes.join(', ') + ' then.' : '')
        : '');
      isError = false;
    } catch (error) {
      message = error.message;
      isError = true;
    }
    render();
  }

  function sessionInputs(values) {
    const date = el('input', { type: 'date', value: values.date || '', 'aria-label': 'Date' });
    const time = el('input', { type: 'time', step: '900', value: values.time || '20:00', 'aria-label': 'Start (Polish time)' });
    const hours = el('input', { type: 'number', min: '0.5', max: '12', step: '0.5', value: String(values.hours || 4), className: 'inventory-qty', 'aria-label': 'Hours' });
    return { date, time, hours, values: () => ({ date: date.value, time: time.value, hours: hours.value }), nodes: [date, time, el('label', { className: 'small' }, [hours, ' h'])] };
  }

  function campaignBlock(campaign) {
    const base = '/' + campaign.id;
    const rows = campaign.sessions.map(session => {
      const inputs = sessionInputs(session);
      return el('li', {}, [
        el('strong', { text: session.text }), ' ',
        el('span', { className: 'schedule-move' }, [...inputs.nodes,
          button('Move', () => act(base + '/sessions/' + session.id, inputs.values(), 'Session moved.')),
          button('Cancel', () => {
            if (window.confirm('Cancel the ' + campaign.name + ' session on ' + session.text + '? Its players are told in Discord.')) act(base + '/sessions/' + session.id + '/cancel', {}, 'Session cancelled.');
          }, 'btn btn-small btn-red')])
      ]);
    });
    const book = sessionInputs({});
    const memberIds = new Set(campaign.members.map(member => member.discordId));
    const pick = el('select', { 'aria-label': 'Player to add' }, [el('option', { value: '', text: 'Add a player…' }),
      ...data.players.filter(player => !memberIds.has(player.discordId)).map(player => el('option', { value: player.discordId, text: player.name }))]);
    pick.addEventListener('change', () => { if (pick.value) act(base + '/members', { discordId: pick.value, member: true }, 'Player added.'); });
    return el('div', { className: 'campaign-block' }, [
      el('div', {}, [el('strong', { text: campaign.name }),
        campaign.dm ? el('span', { className: 'muted small', text: ' · DM ' + campaign.dm }) : null,
        campaign.channelUrl ? [' ', el('a', { className: 'muted small', href: campaign.channelUrl, target: '_blank', rel: 'noopener', text: 'channel' })] : null]),
      el('div', { className: 'campaign-members small' }, [
        '👥',
        ...(campaign.members.length ? campaign.members.map(member => el('span', { className: 'tag' }, [member.name, ' ',
          el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: '×', title: 'Take ' + member.name + ' off', onclick: () => act(base + '/members', { discordId: member.discordId, member: false }, 'Player removed.') })]))
          : [el('span', { className: 'muted', text: 'No players yet.' })]),
        pick
      ]),
      campaign.sessions.length ? el('ul', { className: 'schedule-list' }, rows) : el('p', { className: 'muted small', text: 'No session booked.' }),
      el('div', { className: 'table-filter' }, [el('span', { className: 'small', text: 'Book a session:' }), ...book.nodes,
        button('Book', () => act(base + '/sessions', book.values(), 'Session booked.'), 'btn btn-small btn-green')])
    ]);
  }

  function render() {
    // Shown to those who run a campaign, and to DMs.
    if (!data || (!data.campaigns.length && !data.canCreate)) { root.hidden = true; return; }
    root.hidden = false;
    root.replaceChildren(...[
      el('h3', { text: '📜 Campaigns' }),
      el('p', { className: 'muted small', text: "Campaigns outside the adventure threads. Polish time; changes are announced in the campaign's Discord channel and move its server event. Start one in Discord with /campaign create, in the channel it should post in." }),
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null,
      ...(data.campaigns.length ? data.campaigns.map(campaignBlock) : [el('p', { className: 'muted', text: 'No campaigns yet.' })])
    ].filter(Boolean));
  }

  api('').then(result => { data = result; render(); }).catch(() => {});
})();
