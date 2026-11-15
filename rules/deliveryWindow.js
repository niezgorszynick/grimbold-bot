// rules/deliveryWindow.js — A resident artisan's weekly delivery window in
// Polish time: days `dayFrom`–`dayTo` (1 = Monday … 7 = Sunday) and, on each
// of those days, hours `hourFrom`–`hourTo` (0–24). Weeks start Monday
// midnight, like the restock. Each week one moment inside the window is picked
// at random, so the delivery doesn't come at the same hour every time.

'use strict';

const { warsawParts, warsawToDate } = require('./schedule');

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The calendar date `days` after the Monday of the Polish week holding `date`.
function weekDay(date, days) {
  const p = warsawParts(date);
  const sinceMonday = (p.weekday + 6) % 7;
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day - sinceMonday + days));
  return { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() };
}

// Monday 00:00 Polish time of the week holding `date` (weeks = 0), or of a later week.
function weekStart(date, weeks = 0) {
  const d = weekDay(date, weeks * 7);
  return warsawToDate(d.year, d.month, d.day, 0, 0);
}

// A day of the week (1–7) at `minutes` past its midnight, in the week of `date`.
function momentInWeek(date, weeks, dayOfWeek, minutes) {
  const d = weekDay(date, weeks * 7 + dayOfWeek - 1);
  return warsawToDate(d.year, d.month, d.day, Math.floor(minutes / 60), minutes % 60);
}

// A random whole minute inside the window, after `after`: in after's week if
// any of the window is left, otherwise the next week. null for no window.
function pickDeliveryTime(window, after, random = Math.random) {
  if (!window) return null;
  for (let weeks = 0; weeks < 3; weeks += 1) {
    const spans = [];
    for (let day = window.dayFrom; day <= window.dayTo; day += 1) {
      const start = Math.max(momentInWeek(after, weeks, day, window.hourFrom * 60).getTime(), after.getTime() + 60000);
      const end = momentInWeek(after, weeks, day, window.hourTo * 60).getTime();
      if (end > start) spans.push([start, end]);
    }
    const total = spans.reduce((sum, [start, end]) => sum + end - start, 0);
    if (!total) continue;
    let pick = random() * total;
    for (const [start, end] of spans) {
      if (pick < end - start) return new Date(Math.ceil((start + pick) / 60000) * 60000);
      pick -= end - start;
    }
    return new Date(Math.floor(spans[spans.length - 1][1] / 60000) * 60000 - 60000);
  }
  return null;
}

const pad = number => String(number).padStart(2, '0');

// "Tue–Thu, 10:00–16:00" or "Every day, 08:00–20:00".
function describeWindow(window) {
  if (!window) return 'With the weekly restock';
  const days = window.dayFrom === 1 && window.dayTo === 7 ? 'Every day'
    : window.dayFrom === window.dayTo ? DAY_NAMES[window.dayFrom] : `${DAY_SHORT[window.dayFrom]}–${DAY_SHORT[window.dayTo]}`;
  return `${days}, ${pad(window.hourFrom)}:00–${pad(window.hourTo)}:00`;
}

// "Wed 18 Nov, 14:37" in Polish time.
function describeMoment(date) {
  const p = warsawParts(date);
  return `${DAY_SHORT[p.weekday === 0 ? 7 : p.weekday]} ${p.day} ${MONTHS[p.month - 1]}, ${pad(p.hour)}:${pad(p.minute)}`;
}

module.exports = { DELIVERY_DAY_NAMES: DAY_NAMES, weekStart, pickDeliveryTime, describeWindow, describeMoment };
