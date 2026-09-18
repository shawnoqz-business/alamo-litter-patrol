// Thin Airtable REST client shared by the booking functions. Not an endpoint
// itself: it lives under lib/ so Netlify does not deploy it as a function.
//
// Credentials come from the Netlify environment only:
//   AIRTABLE_API_KEY  personal access token (starts with "pat")
//   AIRTABLE_BASE_ID  base id (starts with "app")
//
// Field names below were read from the base's generated API docs on
// 2026-09-17 and must match the "Customers" table exactly. If a column is
// renamed in Airtable, update it here and nowhere else.

const API_ROOT = 'https://api.airtable.com/v0';

const CUSTOMERS_TABLE = 'Customers';

const FIELDS = Object.freeze({
  name: 'Name',
  notes: 'Notes',
  status: 'Status', // Active | Paused | Cancelled
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  accessNotes: 'Gate Code / Access Notes',
  serviceType: 'Service Type', // Box Swap | Litter-Robot | Scoop-Only (Dump+Refill retired 2026-09-17)
  boxCount: 'Box/Unit Count',
  accessType: 'Access Type', // Home Entry | Porch
  serviceDay: 'Service Day', // Mon | Tue | Wed | Thu | Fri | Sat
  slotStart: 'Slot Start', // "9:00 AM" ... "6:00 PM", 30-minute options
  slotEnd: 'Slot End', // same option set as Slot Start
  seniorDiscount: 'Senior Discount',
  foundingMember: 'Founding Member',
  setupFeeStatus: 'Setup Fee Status', // Paid | Waived | N/A
  stripeCustomerId: 'Stripe Customer ID',
  stripeSetupIntentId: 'Stripe SetupIntent ID',
  signupDate: 'Signup Date', // ISO date, e.g. 2026-09-17
});

class AirtableError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'AirtableError';
    this.status = status;
    this.details = details;
  }
}

function getConfig() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey) {
    throw new AirtableError('AIRTABLE_API_KEY is not set', 500);
  }
  if (!baseId) {
    throw new AirtableError('AIRTABLE_BASE_ID is not set', 500);
  }
  if (!/^app[A-Za-z0-9]{14}$/.test(baseId)) {
    // A pasted token or URL here is the most likely mistake, so say so plainly.
    throw new AirtableError(
      'AIRTABLE_BASE_ID does not look like an Airtable base id (expected "app" followed by 14 characters)',
      500
    );
  }
  return { apiKey, baseId };
}

async function request(method, path, { query, body } = {}) {
  const { apiKey, baseId } = getConfig();
  const url = new URL(`${API_ROOT}/${baseId}/${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(`${key}[]`, v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  const text = await res.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (e) {
    payload = { raw: text };
  }

  if (!res.ok) {
    const message =
      (payload && payload.error && (payload.error.message || payload.error.type)) ||
      `Airtable request failed with status ${res.status}`;
    throw new AirtableError(message, res.status, payload);
  }
  return payload;
}

// Lists every record matching the filter, following Airtable's pagination.
// Options mirror the REST API: filterByFormula, fields (array), maxRecords, sort, view.
async function listRecords(table, options = {}) {
  const records = [];
  let offset;
  do {
    const page = await request('GET', encodeURIComponent(table), {
      query: { ...options, offset },
    });
    records.push(...(page.records || []));
    offset = page.offset;
  } while (offset);
  return records;
}

async function getRecord(table, recordId) {
  return request('GET', `${encodeURIComponent(table)}/${recordId}`);
}

// Creates one record and returns it ({ id, createdTime, fields }).
async function createRecord(table, fields, { typecast = false } = {}) {
  return request('POST', encodeURIComponent(table), {
    body: { fields, typecast },
  });
}

// Escapes a string for use inside single quotes in an Airtable formula.
function formulaString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

module.exports = {
  AirtableError,
  CUSTOMERS_TABLE,
  FIELDS,
  getConfig,
  listRecords,
  getRecord,
  createRecord,
  formulaString,
};
