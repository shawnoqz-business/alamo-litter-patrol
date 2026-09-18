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
    hasSetupFee: true,
    porchAllowed: true,
  },
  'Litter-Robot': {
    label: 'Litter-Robot Cleaning',
    per: 'visit',
    homeEntry: [70, 95, 120],
    porch: [55, 80, 105],
    hasSetupFee: true,
    porchAllowed: true,
  },
  'Scoop-Only': {
    label: 'Scoop Only',
    per: 'visit',
    homeEntry: [20, 30, 40],
    porch: null,
    hasSetupFee: false,
    porchAllowed: false,
  },
};

// One-time setup fee: $50 covers the first stainless steel box (or loaner),
// then $25 for each additional box or unit. Matches the tiers on pricing.html
// (1 box $50, 2 boxes $75, 3 boxes $100).
const SETUP_FEE = { firstBox: 50, extraBox: 25 };

const MAX_BOXES = 3; // above this: custom quote
const SENIOR_DISCOUNT_RATE = 0.1; // 10% off the service price for 65+

// ── Founding member offer ───────────────────────────────────────────────────
// MANUAL OFF-SWITCH: the founding member offer (first week free, first box's
// setup fee covered) is capped at our first 10 customers, and nothing here
// can count them. Flip this to false when the offer ends. The matching
// announcement bar in index.html and book.html, and the promo popup in
// script.js, must be turned off at the same time.
const FOUNDING_MEMBER_PROMO_ACTIVE = false; // ended 2026-09-17

// ── Service area ────────────────────────────────────────────────────────────
// Must match the zip-chip grid on service-area.html.
const SERVICE_ZIPS = ['78238', '78240', '78229', '78249', '78250', '78023', '78230', '78231', '78253'];

const ACCESS_TYPES = ['Home Entry', 'Porch'];

function isServiceZip(zip) {
  return SERVICE_ZIPS.includes(String(zip || '').trim());
}

// Prices a selection. All amounts are whole dollars.
//   price            what they pay per week/visit (after senior discount)
//   listedSetupFee   the published setup fee if we supplied every box
//   suppliedBoxes    boxes we provide (count minus the customer's own boxes)
//   setupFee         fee for the boxes we supply: $50 for the first, $25 each
//                    additional, $0 when the customer supplies all of them.
//                    The founding member offer (when on) covers the first
//                    supplied box.
function quote({ serviceType, count, accessType, seniorDiscount, ownBoxes }) {
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

  const own = Math.min(Math.max(0, Math.floor(Number(ownBoxes) || 0)), n);
  const supplied = rules.hasSetupFee ? n - own : 0;
  const feeFor = (boxes) => (boxes > 0 ? SETUP_FEE.firstBox + SETUP_FEE.extraBox * (boxes - 1) : 0);
  const listedSetupFee = rules.hasSetupFee ? feeFor(n) : 0;
  const foundingApplied = FOUNDING_MEMBER_PROMO_ACTIVE && supplied > 0;
  const setupFee = foundingApplied ? SETUP_FEE.extraBox * (supplied - 1) : feeFor(supplied);

  return {
    service: rules.label,
    per: rules.per,
    basePrice: base,
    price,
    listedSetupFee,
    setupFee,
    ownBoxes: rules.hasSetupFee ? own : 0,
    suppliedBoxes: supplied,
    setupWaived: rules.hasSetupFee && setupFee === 0,
    seniorApplied,
    foundingApplied,
  };
}

module.exports = {
  PRICING,
  SETUP_FEE,
  MAX_BOXES,
  SENIOR_DISCOUNT_RATE,
  FOUNDING_MEMBER_PROMO_ACTIVE,
  SERVICE_ZIPS,
  ACCESS_TYPES,
  isServiceZip,
  quote,
};
