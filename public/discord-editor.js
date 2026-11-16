// public/discord-editor.js — A small rich-text box for messages sent to
// Discord (the adventure table's and the character sheet's "Speak in
// Discord"): bold, italic, underline, strikethrough, spoiler, code and quote
// show as they will look, and the text goes out as Discord Markdown. Typed
// Markdown (**like this**) passes through unchanged; pasted text is plain.
//
// window.DiscordEditor.create({ placeholder, label }) →
//   { node, focus(), clear(), isEmpty(), markdown(), onSubmit(fn) }
// toDiscordMarkdown(root) is also exported for tests (Node).

(function (global) {
  // Inner to outer: code innermost, since nothing renders inside it.
  const MARKS = [
    { key: 'spoiler', mark: '||' },
    { key: 'bold', mark: '**' },
    { key: 'italic', mark: '*' },
    { key: 'underline', mark: '__' },
    { key: 'strike', mark: '~~' },
    { key: 'code', mark: '`' }
  ];
  const BLOCKS = new Set(['DIV', 'P', 'BLOCKQUOTE', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE']);

  // The formats an element adds (by tag, class or inline style, as browsers
  // write them in contenteditable).
  function formatsOf(node) {
    const tag = String(node.nodeName || '').toUpperCase();
    const style = String((node.getAttribute && node.getAttribute('style')) || '').toLowerCase();
    const cls = ' ' + String(node.className || '') + ' ';
    const found = [];
    if (tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(style)) found.push('bold');
    if (tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(style)) found.push('italic');
    if (tag === 'U' || /text-decoration[^;]*underline/.test(style)) found.push('underline');
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /text-decoration[^;]*line-through/.test(style)) found.push('strike');
    if (tag === 'CODE' || cls.includes(' dc-code ')) found.push('code');
    if (cls.includes(' dc-spoiler ')) found.push('spoiler');
    return found;
  }

  // The editor's content → lines of characters, each with its formats.
  function collectLines(root) {
    const lines = [{ chars: [], quote: false }];
    const current = () => lines[lines.length - 1];
    const newline = quote => lines.push({ chars: [], quote });
    let blockEnded = false;

    function walk(node, formats, quote) {
      if (node.nodeType === 3) {
        const text = String(node.nodeValue || '').replace(/ /g, ' ').replace(/​/g, '');
        if (!text) return;
        if (blockEnded && current().chars.length) newline(quote);
        blockEnded = false;
        for (const ch of text) {
          if (ch === '\n') { newline(quote); continue; }
          current().chars.push({ ch, formats });
          current().quote = quote;
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = String(node.nodeName).toUpperCase();
      if (tag === 'BR') { current().quote = current().quote || quote; newline(quote); blockEnded = false; return; }
      const inQuote = quote || tag === 'BLOCKQUOTE';
      const block = BLOCKS.has(tag);
      if (block) {
        if (current().chars.length) newline(inQuote);
        else current().quote = inQuote;
        blockEnded = false;
      }
      const added = formatsOf(node).filter(key => !formats.includes(key));
      const inner = added.length ? formats.concat(added) : formats;
      (node.childNodes ? Array.from(node.childNodes) : []).forEach(child => walk(child, inner, inQuote));
      if (block) blockEnded = true;
    }
    (root.childNodes ? Array.from(root.childNodes) : []).forEach(child => walk(child, [], false));
    while (lines.length > 1 && !current().chars.length) lines.pop();
    return lines;
  }

  // One line of formatted characters → Markdown. Spaces at the edge of a
  // format move outside its markers ("** bold**" doesn't render in Discord).
  function lineToMarkdown(chars) {
    const keyOf = formats => MARKS.filter(entry => formats.includes(entry.key)).map(entry => entry.key);
    const items = chars.map(item => ({ ch: item.ch, formats: keyOf(item.formats) }));
    const isSpace = item => /\s/.test(item.ch);
    items.forEach((item, index) => {
      if (!isSpace(item)) return;
      let before = null;
      for (let i = index - 1; i >= 0; i -= 1) if (!isSpace(items[i])) { before = items[i].formats; break; }
      let after = null;
      for (let i = index + 1; i < items.length; i += 1) if (!isSpace(items[i])) { after = items[i].formats; break; }
      item.formats = before && after ? before.filter(key => after.includes(key)) : [];
    });

    let out = '';
    let open = [];
    const markOf = key => MARKS.find(entry => entry.key === key).mark;
    const close = count => {
      for (let i = 0; i < count; i += 1) out += markOf(open.pop());
    };
    for (const item of items) {
      let keep = 0;
      while (keep < open.length && item.formats.includes(open[keep])) keep += 1;
      close(open.length - keep);
      for (const key of item.formats) {
        if (!open.includes(key)) { out += markOf(key); open.push(key); }
      }
      out += item.ch;
    }
    close(open.length);
    return out;
  }

  function toDiscordMarkdown(root) {
    return collectLines(root)
      .map(line => {
        const text = lineToMarkdown(line.chars);
        return line.quote ? (text ? '> ' + text : '>') : text;
      })
      .join('\n')
      .trim();
  }

  if (typeof module === 'object' && module.exports) module.exports = { toDiscordMarkdown };
  if (!global || !global.document) return;
  const document = global.document;

  // ─── The editor in the page ────────────────────────────────────────────────

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => { if (child) node.append(child); });
    return node;
  }

  function create({ placeholder = '', label = 'Message' } = {}) {
    const box = el('div', {
      className: 'dc-editor-box', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
      'aria-label': label, 'data-placeholder': placeholder, spellcheck: 'true'
    });
    let submit = null;

    const selectionInBox = () => {
      const selection = document.getSelection();
      if (!selection || !selection.rangeCount) return null;
      const range = selection.getRangeAt(0);
      return box.contains(range.commonAncestorContainer) ? range : null;
    };
    const enclosing = (node, test) => {
      for (let at = node; at && at !== box; at = at.parentNode) if (at.nodeType === 1 && test(at)) return at;
      return null;
    };

    // Spoiler and code: wrap the selection in a span (or unwrap it).
    function toggleWrap(className) {
      const range = selectionInBox();
      if (!range) return;
      const found = enclosing(range.commonAncestorContainer, node => node.classList.contains(className));
      if (found) {
        found.replaceWith(...found.childNodes);
        return;
      }
      if (range.collapsed) return;
      const span = el('span', { className });
      span.append(range.extractContents());
      range.insertNode(span);
      const selection = document.getSelection();
      selection.removeAllRanges();
      const chosen = document.createRange();
      chosen.selectNodeContents(span);
      selection.addRange(chosen);
    }

    function toggleQuote() {
      const range = selectionInBox();
      if (!range) return;
      const inQuote = enclosing(range.startContainer, node => node.nodeName === 'BLOCKQUOTE');
      document.execCommand('formatBlock', false, inQuote ? 'div' : 'blockquote');
    }

    const TOOLS = [
      { key: 'bold', text: 'B', title: 'Bold (Ctrl+B)', run: () => document.execCommand('bold'), state: 'bold' },
      { key: 'italic', text: 'I', title: 'Italic (Ctrl+I)', run: () => document.execCommand('italic'), state: 'italic' },
      { key: 'underline', text: 'U', title: 'Underline (Ctrl+U)', run: () => document.execCommand('underline'), state: 'underline' },
      { key: 'strike', text: 'S', title: 'Strikethrough', run: () => document.execCommand('strikeThrough'), state: 'strikeThrough' },
      { key: 'spoiler', text: '▒', title: 'Spoiler (hidden until clicked in Discord)', run: () => toggleWrap('dc-spoiler') },
      { key: 'code', text: '</>', title: 'Code', run: () => toggleWrap('dc-code') },
      { key: 'quote', text: '❝', title: 'Quote', run: toggleQuote }
    ];
    const buttons = TOOLS.map(tool => {
      const button = el('button', { type: 'button', className: 'dc-tool dc-tool-' + tool.key, title: tool.title, 'aria-label': tool.title, text: tool.text });
      // Keep the selection in the box while clicking.
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        if (!selectionInBox()) box.focus();
        tool.run();
        updateTools();
      });
      return { tool, button };
    });

    function updateTools() {
      const range = selectionInBox();
      buttons.forEach(({ tool, button }) => {
        let on = false;
        if (range) {
          if (tool.state) {
            try { on = document.queryCommandState(tool.state); } catch (error) { on = false; }
          } else if (tool.key === 'quote') {
            on = Boolean(enclosing(range.startContainer, node => node.nodeName === 'BLOCKQUOTE'));
          } else {
            on = Boolean(enclosing(range.startContainer, node => node.classList.contains('dc-' + tool.key)));
          }
        }
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-pressed', String(on));
      });
    }

    const syncEmpty = () => box.classList.toggle('is-empty', !box.textContent.replace(/​/g, '').trim() && !box.querySelector('img'));
    box.addEventListener('focus', () => {
      try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (error) { /* older browsers */ }
    });
    box.addEventListener('input', syncEmpty);
    // Paste and drop as plain text: the formatting is made here, not copied in.
    box.addEventListener('paste', event => {
      event.preventDefault();
      const text = (event.clipboardData || global.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    box.addEventListener('drop', event => {
      const text = event.dataTransfer && event.dataTransfer.getData('text/plain');
      if (!text) return;
      event.preventDefault();
      document.execCommand('insertText', false, text);
    });
    box.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && submit) { event.preventDefault(); submit(); }
    });
    document.addEventListener('selectionchange', () => { if (selectionInBox() || document.activeElement === box) updateTools(); });
    syncEmpty();

    const node = el('div', { className: 'dc-editor' }, [
      el('div', { className: 'dc-toolbar', role: 'toolbar', 'aria-label': 'Formatting' }, buttons.map(entry => entry.button)),
      box
    ]);
    return {
      node,
      focus: () => box.focus(),
      clear: () => { box.replaceChildren(); syncEmpty(); updateTools(); },
      isEmpty: () => !toDiscordMarkdown(box),
      markdown: () => toDiscordMarkdown(box),
      onSubmit: fn => { submit = fn; }
    };
  }

  global.DiscordEditor = { create, toDiscordMarkdown };
})(typeof window !== 'undefined' ? window : null);
