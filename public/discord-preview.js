// public/discord-preview.js — Discord Markdown as Discord shows it, for
// previews in the panel (an NPC's voice page): bold, italic, underline,
// strikethrough, spoilers, inline code and code blocks, quotes (> and >>>),
// headings (#, ##, ###), subtext (-#), lists, masked links and mentions.
// The same Markdown public/discord-editor.js writes.
//
// window.DiscordPreview.render(markdown) → safe HTML (everything escaped first).
// Also exported for tests (Node).

(function (global) {
  const escapeHtml = text => String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Inline formatting on escaped text. Code spans are set aside first, as
  // nothing is formatted inside them.
  function inline(text) {
    const codes = [];
    let html = escapeHtml(text).replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (match, ticks, code) => {
      codes.push(`<code class="dp-code">${code.trim() || code}</code>`);
      return `\u0000${codes.length - 1}\u0000`;
    });
    html = html
      // Masked links [text](https://…) and bare links.
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, label, url) => `<a class="dp-link" href="${url}" target="_blank" rel="noopener">${label}</a>`)
      .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g, (match, lead, url) => `${lead}<a class="dp-link" href="${url}" target="_blank" rel="noopener">${url}</a>`)
      .replace(/\|\|([\s\S]+?)\|\|/g, '<span class="dp-spoiler" title="Spoiler: hidden until clicked">$1</span>')
      .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
      .replace(/(^|[^*\w])\*(?!\s)([\s\S]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?!\s)([\s\S]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>')
      .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
      // Mentions: <@123>, <@&123> (a role), <#123> (a channel).
      .replace(/&lt;@[!&]?(\d+)&gt;/g, '<span class="dp-mention">@user</span>')
      .replace(/&lt;#(\d+)&gt;/g, '<span class="dp-mention">#channel</span>');
    return html.replace(/\u0000(\d+)\u0000/g, (match, index) => codes[Number(index)]);
  }

  function render(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let quoteRest = false;
    let list = null; // 'ul' | 'ol'
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // Code blocks: ```lang … ```
      const fence = line.match(/^\s*```(\w*)\s*(.*)$/);
      if (fence) {
        const body = [];
        let rest = fence[2];
        let closed = false;
        if (rest.endsWith('```')) { body.push(rest.slice(0, -3)); closed = true; }
        else if (rest) body.push(rest);
        while (!closed && ++i < lines.length) {
          const end = lines[i].indexOf('```');
          if (end >= 0) { if (end > 0) body.push(lines[i].slice(0, end)); closed = true; } else body.push(lines[i]);
        }
        closeList();
        out.push(`<pre class="dp-codeblock">${escapeHtml(body.join('\n'))}</pre>`);
        continue;
      }
      let quoted = quoteRest;
      if (!quoteRest && /^>>> /.test(line)) { quoteRest = true; quoted = true; line = line.slice(4); }
      else if (/^> /.test(line) || line === '>') { quoted = true; line = line.replace(/^> ?/, ''); }

      let html;
      let heading = line.match(/^(#{1,3}) (.+)$/);
      const subtext = line.match(/^-# (.+)$/);
      const bullet = line.match(/^\s*[-*] (.+)$/);
      const numbered = line.match(/^\s*(\d+)\. (.+)$/);
      if (heading) {
        closeList();
        html = `<div class="dp-h${heading[1].length}">${inline(heading[2])}</div>`;
      } else if (subtext) {
        closeList();
        html = `<div class="dp-subtext">${inline(subtext[1])}</div>`;
      } else if (bullet || numbered) {
        const kind = bullet ? 'ul' : 'ol';
        if (list !== kind) { closeList(); out.push(kind === 'ol' ? `<ol start="${numbered[1]}">` : '<ul>'); list = kind; }
        out.push(`<li${quoted ? ' class="dp-quoted"' : ''}>${inline(bullet ? bullet[1] : numbered[2])}</li>`);
        continue;
      } else {
        closeList();
        html = `<div class="dp-line">${line.trim() ? inline(line) : '<br>'}</div>`;
      }
      out.push(quoted ? `<div class="dp-quote">${html}</div>` : html);
    }
    closeList();
    return out.join('');
  }

  const api = { render, escapeHtml };
  if (global) global.DiscordPreview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
