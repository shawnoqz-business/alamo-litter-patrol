// GET /.netlify/functions/check-availability?day=Fri[&serviceType=Box%20Swap&count=2]
//
// Reports which time slots are already taken by Active customers on a given
// day, read live from Airtable on every call (nothing is cached, so the
// booking form always sees the real state). Omit `day` to get all six days
// in one call. When serviceType and count are supplied, the response also
// lists the start times that are genuinely open for a visit of that length.
//
// Response shape:
//   {
//     hours: { open: "9:00 AM", close: "6:00 PM", gridMinutes: 30 },
//     visitMinutes: 30,                       // only when serviceType+count given
//     days: {
//       Fri: {
//         taken: [{ start: "9:00 AM", end: "9:30 AM" }, ...],
//         open:  ["9:30 AM", "10:00 AM", ...]  // only when serviceType+count given
//       },
//       ...
//     }
//   }

const { CUSTOMERS_TABLE, FIELDS, listRecords, formulaString } = require('./lib/airtable');

// ── Tunables ────────────────────────────────────────────────────────────────
// Visit length in minutes. Adjust after watching real visits.
const SLOT_CONFIG = {
  baseMinutes: 20, // first box or unit
  perExtraBoxMinutes: 10, // each additional box or unit
  litterRobotExtraMinutes: 15, // on top of the box-count figure, pickup + in-home time
};

// Business hours and the booking grid. Slot Start / Slot End in Airtable are
// single-select fields with 30-minute options from 9:00 AM to 6:00 PM, so the
// grid here must stay in step with those options.
const HOURS = {
  openMinutes: 9 * 60, // 9:00 AM
  closeMinutes: 18 * 60, // 6:00 PM
  gridMinutes: 30,
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Dump+Refill was retired 2026-09-17; the Airtable option remains for old records.
const SERVICE_TYPES = ['Box Swap', 'Litter-Robot', 'Scoop-Only'];
// ────────────────────────────────────────────────────────────────────────────

// Minutes a visit takes for a given service and box/unit count.
function visitDurationMinutes(serviceType, count) {
  const boxes = Math.max(1, Math.floor(Number(count) || 1));
  let minutes = SLOT_CONFIG.baseMinutes + (boxes - 1) * SLOT_CONFIG.perExtraBoxMinutes;
  if (serviceType === 'Litter-Robot') minutes += SLOT_CONFIG.litterRobotExtraMinutes;
  return minutes;
}

// "9:30 AM" -> 570. Returns null for anything unparseable.
function parseTime(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label || '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const pm = m[3].toUpperCase() === 'PM';
  if (h === 12) h = pm ? 12 : 0;
  else if (pm) h += 12;
  return h * 60 + min;
}

// 570 -> "9:30 AM", matching the Airtable option labels exactly.
function formatTime(minutes) {
  const h24 = Math.floor(minutes / 60);
  const min = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

// Rounds a visit end up to the next grid boundary so it can be stored in the
// 30-minute Slot End select. A 20-minute visit starting at 9:00 ends "9:30 AM".
function slotEndForStart(startMinutes, durationMinutes) {
  const raw = startMinutes + durationMinutes;
  return Math.ceil(raw / HOURS.gridMinutes) * HOURS.gridMinutes;
}

// Every grid start time inside business hours.
function gridStarts() {
  const starts = [];
  for (let t = HOURS.openMinutes; t < HOURS.closeMinutes; t += HOURS.gridMinutes) {
    starts.push(t);
  }
  return starts;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Start times (in minutes) where a visit of `durationMinutes` fits without
// touching any taken interval and finishes by closing time.
function openStarts(takenIntervals, durationMinutes) {
  return gridStarts().filter((start) => {
    const end = start + durationMinutes;
    if (end > HOURS.closeMinutes) return false;
    return !takenIntervals.some((t) => overlaps(start, end, t.start, t.end));
  });
}

// Turns Airtable records into { day, start, end } intervals in minutes.
// A record with a start but no end gets an end derived from its service.
function takenIntervalsFromRecords(records) {
  const byDay = Object.fromEntries(DAYS.map((d) => [d, []]));
  for (const record of records) {
    const f = record.fields || {};
    const day = f[FIELDS.serviceDay];
    const start = parseTime(f[FIELDS.slotStart]);
    if (!byDay[day] || start === null) continue;
    let end = parseTime(f[FIELDS.slotEnd]);
    if (end === null || end <= start) {
      end = slotEndForStart(start, visitDurationMinutes(f[FIELDS.serviceType], f[FIELDS.boxCount]));
    }
    byDay[day].push({ start, end });
  }
  for (const day of DAYS) byDay[day].sort((a, b) => a.start - b.start);
  return byDay;
}

// Reads Active customers for one day (or all days) from Airtable.
async function fetchActiveBookings(day) {
  const clauses = [`{${FIELDS.status}} = ${formulaString('Active')}`];
  if (day) clauses.push(`{${FIELDS.serviceDay}} = ${formulaString(day)}`);
  return listRecords(CUSTOMERS_TABLE, {
    filterByFormula: `AND(${clauses.join(', ')})`,
    fields: [FIELDS.serviceDay, FIELDS.slotStart, FIELDS.slotEnd, FIELDS.serviceType, FIELDS.boxCount],
  });
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // Slots must reflect live state; never let a browser or CDN cache this.
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const params = event.queryStringParameters || {};
  const day = params.day ? String(params.day) : '';
  if (day && !DAYS.includes(day)) {
    return json(400, { error: `day must be one of ${DAYS.join(', ')}` });
  }

  const serviceType = params.serviceType ? String(params.serviceType) : '';
  if (serviceType && !SERVICE_TYPES.includes(serviceType)) {
    return json(400, { error: `serviceType must be one of ${SERVICE_TYPES.join(', ')}` });
  }
  const count = params.count ? Number(params.count) : 1;
  if (serviceType && (!Number.isInteger(count) || count < 1)) {
    return json(400, { error: 'count must be a whole number of 1 or more' });
  }

  let records;
  try {
    records = await fetchActiveBookings(day);
  } catch (err) {
    console.error('check-availability: Airtable read failed', err);
    return json(err.status === 500 ? 500 : 502, {
      error: 'Could not read availability right now. Please try again in a moment.',
      detail: err.message,
    });
  }

  const byDay = takenIntervalsFromRecords(records);
  const visitMinutes = serviceType ? visitDurationMinutes(serviceType, count) : null;

  const days = {};
  for (const d of day ? [day] : DAYS) {
    const taken = byDay[d].map((t) => ({ start: formatTime(t.start), end: formatTime(t.end) }));
    days[d] = { taken };
    if (visitMinutes !== null) {
      days[d].open = openStarts(byDay[d], visitMinutes).map(formatTime);
    }
  }

  const body = {
    hours: {
      open: formatTime(HOURS.openMinutes),
      close: formatTime(HOURS.closeMinutes),
      gridMinutes: HOURS.gridMinutes,
    },
    days,
  };
  if (visitMinutes !== null) body.visitMinutes = visitMinutes;

  return json(200, body);
};

// Shared with the booking function so both sides agree on visit length and
// slot rounding.
module.exports.SLOT_CONFIG = SLOT_CONFIG;
module.exports.HOURS = HOURS;
module.exports.DAYS = DAYS;
module.exports.SERVICE_TYPES = SERVICE_TYPES;
module.exports.visitDurationMinutes = visitDurationMinutes;
module.exports.parseTime = parseTime;
module.exports.formatTime = formatTime;
module.exports.slotEndForStart = slotEndForStart;
module.exports.openStarts = openStarts;
module.exports.takenIntervalsFromRecords = takenIntervalsFromRecords;
module.exports.fetchActiveBookings = fetchActiveBookings;
