// POST /.netlify/functions/create-setup-intent
// Body: { name, email, phone }
//
// Creates a Stripe Customer and a card-only SetupIntent so the booking form
// can save a card on file without charging it. Nothing is charged here or
// anywhere in the booking flow; billing happens monthly for completed visits.
//
// Returns { clientSecret, customerId, setupIntentId }.

const { stripeRequest } = require('./lib/stripe');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function clean(value, max) {
  return String(value || '').trim().slice(0, max);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let input = {};
  try {
    input = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON' });
  }

  const name = clean(input.name, 120);
  const email = clean(input.email, 200);
  const phone = clean(input.phone, 40);
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'Name and a valid email are required before saving a card.' });
  }

  try {
    const customer = await stripeRequest('POST', '/customers', {
      name,
      email,
      phone: phone || undefined,
      metadata: { source: 'alamolitterpatrol.com booking form' },
    });

    const setupIntent = await stripeRequest('POST', '/setup_intents', {
      customer: customer.id,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: { source: 'alamolitterpatrol.com booking form', customer_name: name },
    });

    return json(200, {
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
      setupIntentId: setupIntent.id,
    });
  } catch (err) {
    console.error('create-setup-intent: Stripe call failed', err);
    const status = err.status === 500 ? 500 : 502;
    return json(status, {
      error: 'We could not start the card setup. Please try again in a moment.',
      detail: err.message,
    });
  }
};
