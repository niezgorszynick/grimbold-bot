// views/tabs/changelog.js — "Changelog" tab: the news pages in public/news
// (also public at /news/<name>), newest first, the chosen one shown in the tab.
// A page's date comes from <meta name="news-date" content="YYYY-MM-DD">, its
// summary from its first class="lede" paragraph.

'use strict';

const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../helpers');

const NEWS_DIR = path.join(__dirname, '..', '..', 'public', 'news');

function readPages() {
  let files = [];
  try {
    files = fs.readdirSync(NEWS_DIR).filter(file => /^[a-z0-9-]+\.html$/i.test(file));
  } catch {
    return [];
  }
  const plain = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  return files.map(file => {
    const full = path.join(NEWS_DIR, file);
    const html = fs.readFileSync(full, 'utf8');
    const date = (html.match(/<meta name="news-date" content="(\d{4}-\d{2}-\d{2})"/) || [])[1] || fs.statSync(full).mtime.toISOString().slice(0, 10);
    return {
      name: file.replace(/\.html$/i, ''),
      title: plain((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || file),
      date,
      summary: plain((html.match(/class="lede">([\s\S]*?)<\/p>/i) || [])[1] || '')
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

module.exports = function renderChangelogTab(ctx) {
  const pages = readPages();
  if (!pages.length) return '<section class="card"><h3>Changelog</h3><p class="muted">No updates yet.</p></section>';
  const chosen = pages.find(page => page.name === ctx.req.query.page) || pages[0];
  return `
    <section class="card changelog">
      <h3>Changelog</h3>
      <ul class="changelog-list">
        ${pages.map(page => `
          <li class="${page.name === chosen.name ? 'is-current' : ''}">
            <a href="/admin?tab=changelog&page=${encodeURIComponent(page.name)}"><strong>${escapeHtml(page.title)}</strong></a>
            <span class="muted small">${escapeHtml(page.date)}</span>
            ${page.summary ? `<p class="muted small">${escapeHtml(page.summary)}</p>` : ''}
          </li>`).join('')}
      </ul>
      <p class="muted small">Share a page with its public link: <a href="/news/${encodeURIComponent(chosen.name)}" target="_blank" rel="noopener">/news/${escapeHtml(chosen.name)}</a> (no login needed).</p>
    </section>
    <iframe id="changelog-page" class="changelog-frame" src="/news/${encodeURIComponent(chosen.name)}" title="${escapeHtml(chosen.title)}"></iframe>
    <script>
      (() => {
        // Grow the frame to its page, so the panel scrolls rather than the frame.
        const frame = document.getElementById('changelog-page');
        const fit = () => {
          try { frame.style.height = frame.contentDocument.documentElement.scrollHeight + 'px'; } catch { /* keep the CSS height */ }
        };
        frame.addEventListener('load', () => { fit(); setTimeout(fit, 500); });
        window.addEventListener('resize', fit);
      })();
    </script>`;
};
