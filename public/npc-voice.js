// public/npc-voice.js — An NPC's voice page (views/tabs/npcs.js, ?voice=<id>):
// choose a channel or adventure thread, or players' DMs; write (Discord
// formatting, plus Glitch for the selected words); see it as Discord will
// show it; send. Below, what the NPC said and the players' replies, fetched
// again every 15 seconds while the page is open.

(function () {
  const root = document.getElementById('npc-voice');
  const app = document.getElementById('npc-voice-app');
  const historyRoot = document.getElementById('npc-voice-history');
  if (!root || !app || !historyRoot || !window.DiscordEditor || !window.DiscordPreview) return;
  const npcId = Number(root.dataset.npcId);
  const base = '/admin/npcs/' + npcId + '/voice';

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).flat(Infinity).forEach(child => {
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

  const clock = () => {
    const now = new Date();
    return 'Today at ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  };
  const when = value => String(value || '').replace('T', ' ').slice(0, 16) + ' UTC';

  async function start() {
    let data;
    try {
      const response = await fetch(base);
      data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load.');
    } catch (error) {
      app.replaceChildren(el('p', { className: 'alert red', text: error.message }));
      return;
    }
    const { npc, bot, places, recipients, limits } = data;
    // The NPC's own bot (voiceBot.js): its DMs come from that bot, as plain messages.
    const vb = data.voiceBot || { configured: false };
    const ownBot = Boolean(vb.configured && vb.linkedHere);
    const dmLimit = ownBot ? limits.channel : limits.dm;
    const dmSender = ownBot ? { name: vb.name || npc.name, avatarURL: vb.avatarURL } : bot;
    const messages = data.messages || [];
    let lastId = messages.reduce((max, message) => Math.max(max, message.id), 0);

    // ─── Where ──────────────────────────────────────────────────────────────
    const modeChannel = el('input', { type: 'radio', name: 'npc-voice-mode', value: 'channel', checked: true });
    const modeDm = el('input', { type: 'radio', name: 'npc-voice-mode', value: 'dm' });
    const mode = () => (modeDm.checked ? 'dm' : 'channel');
    const channelName = places.channel && places.channel.name ? '#' + places.channel.name : 'The speak channel';
    const place = el('select', { 'aria-label': 'Where' }, [
      el('option', { value: '', text: channelName }),
      places.adventures.length ? el('optgroup', { label: 'Adventure threads' }, places.adventures.map(adventure => el('option', { value: String(adventure.id), text: adventure.title }))) : null
    ]);
    const boxes = recipients.map(player => {
      const input = el('input', { type: 'checkbox', value: String(player.id) });
      return {
        player,
        input,
        label: el('label', { className: 'voice-recipient' }, [
          input, ' ', el('strong', { text: player.tag }),
          player.characters.length ? el('span', { className: 'muted', text: ' (' + player.characters.join(', ') + ')' }) : null
        ])
      };
    });
    const chosen = () => boxes.filter(box => box.input.checked);
    const allButton = el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'All' });
    const noneButton = el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'None' });
    allButton.addEventListener('click', () => { boxes.forEach(box => { box.input.checked = true; }); updatePreview(); });
    noneButton.addEventListener('click', () => { boxes.forEach(box => { box.input.checked = false; }); updatePreview(); });
    const color = el('input', { type: 'color', value: npc.color, 'aria-label': 'Card colour' });

    const channelOptions = el('div', { className: 'voice-options' }, [el('label', {}, ['Post in ', place])]);
    const dmOptions = el('div', { className: 'voice-options', hidden: true }, [
      el('fieldset', { className: 'voice-recipients' }, [
        el('legend', {}, ['Who gets it ', allButton, ' ', noneButton]),
        boxes.length ? boxes.map(box => box.label) : el('p', { className: 'muted', text: 'No players with a Discord account yet.' })
      ]),
      ownBot ? null : el('label', {}, ['Card colour ', color])
    ]);

    // ─── Text ───────────────────────────────────────────────────────────────
    const editor = window.DiscordEditor.create({ label: 'What ' + npc.name + ' says', placeholder: 'What does ' + npc.name + ' say? Format it with the buttons, or type Markdown as in Discord.' });
    const editable = editor.node.querySelector('.dc-editor-box');
    const toolbar = editor.node.querySelector('.dc-toolbar');
    const status = el('small', { className: 'muted', role: 'status' });
    const glitchButton = el('button', { type: 'button', className: 'dc-tool', title: 'Glitch the selected words', 'aria-label': 'Glitch the selected words', text: 'G̷l̸i̵t̶c̴h̷' });
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
    const counter = el('small', { className: 'muted voice-counter' });

    // ─── Preview ────────────────────────────────────────────────────────────
    const previewWhere = el('div', { className: 'dp-where' });
    const previewBody = el('div', { className: 'dp-window' });

    function avatar(url, name) {
      return url
        ? el('img', { className: 'dp-avatar', src: url, alt: '' })
        : el('div', { className: 'dp-avatar dp-avatar-blank', text: String(name || '?').trim().charAt(0).toUpperCase() });
    }

    function updatePreview() {
      const text = editor.markdown();
      const html = text ? window.DiscordPreview.render(text) : '<div class="dp-line dp-empty">Your message shows here as Discord will show it.</div>';
      const limit = mode() === 'dm' ? dmLimit : limits.channel;
      counter.textContent = text.length + ' / ' + limit;
      counter.classList.toggle('is-over', text.length > limit);
      if (mode() === 'dm' && ownBot) {
        const names = chosen().map(box => box.player.tag);
        previewWhere.textContent = '✉️ In ' + (names.length ? names.join(', ') + (names.length === 1 ? "'s" : "'") : "a player's") + ' DMs, from ' + dmSender.name + ' itself' + (names.length > 1 ? ' (each gets their own)' : '');
        previewBody.replaceChildren(el('div', { className: 'dp-message' }, [
          avatar(dmSender.avatarURL, dmSender.name),
          el('div', { className: 'dp-main' }, [
            el('div', { className: 'dp-head' }, [el('span', { className: 'dp-name', text: dmSender.name }), el('span', { className: 'dp-badge', text: 'APP' }), el('span', { className: 'dp-time', text: clock() })]),
            el('div', { className: 'dp-content', html })
          ])
        ]));
      } else if (mode() === 'dm') {
        const names = chosen().map(box => box.player.tag);
        previewWhere.textContent = '✉️ In ' + (names.length ? names.join(', ') + (names.length === 1 ? "'s" : "'") : "a player's") + ' DMs, from ' + bot.name + (names.length > 1 ? ' (each gets their own)' : '');
        const embed = el('div', { className: 'dp-embed' }, [
          el('div', { className: 'dp-embed-author' }, [npc.portraitUrl ? el('img', { src: npc.portraitUrl, alt: '' }) : null, el('span', { text: npc.name })]),
          el('div', { className: 'dp-embed-body', html })
        ]);
        embed.style.borderLeftColor = color.value;
        previewBody.replaceChildren(el('div', { className: 'dp-message' }, [
          avatar(bot.avatarURL, bot.name),
          el('div', { className: 'dp-main' }, [
            el('div', { className: 'dp-head' }, [el('span', { className: 'dp-name', text: bot.name }), el('span', { className: 'dp-badge', text: 'APP' }), el('span', { className: 'dp-time', text: clock() })]),
            embed
          ])
        ]));
      } else {
        previewWhere.textContent = '📢 In ' + (place.value ? 'the thread “' + place.options[place.selectedIndex].text + '”' : channelName);
        previewBody.replaceChildren(el('div', { className: 'dp-message' }, [
          avatar(npc.portraitUrl || bot.avatarURL, npc.name),
          el('div', { className: 'dp-main' }, [
            el('div', { className: 'dp-head' }, [el('span', { className: 'dp-name', text: npc.name }), el('span', { className: 'dp-badge', text: 'APP' }), el('span', { className: 'dp-time', text: clock() })]),
            el('div', { className: 'dp-content', html })
          ])
        ]));
      }
    }

    new MutationObserver(updatePreview).observe(editable, { childList: true, subtree: true, characterData: true, attributes: true });
    editable.addEventListener('input', updatePreview);
    [modeChannel, modeDm].forEach(input => input.addEventListener('change', () => {
      channelOptions.hidden = mode() === 'dm';
      dmOptions.hidden = mode() !== 'dm';
      send.textContent = mode() === 'dm' ? 'Send to their DMs' : 'Post as ' + npc.name;
      updatePreview();
    }));
    place.addEventListener('change', updatePreview);
    color.addEventListener('input', updatePreview);
    boxes.forEach(box => box.input.addEventListener('change', updatePreview));

    // ─── Send ───────────────────────────────────────────────────────────────
    const send = el('button', { type: 'button', className: 'btn btn-gold', text: 'Post as ' + npc.name });
    send.addEventListener('click', async () => {
      if (editor.isEmpty()) { status.textContent = 'Write something first.'; return; }
      const text = editor.markdown();
      const body = { target: mode(), text, color: color.value };
      if (mode() === 'dm') {
        const picked = chosen();
        if (!picked.length) { status.textContent = 'Choose who gets it.'; return; }
        if (!window.confirm('Send this as ' + npc.name + ' to ' + picked.map(box => box.player.tag).join(', ') + '?')) return;
        body.playerIds = picked.map(box => box.player.id);
      } else {
        body.adventureId = place.value ? Number(place.value) : null;
      }
      send.disabled = true;
      status.textContent = 'Sending…';
      try {
        const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not send.');
        const ok = result.results.filter(entry => entry.ok);
        const failed = result.results.filter(entry => !entry.ok);
        status.textContent = (ok.length ? (mode() === 'dm' ? 'Delivered to ' + ok.map(entry => entry.label).join(', ') + '.' : 'Posted' + (ok[0].webhook ? '.' : ' by Grimbold with the name on top: he needs the Manage Webhooks permission there to use ' + npc.name + "'s name and portrait.")) : '') +
          (failed.length ? ' Not delivered: ' + failed.map(entry => entry.label + ' (' + entry.error + ')').join(', ') + '.' : '');
        if (ok.length) editor.clear();
        updatePreview();
        await refresh();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        send.disabled = false;
      }
    });
    editor.onSubmit(() => send.click());

    // ─── The voice bot ──────────────────────────────────────────────────────
    const WARNING = 'Discord allows about two name changes an hour, and avatar changes are limited too. ' +
      'Every message this bot has ever sent, in every player\'s DMs, shows the new name and avatar from then on.';
    const since = value => {
      if (!value) return 'never from the panel';
      const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
      return minutes < 1 ? 'just now' : minutes < 120 ? minutes + ' min ago' : Math.round(minutes / 60) + ' h ago';
    };

    function botPanel() {
      if (!vb.configured) return null;
      const message = el('small', { className: 'muted', role: 'status' });
      async function act(body, question) {
        if (question && !window.confirm(question)) return;
        message.textContent = 'Asking Discord…';
        try {
          const response = await fetch('/admin/npcs/' + npcId + '/voice-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Did not work.');
          window.location.reload();
        } catch (error) {
          message.textContent = error.message;
        }
      }
      const button = (text, className, onClick, extra) => {
        const node = el('button', Object.assign({ type: 'button', className: 'btn btn-small ' + className, text }, extra || {}));
        node.addEventListener('click', onClick);
        return node;
      };
      const head = el('div', { className: 'voice-bot-head' }, [
        avatar(vb.avatarURL, vb.name || '?'),
        el('div', {}, [
          el('strong', { text: vb.name || 'Voice bot' }),
          el('div', { className: 'muted small', text: vb.ready ? 'Connected, invisible in the member list' : 'Not connected right now (is VOICE_BOT_TOKEN right?)' })
        ])
      ]);
      const body = [head];
      if (vb.linkedHere) {
        body.push(el('p', { className: 'small', text: 'Speaks for ' + npc.name + ': ' + npc.name + '\'s DMs come from this bot as ordinary messages, and replies to it show up below.' }));
        if (vb.canManage) {
          const name = el('input', { type: 'text', maxlength: '32', value: npc.name, 'aria-label': 'New bot name' });
          body.push(
            el('p', { className: 'voice-bot-warning small', text: '⚠️ ' + WARNING }),
            el('div', { className: 'vitals-actions' }, [
              name,
              button('Change name', 'btn-gold', () => act({ action: 'rename', name: name.value }, 'Rename the bot to “' + name.value.trim() + '”?\n\n' + WARNING)),
              el('small', { className: 'muted', text: 'last changed ' + since(vb.renamedAt) })
            ]),
            el('div', { className: 'vitals-actions' }, [
              button('Use ' + npc.name + '\'s portrait as its avatar', 'btn-gold', () => act({ action: 'avatar' }, 'Give the bot ' + npc.name + '\'s portrait as its avatar?\n\n' + WARNING), vb.hasPortrait ? {} : { disabled: true, title: 'Upload a portrait on the NPC form first' }),
              el('small', { className: 'muted', text: 'last changed ' + since(vb.avatarAt) })
            ]),
            el('div', { className: 'vitals-actions' }, [
              button('Stop speaking for ' + npc.name, 'btn-secondary', () => act({ action: 'unlink' }, npc.name + '\'s DMs will go back to Grimbold\'s cards. The bot keeps its name and avatar. Go ahead?'))
            ])
          );
        }
      } else {
        body.push(el('p', { className: 'small', text: vb.linkedTo ? 'It speaks for ' + vb.linkedTo + '.' : 'It speaks for no NPC yet; until then ' + npc.name + '\'s DMs come as Grimbold\'s cards.' }));
        if (vb.canManage) {
          body.push(el('div', { className: 'vitals-actions' }, [
            button('Let it speak for ' + npc.name, 'btn-gold', () => act({ action: 'link' }, vb.linkedTo
              ? 'The bot stops speaking for ' + vb.linkedTo + ' and speaks for ' + npc.name + ' instead. It keeps its current name and avatar until you change them. Go ahead?'
              : npc.name + '\'s DMs will come from this bot. Go ahead?'))
          ]));
        }
      }
      body.push(message);
      return el('details', { className: 'voice-bot', open: vb.linkedHere ? null : true }, [
        el('summary', {}, [el('strong', { text: '🤖 Voice bot' }), el('span', { className: 'muted small', text: vb.linkedHere ? ' · ' + (vb.name || '') + ' speaks for ' + npc.name : vb.linkedTo ? ' · speaks for ' + vb.linkedTo : ' · not in use' })]),
        ...body
      ]);
    }

    app.replaceChildren(el('div', { className: 'voice-layout' }, [
      el('div', { className: 'voice-compose' }, [
        botPanel(),
        el('div', { className: 'voice-modes', role: 'radiogroup', 'aria-label': 'Where' }, [
          el('label', {}, [modeChannel, ' 📢 In a channel']),
          el('label', {}, [modeDm, ownBot ? ' ✉️ In players\' DMs (from ' + dmSender.name + ')' : ' ✉️ In players\' DMs'])
        ]),
        channelOptions,
        dmOptions,
        editor.node,
        el('div', { className: 'vitals-actions' }, [send, counter, status])
      ]),
      el('div', { className: 'voice-preview' }, [el('h4', { text: 'Preview' }), previewWhere, previewBody])
    ]));
    updatePreview();

    // ─── What was said ─────────────────────────────────────────────────────
    function writeOnlyTo(playerId) {
      modeDm.checked = true;
      modeDm.dispatchEvent(new Event('change'));
      boxes.forEach(box => { box.input.checked = box.player.id === playerId; });
      updatePreview();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      editor.focus();
    }

    function renderHistory() {
      const groups = new Map();
      messages.forEach(message => {
        const key = message.target === 'dm' ? 'dm:' + message.discord_id : 'place:' + message.place_label;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(message);
      });
      const list = [...groups.entries()].sort((a, b) => b[1][b[1].length - 1].id - a[1][a[1].length - 1].id);
      if (!list.length) {
        historyRoot.replaceChildren(el('p', { className: 'muted', text: npc.name + ' has not said anything through the panel yet.' }));
        return;
      }
      historyRoot.replaceChildren(...list.map(([key, thread]) => {
        const isDm = key.startsWith('dm:');
        const first = thread[0];
        const player = isDm ? recipients.find(entry => entry.id === first.player_id) : null;
        const who = isDm ? (thread.find(message => message.discord_tag) || first).discord_tag || first.discord_id : null;
        const title = isDm ? '✉️ ' + who : '📢 ' + (first.place_label === 'speak channel' ? channelName : first.place_label);
        const replies = thread.filter(message => message.direction === 'in').length;
        return el('details', { className: 'card voice-thread', open: true }, [
          el('summary', {}, [
            el('strong', { text: title }),
            player && player.characters.length ? el('span', { className: 'muted', text: ' (' + player.characters.join(', ') + ')' }) : null,
            el('span', { className: 'muted small', text: ' · ' + thread.length + ' message' + (thread.length === 1 ? '' : 's') + (replies ? ', ' + replies + ' from them' : '') })
          ]),
          el('div', { className: 'voice-messages' }, thread.map(message => el('div', { className: 'voice-message ' + (message.direction === 'out' ? 'is-out' : 'is-in') + (message.status === 'failed' ? ' is-failed' : '') }, [
            el('div', { className: 'voice-meta small' }, [
              el('strong', { text: message.direction === 'out' ? npc.name : who }),
              ' · ' + when(message.created_at),
              message.status === 'failed' ? el('span', { className: 'tag red', text: 'not delivered: ' + (message.error || 'failed') }) : null
            ]),
            el('div', { className: 'voice-text', html: window.DiscordPreview.render(message.text) })
          ]))),
          player ? (() => {
            const button = el('button', { type: 'button', className: 'btn btn-small btn-secondary', text: 'Write to only them' });
            button.addEventListener('click', () => writeOnlyTo(player.id));
            return button;
          })() : null
        ]);
      }));
    }

    async function refresh() {
      try {
        const response = await fetch(base + '/messages?after=' + lastId);
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
  }

  start();
})();
