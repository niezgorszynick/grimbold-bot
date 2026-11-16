// public/character-speak.js — "Speak in Discord" on the character sheet: the
// player says something as their character (name and portrait), in the speak
// channel or the thread of a running adventure the character is in. The same
// posting as the adventure table's (adventureThreads.js). The last place is
// remembered per character in this browser.

(function () {
  const root = document.getElementById('cs_speak');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);
  const KEY = 'speak-place-character-' + characterId;
  const remember = value => {
    try {
      if (value === undefined) return localStorage.getItem(KEY) || '';
      localStorage.setItem(KEY, value);
    } catch (error) { /* private window */ }
    return '';
  };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  async function request(body) {
    const response = await fetch('/api/characters/' + characterId + '/speak', {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not reach Discord.');
    return result;
  }

  const place = el('select', { 'aria-label': 'Send to' }, [el('option', { value: '', text: 'Loading…' })]);
  const text = el('textarea', { rows: '3', maxlength: '2000', placeholder: 'What does your character say? Markdown and @mentions work as in Discord.', 'aria-label': 'Message' });
  const status = el('small', { className: 'muted', role: 'status' });
  const send = el('button', { type: 'button', className: 'btn btn-small btn-gold', text: 'Send' });

  // The places load when the card is first opened (and again on each open, so
  // a newly joined adventure shows up).
  async function loadPlaces() {
    try {
      const result = await request();
      const chosen = place.value || remember();
      place.replaceChildren(
        el('option', { value: '', text: result.channel && result.channel.name ? '#' + result.channel.name : 'The roleplay channel' }),
        ...(result.adventures.length
          ? [el('optgroup', { label: 'Adventure threads' }, result.adventures.map(adventure => el('option', { value: String(adventure.id), text: adventure.title })))]
          : [])
      );
      place.value = [...place.options].some(option => option.value === chosen) ? chosen : '';
    } catch (error) {
      status.textContent = error.message;
    }
  }

  send.addEventListener('click', async () => {
    if (!text.value.trim()) { status.textContent = 'Write a message first.'; return; }
    send.disabled = true;
    status.textContent = 'Sending…';
    try {
      const result = await request({ text: text.value, adventureId: place.value ? Number(place.value) : null });
      remember(place.value);
      text.value = '';
      status.textContent = 'Sent as ' + result.as + (result.webhook ? '.' : ' (by the bot: it needs the Manage Webhooks permission to use the name itself).');
    } catch (error) {
      status.textContent = error.message;
    } finally {
      send.disabled = false;
    }
  });
  text.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send.click(); });

  const box = el('details', { className: 'speak-box' }, [
    el('summary', { text: '💬 Speak in Discord' }),
    el('div', { className: 'table-filter' }, [el('label', { className: 'table-filter-level' }, ['Send to ', place])]),
    text,
    el('div', { className: 'vitals-actions' }, [send, status])
  ]);
  box.addEventListener('toggle', () => { if (box.open) loadPlaces(); });
  root.replaceChildren(box);
})();
