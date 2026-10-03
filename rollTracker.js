const db = require('./db');

function getCurrentWeekMonday() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;

  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  return monday.toISOString().split('T')[0];
}

module.exports = {
  getCurrentWeekMonday,
  canUserRoll: (userId) => {
    const currentWeek = getCurrentWeekMonday();
    const existing = db.hasRolledThisWeek(userId, currentWeek);
    if (existing) {
      return { allowed: false, previousRoll: existing.roll_value, week: currentWeek };
    }
    return { allowed: true, week: currentWeek };
  },
  recordRoll: (userId, rollValue) => {
    const currentWeek = getCurrentWeekMonday();
    db.saveRoll(userId, currentWeek, rollValue);
    return currentWeek;
  }
};