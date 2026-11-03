// views/tabs/sessions.js — "Sessions" tab: the coming weeks of adventure
// sessions (scheduled in each adventure's Discord thread with /schedule), by
// day in Polish time, who's in each and any clashes; then the polls still open.

'use strict';

const db = require('../../db');
const { warsawParts, formatSessionTime } = require('../../rules/schedule');
const { escapeHtml } = require('../helpers');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const clock = iso => { const p = warsawParts(new Date(iso)); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
const dayKey = iso => { const p = warsawParts(new Date(iso)); return `${p.year}-${p.month}-${p.day}`; };
const dayTitle = iso => { const p = warsawParts(new Date(iso)); return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`; };

module.exports = function renderSessionsTab(ctx) {
  const { req } = ctx;
  const days = req.query.days === '60' ? 60 : 21;
  const sessions = db.upcomingSessions({ days });
  const polls = db.listOpenPolls();
  const byDay = [];
  sessions.forEach(session => {
    const key = dayKey(session.startsAt);
    const last = byDay[byDay.length - 1];
    if (last && last.key === key) last.sessions.push(session);
    else byDay.push({ key, title: dayTitle(session.startsAt), sessions: [session] });
  });
  const link = (title, url, adventureId) => {
    // A campaign (no adventure table): its channel, if any, and a tag.
    if (!adventureId) return `${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>` : `<strong>${escapeHtml(title)}</strong>`} <span class="tag">campaign</span>`;
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a> <a class="muted small" href="/admin?tab=adventures&table=${adventureId}">table</a>`
      : `<a href="/admin?tab=adventures&table=${adventureId}">${escapeHtml(title)}</a>`;
  };
  return `
    <section class="card">
      <h3>Sessions</h3>
      <p class="muted small">Times in Polish time. DMs schedule in each adventure's Discord thread: <code>/schedule propose times:pt 20:00, sob 18:00</code>; everyone answers with the buttons, and the DM locks a time in. Campaigns outside the threads: <code>/campaign create</code>, then <code>/campaign set</code>. <code>/sessions</code> shows this list in Discord.</p>
      <p class="small"><a href="/admin?tab=sessions&days=${days === 60 ? 21 : 60}">${days === 60 ? 'Show the next 3 weeks' : 'Show the next 2 months'}</a></p>
      ${byDay.length ? byDay.map(day => `
        <h4 class="sessions-day">${escapeHtml(day.title)}</h4>
        ${day.sessions.map(session => `
          <div class="session-row${session.clashes.length ? ' has-clash' : ''}">
            <div><strong>${clock(session.startsAt)}–${clock(session.endsAt)}</strong> · ${link(session.adventure, session.threadUrl, session.adventureId)}${session.dm ? ` <span class="muted small">· DM ${escapeHtml(session.dm)}</span>` : ''}</div>
            ${session.people.length ? `<div class="small muted">👥 ${escapeHtml(session.people.join(', '))}</div>` : ''}
            ${session.clashes.length ? `<div class="small">⚠️ ${escapeHtml([...new Set(session.clashes.map(clash => `${clash.name} is also in ${clash.adventure}`))].join('; '))}</div>` : ''}
          </div>`).join('')}`).join('') : `<p class="muted">No sessions booked in the next ${days === 60 ? 'two months' : 'three weeks'}.</p>`}
    </section>
    <section class="card">
      <h3>📅 In your own calendar</h3>
      <p class="muted small">Your sessions (said ✅, DM, or in the party) in Google, Apple or Outlook. Moved and cancelled sessions follow by themselves; Google can take some hours to notice. In Discord: <code>/schedule calendar</code> or the 📅 button under a session.</p>
      <div class="table-filter" id="calendar-links"><button type="button" class="btn btn-small" id="calendar-show">Show my calendar links</button></div>
      <script>
        (() => {
          const box = document.getElementById('calendar-links');
          document.getElementById('calendar-show').addEventListener('click', async () => {
            try {
              const response = await fetch('/api/calendar-link');
              const links = await response.json();
              if (!response.ok) throw new Error(links.error || 'No calendar link.');
              const a = (href, text) => { const node = document.createElement('a'); node.href = href; node.textContent = text; node.target = '_blank'; node.rel = 'noopener'; node.className = 'btn btn-small btn-secondary'; return node; };
              const copy = document.createElement('input');
              Object.assign(copy, { type: 'text', readOnly: true, value: links.https });
              copy.style.minWidth = '260px';
              copy.addEventListener('focus', () => copy.select());
              box.replaceChildren(a(links.google, 'Google Calendar'), a(links.webcal, 'Apple / iPhone'), a(links.outlook, 'Outlook'), copy);
            } catch (error) {
              box.textContent = error.message;
            }
          });
        })();
      </script>
    </section>
    <section class="card">
      <h3>Open polls</h3>
      ${polls.length ? polls.map(poll => `
        <div class="session-row">
          <div><strong>${escapeHtml(poll.adventure.title)}</strong>${poll.adventure.dm ? ` <span class="muted small">· DM ${escapeHtml(poll.adventure.dm)}</span>` : ''} <a class="muted small" href="/admin?tab=adventures&table=${poll.adventure.id}">table</a></div>
          <ul class="session-poll-options small">${poll.options.map(option => `<li><strong>${option.letter}</strong> ${escapeHtml(formatSessionTime(option.startsAt))}: ✅ ${option.yes.length}${option.yes.length ? ` (${escapeHtml(option.yes.map(v => v.name).join(', '))})` : ''} · 🤔 ${option.maybe.length} · ❌ ${option.no.length}${option.clashes.length ? ` · ⚠️ ${escapeHtml(option.clashes.map(c => `${c.name} in ${c.adventure}`).join('; '))}` : ''}</li>`).join('')}</ul>
        </div>`).join('') : '<p class="muted">No polls open. Answer them in the adventure threads on Discord.</p>'}
    </section>`;
};
