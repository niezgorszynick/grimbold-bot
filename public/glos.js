// public/glos.js — The Głos tab (views/tabs/glos.js): choose players, write
// the message (Discord formatting, plus ⸸ Glitch for the selected words) and
// send it; below, one conversation per player, with their replies. New
// replies are fetched every 15 seconds while the tab is open.

(function () {
  const app = document.getElementById('glos-app');
  const historyRoot = document.getElementById('glos-history');
  const dataNode = document.getElementById('glos-data');
  if (!app || !historyRoot || !dataNode || !window.DiscordEditor) return;
  const data = JSON.parse(dataNode.textContent);
  const messages = data.messages || [];
  const recipients = data.recipients || [];
  let lastId = messages.reduce((max, message) => Math.max(max, message.id), 0);

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

  // Combining marks over most letters: t̷h̸e̵y̶ ̴k̷n̸o̵w̶.
  function glitch(text) {
    const mark = () => String.fromCharCode(0x0300 + Math.floor(Math.random() * 0x70));
    return [...text].map(char => {
      if (!/\S/.test(char) || Math.random() < 0.3) return char;
      let out = char;
      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) out += mark();
      return out;
    }).join('');
  }

  // ─── Composer ─────────────────────────────────────────────────────────────

  const boxes = recipients.map(player => {
    const input = el('input', { type: 'checkbox', value: String(player.id) });
    const label = el('label', { className: 'glos-recipient' }, [
      input, ' ', el('strong', { text: player.tag }),
      player.characters.length ? el('span', { className: 'muted', text: ' — ' + player.characters.join(', ') }) : null
    ]);
    return { player, input, label };
  });
  const all = el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'All' });
  const none = el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'None' });
  all.addEventListener('click', () => boxes.forEach(box => { box.input.checked = true; }));
  none.addEventListener('click', () => boxes.forEach(box => { box.input.checked = false; }));

  const editor = window.DiscordEditor.create({ label: 'What Głos says', placeholder: 'What does the Voice whisper? Each chosen player gets it on their own.' });
  const editable = editor.node.querySelector('.dc-editor-box');
  const toolbar = editor.node.querySelector('.dc-toolbar');
  const glitchButton = el('button', { type: 'button', className: 'dc-tool', title: 'Glitch the selected words', 'aria-label': 'Glitch the selected words', text: '⸸ Glitch' });
  glitchButton.addEventListener('mousedown', event => event.preventDefault());
  glitchButton.addEventListener('click', () => {
    const selection = document.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || range.collapsed || !editable.contains(range.commonAncestorContainer)) {
      status.textContent = 'Select the words to glitch first.';
      return;
    }
    document.execCommand('insertText', false, glitch(range.toString()));
  });
  if (toolbar) toolbar.append(glitchButton);

  const image = el('input', { type: 'url', placeholder: 'https://… (optional)', className: 'glos-image' });
  const status = el('small', { className: 'muted', role: 'status' });
  const send = el('button', { type: 'button', className: 'btn btn-small btn-red', text: 'Send as Głos' });

  send.addEventListener('click', async () => {
    const playerIds = boxes.filter(box => box.input.checked).map(box => box.player.id);
    if (!playerIds.length) { status.textContent = 'Choose who hears it.'; return; }
    if (editor.isEmpty()) { status.textContent = 'Write something first.'; return; }
    const text = editor.markdown();
    if (text.length > data.maxText) { status.textContent = 'Too long: ' + text.length + ' characters (Discord takes ' + data.maxText + ').'; return; }
    const names = boxes.filter(box => box.input.checked).map(box => box.player.tag).join(', ');
    if (!window.confirm('Send this as Głos to ' + names + '?')) return;
    send.disabled = true;
    status.textContent = 'Sending…';
    try {
      const response = await fetch('/admin/glos/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerIds, text, imageUrl: image.value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not send.');
      const ok = result.results.filter(entry => entry.ok).map(entry => entry.tag);
      const failed = result.results.filter(entry => !entry.ok).map(entry => entry.tag + ' (' + entry.error + ')');
      status.textContent = (ok.length ? 'Delivered to ' + ok.join(', ') + '.' : '') + (failed.length ? ' Not delivered: ' + failed.join(', ') + '.' : '');
      if (ok.length) { editor.clear(); image.value = ''; }
      await refresh();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      send.disabled = false;
    }
  });
  editor.onSubmit(() => send.click());

  app.replaceChildren(
    el('fieldset', { className: 'glos-recipients' }, [
      el('legend', {}, ['Who hears it ', all, ' ', none]),
      recipients.length ? boxes.map(box => box.label) : el('p', { className: 'muted', text: 'No players with a Discord account yet.' })
    ]),
    editor.node,
    el('label', { className: 'glos-image-label' }, ['Image ', image]),
    el('div', { className: 'vitals-actions' }, [send, status])
  );

  // ─── Conversations ────────────────────────────────────────────────────────

  const when = value => String(value || '').replace('T', ' ').slice(0, 16) + ' UTC';

  function writeOnlyTo(playerId) {
    boxes.forEach(box => { box.input.checked = box.player.id === playerId; });
    app.scrollIntoView({ behavior: 'smooth', block: 'start' });
    editor.focus();
  }

  function renderHistory() {
    const byPerson = new Map();
    messages.forEach(message => {
      const key = message.discord_id;
      if (!byPerson.has(key)) byPerson.set(key, []);
      byPerson.get(key).push(message);
    });
    const threads = [...byPerson.values()].sort((a, b) => b[b.length - 1].id - a[a.length - 1].id);
    if (!threads.length) {
      historyRoot.replaceChildren(el('p', { className: 'muted', text: 'Głos has not spoken to anyone yet.' }));
      return;
    }
    historyRoot.replaceChildren(...threads.map(thread => {
      const first = thread[0];
      const player = recipients.find(entry => entry.id === first.player_id);
      const name = first.discord_tag || (player && player.tag) || first.discord_id;
      const replies = thread.filter(message => message.direction === 'in').length;
      return el('details', { className: 'card glos-thread', open: true }, [
        el('summary', {}, [
          el('strong', { text: name }),
          player && player.characters.length ? el('span', { className: 'muted', text: ' — ' + player.characters.join(', ') }) : null,
          el('span', { className: 'muted small', text: ' · ' + thread.length + ' message' + (thread.length === 1 ? '' : 's') + (replies ? ', ' + replies + ' from them' : '') })
        ]),
        el('div', { className: 'glos-messages' }, thread.map(message => el('div', { className: 'glos-message ' + (message.direction === 'out' ? 'is-out' : 'is-in') + (message.status === 'failed' ? ' is-failed' : '') }, [
          el('div', { className: 'glos-meta small' }, [
            el('strong', { text: message.direction === 'out' ? '👁 Głos' : name }),
            ' · ' + when(message.created_at),
            message.status === 'failed' ? el('span', { className: 'tag red', text: 'not delivered: ' + (message.error || 'failed') }) : null
          ]),
          el('div', { className: 'glos-text', text: message.text }),
          message.image_url ? el('a', { href: message.image_url, target: '_blank', rel: 'noopener', className: 'small', text: '🖼 ' + message.image_url }) : null
        ]))),
        player ? el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Write to only them' }) : null
      ]);
    }));
    historyRoot.querySelectorAll('.glos-thread').forEach((card, index) => {
      const button = card.querySelector(':scope > .btn');
      const thread = threads[index];
      if (button) button.addEventListener('click', () => writeOnlyTo(thread[0].player_id));
    });
  }

  async function refresh() {
    try {
      const response = await fetch('/admin/glos/messages?after=' + lastId);
      if (!response.ok) return;
      const result = await response.json();
      if (!result.messages.length) return;
      messages.push(...result.messages);
      lastId = messages.reduce((max, message) => Math.max(max, message.id), lastId);
      renderHistory();
    } catch (error) { /* offline for a moment */ }
  }

  renderHistory();
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
})();
