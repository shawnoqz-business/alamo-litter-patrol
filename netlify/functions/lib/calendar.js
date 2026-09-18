// Calendar helpers for a weekly recurring service window: an .ics file (for
// the confirmation email attachment) and a Google Calendar link. Times are
// Central (America/Chicago), which is where every customer is.

const TZ = 'America/Chicago';
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };

function pad(n) {
  return String(n).padStart(2, '0');
}

// "9:30 AM" -> 570
function parseTime(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label || '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const pm = m[3].toUpperCase() === 'PM';
  if (h === 12) h = pm ? 12 : 0;
  else if (pm) h += 12;
  return h * 60 + Number(m[2]);
}

// Today's civil date in Central time as { y, m, d, weekday(0-6) }.
function todayCentral() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), weekday: DAY_INDEX[get('weekday')] };
}

// First occurrence of `serviceDay` strictly after today (Central).
function firstOccurrence(serviceDay) {
  const t = todayCentral();
  const target = DAY_INDEX[serviceDay];
  let ahead = (target - t.weekday + 7) % 7;
  if (ahead === 0) ahead = 7;
  // Use UTC date math purely as a calendar counter; no time-of-day here.
  const date = new Date(Date.UTC(t.y, t.m - 1, t.d + ahead));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function stamp(date, minutes) {
  return `${date.y}${pad(date.m)}${pad(date.d)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
}

function escapeIcs(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

// Returns { ics, googleUrl, firstDateLabel } for a weekly window.
function weeklyWindow({ serviceLabel, serviceDay, slotStart, slotEnd, uid }) {
  const first = firstOccurrence(serviceDay);
  const start = stamp(first, parseTime(slotStart));
  const end = stamp(first, parseTime(slotEnd));
  const byDay = serviceDay.slice(0, 2).toUpperCase();
  const title = `Alamo Litter Patrol: ${serviceLabel}`;
  const details = `Weekly ${serviceLabel.toLowerCase()} visit. Target window ${slotStart} to ${slotEnd}; exact timing may shift slightly with the day's route. Questions: hello@alamolitterpatrol.com`;

  const google = new URL('https://calendar.google.com/calendar/render');
  google.searchParams.set('action', 'TEMPLATE');
  google.searchParams.set('text', title);
  google.searchParams.set('dates', `${start}/${end}`);
  google.searchParams.set('details', details);
  google.searchParams.set('recur', `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`);
  google.searchParams.set('ctz', TZ);

  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Alamo Litter Patrol//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid || `${Date.now()}@alamolitterpatrol.com`}`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=${TZ}:${start}`,
    `DTEND;TZID=${TZ}:${end}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(details)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const firstDateLabel = new Date(Date.UTC(first.y, first.m - 1, first.d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return { ics, googleUrl: google.toString(), firstDateLabel, dayName: DAY_NAMES[serviceDay] };
}

module.exports = { weeklyWindow, parseTime, DAY_NAMES };
