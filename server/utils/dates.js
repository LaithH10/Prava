// Visit-request dates are calendar days in the Netherlands (Europe/Amsterdam),
// stored as 00:00 UTC of that date so they compare and sort simply.
export const TIME_ZONE = "Europe/Amsterdam";
export const MAX_DAYS_AHEAD = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" for the current calendar day in Amsterdam.
export const todayInAmsterdam = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);

// "YYYY-MM-DD" -> Date at 00:00 UTC.
export const dayToDate = (day) => new Date(`${day}T00:00:00.000Z`);

// Date at 00:00 UTC of today's Amsterdam calendar day.
export const startOfToday = (now = new Date()) => dayToDate(todayInAmsterdam(now));

// Returns null when `day` is allowed (tomorrow up to MAX_DAYS_AHEAD days ahead),
// otherwise a message explaining why not.
export const checkRequestedDay = (day, now = new Date()) => {
  const date = dayToDate(day);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    return "Enter a valid date";
  }
  const today = startOfToday(now);
  const daysAhead = Math.round((date - today) / DAY_MS);
  if (daysAhead < 1) return "Choose a date from tomorrow onwards";
  if (daysAhead > MAX_DAYS_AHEAD) return `Choose a date within ${MAX_DAYS_AHEAD} days`;
  return null;
};
