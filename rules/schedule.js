// rules/schedule.js — Session times in Polish time (Europe/Warsaw, with summer
// and winter time). A DM types options loosely — "pt 20:00", "sob 18",
// "jutro 19:30", "7.11 20:00", "2026-11-07 20:00", or the English "fri 20:00",
// "tomorrow 19:30" — and gets exact moments. Discord shows them back with
// <t:…> timestamps (each viewer's own clock); the panel in Polish time.

const ZONE = 'Europe/Warsaw';

const WEEKDAYS = {
  nd: 0, ndz: 0, niedz: 0, niedziela: 0, niedziele: 0, sun: 0, sunday: 0,
  pon: 1, pn: 1, poniedzialek: 1, mon: 1, monday: 1,
  wt: 2, wto: 2, wtorek: 2, tue: 2, tues: 2, tuesday: 2,
  sr: 3, sro: 3, sroda: 3, srode: 3, wed: 3, wednesday: 3,
  czw: 4, cz: 4, czwartek: 4, thu: 4, thur: 4, thurs: 4, thursday: 4,
  pt: 5, pia: 5, piatek: 5, fri: 5, friday: 5,
  sob: 6, so: 6, sobota: 6, sobote: 6, sat: 6, saturday: 6
};
const RELATIVE = { dzis: 0, dzisiaj: 0, today: 0, jutro: 1, tomorrow: 1, pojutrze: 2 };
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const plain = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').toLowerCase().trim();

// The wall-clock parts of a moment in Polish time.
function warsawParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute),
    weekday: SHORT_DAYS.indexOf(parts.weekday)
  };
}

// A Polish wall-clock time → the moment (Date).
function warsawToDate(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = ms => {
    const p = warsawParts(new Date(ms));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return new Date(ms);
}

// "20", "20:00", "19.30", "18h", "8pm" → { hour, minute } or null.
function parseClock(token) {
  const match = plain(token).match(/^(\d{1,2})(?:[:.h](\d{2}))?h?(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (match[3] === 'pm' && hour < 12) hour += 12;
  if (match[3] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// One option → a Date (throws with a message to show the DM).
function parseSessionTime(text, now = new Date()) {
  const raw = String(text || '').trim();
  const tokens = plain(raw).replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('An empty time.');
  const today = warsawParts(now);
  const clockToken = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  const clock = clockToken ? parseClock(clockToken) : null;
  if (!clock) throw new Error(`"${raw}": add a time, e.g. "pt 20:00".`);
  const dayText = tokens.slice(0, -1).join(' ').replace(/\.$/, '');
  let year = today.year;
  let month = today.month;
  let day = today.day;
  let iso = dayText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dotted = dayText.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dotted) {
    day = Number(dotted[1]);
    month = Number(dotted[2]);
    year = dotted[3] ? (dotted[3].length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3])) : today.year;
    // A date earlier this year without a year means next year.
    if (!dotted[3] && warsawToDate(year, month, day, clock.hour, clock.minute) < now) year += 1;
  } else if (Object.hasOwn(RELATIVE, dayText)) {
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + RELATIVE[dayText]));
    [year, month, day] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
  } else if (Object.hasOwn(WEEKDAYS, dayText.replace(/\.$/, ''))) {
    let ahead = (WEEKDAYS[dayText.replace(/\.$/, '')] - today.weekday + 7) % 7;
    if (ahead === 0 && warsawToDate(today.year, today.month, today.day, clock.hour, clock.minute) <= now) ahead = 7;
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    [year, month, day] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
  } else {
    throw new Error(`"${raw}": I can't read the day. Try "pt 20:00", "jutro 19:30" or "7.11 20:00".`);
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error(`"${raw}": there is no such date.`);
  const when = warsawToDate(year, month, day, clock.hour, clock.minute);
  if (when <= now) throw new Error(`"${raw}" is in the past.`);
  if (when - now > 366 * 24 * 3600 * 1000) throw new Error(`"${raw}" is more than a year away.`);
  return when;
}

// "pt 20:00, sob 18" (commas, semicolons, "|" or new lines) → Dates, in order, no repeats.
function parseSessionTimes(text, now = new Date(), { max = 4 } = {}) {
  const parts = String(text || '').split(/[,;|\n]+/).map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Give at least one time, e.g. "pt 20:00, sob 18:00".');
  if (parts.length > max) throw new Error(`At most ${max} times in one poll.`);
  const dates = parts.map(part => parseSessionTime(part, now));
  const unique = [...new Map(dates.map(date => [date.getTime(), date])).values()];
  return unique.sort((a, b) => a - b);
}

// "Fri 7 Nov, 20:00" in Polish time (the panel).
function formatSessionTime(date) {
  const p = warsawParts(new Date(date));
  return `${SHORT_DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// Discord timestamps: "Friday, 7 November 2026 20:00" and "in 3 days", in each viewer's clock.
const discordTime = date => `<t:${Math.floor(new Date(date).getTime() / 1000)}:F>`;
const discordRelative = date => `<t:${Math.floor(new Date(date).getTime() / 1000)}:R>`;
const discordShort = date => `<t:${Math.floor(new Date(date).getTime() / 1000)}:f>`;

const overlaps = (aStart, aEnd, bStart, bEnd) => new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

module.exports = {
  SESSION_TIME_ZONE: ZONE,
  warsawParts,
  warsawToDate,
  parseSessionTime,
  parseSessionTimes,
  formatSessionTime,
  discordTime,
  discordRelative,
  discordShort,
  sessionsOverlap: overlaps
};
