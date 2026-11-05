// public/subclass-features.js — The character sheet's subclass features: each
// feature reached so far with its text (from rules/content/subclasses.md), the
// ones still to come by name, and a note for playtest (Unearthed Arcana) ones.
// The text is light Markdown: paragraphs, **bold**, *italic* and | tables |.

(function () {
  const root = document.getElementById('cs_subclass_features');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);

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

  // **bold** and *italic* inside a line, as text nodes (never HTML).
  function inline(text) {
    const parts = [];
    const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(match[1] ? el('strong', { text: match[1] }) : el('em', { text: match[2] }));
      last = pattern.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  function table(lines) {
    const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    const rows = lines.filter(line => !/^\|?\s*:?-{2,}/.test(line.trim()));
    const [head, ...body] = rows.map(cells);
    return el('table', { className: 'subclass-table' }, [
      el('thead', {}, el('tr', {}, head.map(cell => el('th', {}, inline(cell))))),
      el('tbody', {}, body.map(row => el('tr', {}, row.map(cell => el('td', {}, inline(cell))))))
    ]);
  }

  function blocks(text) {
    const out = [];
    let tableLines = [];
    let paragraph = [];
    const flush = () => {
      if (tableLines.length) out.push(table(tableLines));
      if (paragraph.length) out.push(el('p', {}, inline(paragraph.join(' '))));
      tableLines = [];
      paragraph = [];
    };
    String(text || '').split('\n').forEach(line => {
      if (line.trim().startsWith('|')) {
        if (paragraph.length) flush();
        tableLines.push(line);
      } else if (!line.trim()) flush();
      else {
        if (tableLines.length) flush();
        paragraph.push(line.trim().replace(/^[-*]\s+/, '• '));
      }
    });
    flush();
    return out;
  }

  function render(subclasses) {
    if (!subclasses.length) { root.hidden = true; return; }
    root.hidden = false;
    root.replaceChildren(...subclasses.map(entry => el('div', { className: 'subclass-features' }, [
      el('h5', { text: entry.subclass + ' (' + entry.className + ' ' + entry.level + ')' }),
      entry.source ? el('p', { className: 'muted small', text: '🧪 Playtest material (' + entry.source + '): may change before it is official.' }) : null,
      ...entry.features.map(feature => el('details', { className: 'subclass-feature' }, [
        el('summary', {}, [el('strong', { text: feature.name }), el('span', { className: 'muted small', text: ' · level ' + feature.level })]),
        el('div', { className: 'subclass-feature-text small' }, blocks(feature.text))
      ])),
      entry.upcoming.length ? el('p', { className: 'muted small', text: 'Later: ' + entry.upcoming.map(feature => feature.name + ' (' + feature.level + ')').join(', ') + '.' }) : null
    ])));
  }

  fetch('/api/characters/' + characterId + '/subclass-features')
    .then(response => (response.ok ? response.json() : { subclasses: [] }))
    .then(result => render(result.subclasses || []))
    .catch(() => { root.hidden = true; });
})();
