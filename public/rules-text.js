// public/rules-text.js — Shows rules text (spells, items, class and subclass
// features) from the light Markdown in rules/content/*.md: paragraphs,
// **bold**, *italic*, "- " bullets and | tables |. Builds DOM nodes only,
// never HTML, so the text can't inject markup.
//
// window.renderRulesText(text, className) → a <div> (class "spell-text" by default).

(function () {
  function el(tag, className, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    (children || []).forEach(child => node.append(child));
    return node;
  }

  // **bold** and *italic* inside a line, as nodes.
  function inline(text) {
    const parts = [];
    String(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/).forEach(part => {
      if (/^\*\*[^*]+\*\*$/.test(part)) parts.push(el('strong', '', [part.slice(2, -2)]));
      else if (/^\*[^*]+\*$/.test(part)) parts.push(el('em', '', [part.slice(1, -1)]));
      else if (part) parts.push(document.createTextNode(part));
    });
    return parts;
  }

  function table(lines) {
    const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    const rows = lines.filter(line => !/^\|?\s*:?-{2,}/.test(line.trim())).map(cells);
    const [head, ...body] = rows;
    return el('div', 'rules-table-wrap', [el('table', 'rules-table', [
      el('thead', '', [el('tr', '', head.map(cell => el('th', '', inline(cell))))]),
      el('tbody', '', body.map(row => el('tr', '', row.map(cell => el('td', '', inline(cell))))))
    ])]);
  }

  // Blank lines separate paragraphs; a run of | lines is a table; "- " or
  // "* " lines are bullets; other single line breaks stay inside a paragraph.
  function blocks(text) {
    const out = [];
    let paragraph = [];
    let tableLines = [];
    let bullets = [];
    const flush = () => {
      if (paragraph.length) out.push(el('p', '', inline(paragraph.join('\n'))));
      if (tableLines.length) out.push(table(tableLines));
      if (bullets.length) out.push(el('ul', 'rules-list', bullets.map(item => el('li', '', inline(item)))));
      paragraph = []; tableLines = []; bullets = [];
    };
    String(text || '').replace(/\r\n/g, '\n').split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line) { flush(); return; }
      if (line.startsWith('|')) {
        if (!tableLines.length) flush();
        tableLines.push(line);
        return;
      }
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      if (bullet) {
        if (!bullets.length) flush();
        bullets.push(bullet[1]);
        return;
      }
      if (tableLines.length || bullets.length) flush();
      paragraph.push(line);
    });
    flush();
    return out;
  }

  window.renderRulesText = function renderRulesText(text, className) {
    return el('div', className || 'spell-text', blocks(text));
  };
})();
