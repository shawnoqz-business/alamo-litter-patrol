// Booking rules shared by the booking functions and, via booking-config.js,
// by the form on book.html. Prices must match pricing.html exactly; when a
// price changes there, change it here too.

// ── Prices (USD) ────────────────────────────────────────────────────────────
// Index 0 = 1 box/unit, 1 = 2, 2 = 3. Four or more needs a custom quote.
const PRICING = {
  'Box Swap': {
    label: 'Weekly Box Swap',
    per: 'week',
    homeEntry: [25, 40, 55],
    porch: [10, 25, 40],
    setupFee: [50, 75, 100],
    porchAllowed: true,
  },
  'Litter-Robot': {
    label: 'Litter-Robot Cleaning',
    per: 'visit',
    homeEntry: [70, 95, 120],
    porch: [55, 80, 105],
    setupFee: [50, 75, 100],
    porchAllowed: true,
  },
  'Scoop-Only': {
    label: 'Scoop Only',
    per: 'visit',
    homeEntry: [20, 30, 40],
    porch: null,
    setupFee: [0, 0, 0],
    porchAllowed: false,
  },
  'Dump+Refill': {
    label: 'Dump + Refill',
    per: 'visit',
    homeEntry: [30, 40, 50],
    porch: null,
    setupFee: [0, 0, 0],
    porchAllowed: false,
  },
};

const MAX_BOXES = 3; // above this: custom quote
const SENIOR_DISCOUNT_RATE = 0.1; // 10% off the service price for 65+

// ── Founding member offer ───────────────────────────────────────────────────
// MANUAL OFF-SWITCH: the founding member offer (first week free, $0 setup fee)
// is capped at our first 10 customers, and nothing here can count them. Flip
// this to false when customer 10 signs. The matching announcement bar in
// index.html and book.html, and the promo popup in script.js, must be turned
// off at the same time.
const FOUNDING_MEMBER_PROMO_ACTIVE = true;

// ── Service area ────────────────────────────────────────────────────────────
// Must match the zip-chip grid on service-area.html.
const SERVICE_ZIPS = ['78238', '78240', '78229', '78249', '78250', '78023', '78230', '78231', '78253'];

const ACCESS_TYPES = ['Home Entry', 'Porch'];

function isServiceZip(zip) {
  return SERVICE_ZIPS.includes(String(zip || '').trim());
}

// Returns { service, per, price, setupFee, setupWaived, seniorApplied,
// foundingApplied, error } for a selection. Prices are whole dollars.
function quote({ serviceType, count, accessType, seniorDiscount, hasSpareBox }) {
  const rules = PRICING[serviceType];
  if (!rules) return { error: 'Unknown service type' };
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) return { error: 'Box count must be 1 or more' };
  if (n > MAX_BOXES) return { error: 'custom-quote' };
  if (!ACCESS_TYPES.includes(accessType)) return { error: 'Unknown access type' };
  if (accessType === 'Porch' && !rules.porchAllowed) {
    return { error: `${rules.label} is home entry only` };
  }

  const table = accessType === 'Porch' ? rules.porch : rules.homeEntry;
  const base = table[n - 1];
  const seniorApplied = Boolean(seniorDiscount);
  const price = seniorApplied ? Math.round(base * (1 - SENIOR_DISCOUNT_RATE)) : base;

  const listedSetupFee = rules.setupFee[n - 1];
  const foundingApplied = FOUNDING_MEMBER_PROMO_ACTIVE && listedSetupFee > 0;
  const setupWaived = listedSetupFee > 0 && (Boolean(hasSpareBox) || foundingApplied);

  return {
    service: rules.label,
    per: rules.per,
    basePrice: base,
    price,
    listedSetupFee,
    setupFee: setupWaived ? 0 : listedSetupFee,
    setupWaived,
    seniorApplied,
    foundingApplied,
  };
}

module.exports = {
  PRICING,
  MAX_BOXES,
  SENIOR_DISCOUNT_RATE,
  FOUNDING_MEMBER_PROMO_ACTIVE,
  SERVICE_ZIPS,
  ACCESS_TYPES,
  isServiceZip,
  quote,
};
