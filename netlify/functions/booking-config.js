// GET /.netlify/functions/booking-config
//
// Everything the booking form needs before it can render: the Stripe
// publishable key (safe for browsers), the price table, the service-area zips,
// business hours, and whether the founding member offer is still on. Serving
// it from here keeps one source of truth on the server side.

const booking = require('./lib/booking');
const { getPublishableKey } = require('./lib/stripe');
const { HOURS, DAYS, SERVICE_TYPES, SLOT_CONFIG, formatTime } = require('./check-availability');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const stripePublishableKey = getPublishableKey();
  const body = {
    stripePublishableKey,
    stripeConfigured: Boolean(stripePublishableKey),
    pricing: booking.PRICING,
    setupFee: booking.SETUP_FEE,
    maxBoxes: booking.MAX_BOXES,
    seniorDiscountRate: booking.SENIOR_DISCOUNT_RATE,
    foundingMemberPromoActive: booking.FOUNDING_MEMBER_PROMO_ACTIVE,
    serviceZips: booking.SERVICE_ZIPS,
    serviceTypes: SERVICE_TYPES,
    accessTypes: booking.ACCESS_TYPES,
    days: DAYS,
    hours: { open: formatTime(HOURS.openMinutes), close: formatTime(HOURS.closeMinutes), gridMinutes: HOURS.gridMinutes },
    slotConfig: SLOT_CONFIG,
  };

  if (!stripePublishableKey) {
    console.error('booking-config: no Stripe publishable key in env (STRIPE_PUBLISHABLE_KEY_ALP or STRIPE_PUBLISHABLE_KEY)');
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
};
