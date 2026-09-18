// Minimal Stripe REST client (no SDK dependency). Stripe takes
// application/x-www-form-urlencoded bodies with bracketed keys for nesting.
//
// Env: STRIPE_SECRET_KEY_ALP (preferred) or STRIPE_SECRET_KEY, and
//      STRIPE_PUBLISHABLE_KEY_ALP or STRIPE_PUBLISHABLE_KEY for the browser.

const API_ROOT = 'https://api.stripe.com/v1';

class StripeError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
    this.details = details;
  }
}

function getSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY_ALP || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError('STRIPE_SECRET_KEY_ALP is not set', 500);
  return key;
}

function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY_ALP || process.env.STRIPE_PUBLISHABLE_KEY || '';
}

// { a: 1, b: { c: 2 }, d: ['x'] } -> a=1&b[c]=2&d[0]=x
function encodeForm(params, prefix, out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'object') encodeForm(v, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(v));
      });
    } else if (typeof value === 'object') {
      encodeForm(value, name, out);
    } else {
      out.append(name, String(value));
    }
  }
  return out;
}

async function stripeRequest(method, path, params, { idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${getSecretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let url = `${API_ROOT}${path}`;
  let body;
  if (method === 'GET') {
    const qs = encodeForm(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    body = encodeForm(params).toString();
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (e) {
    payload = { raw: text };
  }
  if (!res.ok) {
    const message = (payload && payload.error && payload.error.message) || `Stripe request failed with status ${res.status}`;
    throw new StripeError(message, res.status, payload && payload.error);
  }
  return payload;
}

module.exports = { StripeError, getPublishableKey, stripeRequest, encodeForm };
