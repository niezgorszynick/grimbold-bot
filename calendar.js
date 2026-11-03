// calendar.js — Personal calendar feeds at /calendar/<token>.ics: a person's
// adventure sessions for Google, Apple or Outlook to subscribe to. Public (no
// login; the token is the secret), so calendars can fetch it; moved or
// cancelled sessions update there on the calendar's next refresh.

'use strict';

const express = require('express');
const db = require('./db');
const { sessionsCalendar } = require('./rules/schedule');

const router = express.Router();

router.get('/:file', (req, res) => {
  const token = String(req.params.file || '').replace(/\.ics$/i, '');
  const feed = db.calendarSessions(token);
  if (!feed) return res.status(404).type('text/plain').send('Unknown calendar link. Get yours again with /schedule calendar.');
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': 'inline; filename="grimbold-sessions.ics"' });
  return res.send(sessionsCalendar(feed.sessions, { name: "Grimbold's sessions" }));
});

module.exports = router;
