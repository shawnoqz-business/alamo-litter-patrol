// POST /.netlify/functions/create-booking
//
// Writes a new Active customer to Airtable after re-checking the chosen slot
// against live data, confirms the saved card with Stripe, and posts the
// details to Slack (#leads) through the slack-notify.js notifier.
//
// Bookings auto-confirm: there is no pending state. The slot picker plus the
// re-check right before the write is the double-booking guard.
//
// Body:
// {
//   serviceType, count, accessType, seniorDiscount, ownBoxes, extraBoxes, extraBoxes,
//   serviceDay, slotStart,
//   name, email, phone, address, zip, accessNotes, notes,
//   stripeCustomerId, stripeSetupIntentId,
//   botField            // honeypot, must be empty
// }

const { CUSTOMERS_TABLE, FIELDS, createRecord } = require('./lib/airtable');
const booking = require('./lib/booking');
const { stripeRequest } = require('./lib/stripe');
const availability = require('./check-availability');
const { notify } = require('./slack-notify');
const { weeklyWindow } = require('./lib/calendar');
const { bookingEmail, sendEmail } = require('./lib/email');

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

// Today's date in Central time as YYYY-MM-DD, for the Signup Date field.
function todayCentral() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function validate(input) {
  const errors = [];

  const serviceType = clean(input.serviceType, 40);
  if (!availability.SERVICE_TYPES.includes(serviceType)) errors.push('Pick a service.');

  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 1) errors.push('Box or unit count must be 1 or more.');
  else if (count > booking.MAX_BOXES) errors.push(`For ${booking.MAX_BOXES + 1} or more boxes, contact us for a custom quote.`);

  const accessType = clean(input.accessType, 20);
  if (!booking.ACCESS_TYPES.includes(accessType)) errors.push('Pick home entry or porch.');

  const serviceDay = clean(input.serviceDay, 3);
  if (!availability.DAYS.includes(serviceDay)) errors.push('Pick a service day.');

  const slotStart = clean(input.slotStart, 10);
  const startMinutes = availability.parseTime(slotStart);
  if (startMinutes === null) errors.push('Pick a time window.');

  const name = clean(input.name, 120);
  if (!name) errors.push('Name is required.');
  const email = clean(input.email, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email is required.');
  const phone = clean(input.phone, 40);
  if (phone.replace(/\D/g, '').length < 10) errors.push('A phone number is required.');
  const address = clean(input.address, 300);
  if (!address) errors.push('Address is required.');
  const zip = clean(input.zip, 10);
  if (!booking.isServiceZip(zip)) errors.push('That zip code is outside our current service area.');

  const stripeCustomerId = clean(input.stripeCustomerId, 80);
  const stripeSetupIntentId = clean(input.stripeSetupIntentId, 80);
  if (!/^cus_[A-Za-z0-9]+$/.test(stripeCustomerId) || !/^seti_[A-Za-z0-9]+$/.test(stripeSetupIntentId)) {
    errors.push('A card on file is required to book.');
  }

  return {
    errors,
    data: {
      serviceType,
      count,
      accessType,
      seniorDiscount: Boolean(input.seniorDiscount),
      ownBoxes: Math.min(Math.max(0, Math.floor(Number(input.ownBoxes) || 0)), 10),
      extraBoxes: Math.min(Math.max(0, Math.floor(Number(input.extraBoxes) || 0)), 10),
      serviceDay,
      slotStart,
      startMinutes,
      name,
      email,
      phone,
      address,
      zip,
      accessNotes: clean(input.accessNotes, 1000),
      notes: clean(input.notes, 2000),
      stripeCustomerId,
      stripeSetupIntentId,
    },
  };
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

  // Honeypot: bots fill every field. Pretend it worked.
  if (input.botField) {
    return json(200, { ok: true });
  }

  const { errors, data } = validate(input);
  if (errors.length) {
    return json(400, { error: errors.join(' '), errors });
  }

  const priced = booking.quote(data);
  if (priced.error) {
    return json(400, { error: priced.error === 'custom-quote' ? 'Contact us for a custom quote.' : priced.error });
  }

  // 1. Confirm the card really was saved to this customer (rejects forged ids).
  let card = null;
  try {
    const intent = await stripeRequest('GET', `/setup_intents/${data.stripeSetupIntentId}`, { expand: ['payment_method'] });
    if (intent.status !== 'succeeded' || intent.customer !== data.stripeCustomerId) {
      return json(400, { error: 'Your card was not saved. Please re-enter it and try again.' });
    }
    const pm = intent.payment_method && intent.payment_method.card;
    if (pm) card = { brand: pm.display_brand || pm.brand || 'Card', last4: pm.last4 };
  } catch (err) {
    console.error('create-booking: Stripe verification failed', err);
    if (err.status === 404) {
      return json(400, { error: 'Your card was not saved. Please re-enter it and try again.' });
    }
    return json(502, { error: 'We could not verify your card. Please try again in a moment.' });
  }

  // 2. Re-check the slot against live Airtable data right before writing.
  const durationMinutes = availability.visitDurationMinutes(data.serviceType, data.count);
  let takenByDay;
  try {
    const records = await availability.fetchActiveBookings(data.serviceDay);
    takenByDay = availability.takenIntervalsFromRecords(records);
  } catch (err) {
    console.error('create-booking: availability read failed', err);
    return json(502, { error: 'We could not confirm availability. Please try again in a moment.' });
  }
  const openNow = availability.openStarts(takenByDay[data.serviceDay], durationMinutes);
  if (!openNow.includes(data.startMinutes)) {
    return json(409, {
      error: 'That window was just taken. Please pick another time.',
      code: 'slot-taken',
      open: openNow.map(availability.formatTime),
    });
  }

  // 3. Write the customer.
  const slotEnd = availability.formatTime(availability.slotEndForStart(data.startMinutes, durationMinutes));
  const fields = {
    [FIELDS.name]: data.name,
    [FIELDS.status]: 'Active',
    [FIELDS.email]: data.email,
    [FIELDS.phone]: data.phone,
    [FIELDS.address]: data.address,
    [FIELDS.serviceType]: data.serviceType,
    [FIELDS.boxCount]: data.count,
    [FIELDS.accessType]: data.accessType,
    [FIELDS.serviceDay]: data.serviceDay,
    [FIELDS.slotStart]: data.slotStart,
    [FIELDS.slotEnd]: slotEnd,
    [FIELDS.stripeCustomerId]: data.stripeCustomerId,
    [FIELDS.stripeSetupIntentId]: data.stripeSetupIntentId,
    [FIELDS.signupDate]: todayCentral(),
  };
  if (data.accessNotes) fields[FIELDS.accessNotes] = data.accessNotes;
  if (data.seniorDiscount) fields[FIELDS.seniorDiscount] = true;
  if (booking.FOUNDING_MEMBER_PROMO_ACTIVE) fields[FIELDS.foundingMember] = true;
  if (priced.listedSetupFee === 0) fields[FIELDS.setupFeeStatus] = 'N/A';
  else if (priced.setupWaived) fields[FIELDS.setupFeeStatus] = 'Waived';
  // Otherwise left blank: a fee is still owed (goes on the first monthly bill),
  // mark Paid then.

  // Who supplies which boxes, in plain words, for Airtable, Slack and the email.
  let boxNote = '';
  let setupNote;
  if (priced.listedSetupFee === 0) setupNote = 'no setup fee';
  else {
    const parts = [];
    if (priced.suppliedBoxes > 0) parts.push(`we supply ${priced.suppliedBoxes} for the rotation`);
    if (priced.ownBoxes > 0) parts.push(`customer supplies ${priced.ownBoxes}`);
    if (priced.extraBoxes > 0) parts.push(`${priced.extraBoxes} extra to keep`);
    if (priced.foundingApplied) parts.push('one box covered by founding member offer');
    boxNote = parts.join(', ');
    setupNote = `boxes $${priced.setupFee} one-time (${boxNote}; $${priced.boxPrice} per box we supply)`;
  }

  const notesParts = [];
  if (data.notes) notesParts.push(data.notes);
  notesParts.push(`Quoted $${priced.price}/${priced.per}${priced.seniorApplied ? ' (senior 10% off)' : ''}, ${setupNote}${priced.foundingApplied ? ', founding member' : ''}. Booked online.`);
  fields[FIELDS.notes] = notesParts.join('\n');

  const slackData = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    address: data.address,
    zip: data.zip,
    serviceType: data.serviceType,
    count: data.count,
    accessType: data.accessType,
    serviceDay: data.serviceDay,
    slotStart: data.slotStart,
    slotEnd,
    price: `$${priced.price}/${priced.per}`,
    setupFee: priced.listedSetupFee === 0 ? 'no setup fee' : `$${priced.setupFee} boxes one-time (${boxNote})`,
    seniorDiscount: data.seniorDiscount,
    foundingMember: booking.FOUNDING_MEMBER_PROMO_ACTIVE,
    accessNotes: data.accessNotes,
    notes: data.notes,
    stripeCustomerId: data.stripeCustomerId,
  };

  let record;
  try {
    record = await createRecord(CUSTOMERS_TABLE, fields);
  } catch (err) {
    console.error('create-booking: Airtable write failed', err);
    // The card is already on file, so make sure Shawn hears about it even
    // though the customer record did not land.
    try {
      await notify({ formName: 'booking-failed', data: { ...slackData, failure: err.message } });
    } catch (slackErr) {
      console.error('create-booking: Slack failure notice failed', slackErr);
    }
    return json(502, {
      error: 'Your card was saved but we could not finish the booking. Please email hello@alamolitterpatrol.com and we will sort it out.',
      detail: err.message,
    });
  }

  // 4. Slack. A failure here must not fail the booking.
  try {
    await notify({ formName: 'booking', data: { ...slackData, recordId: record.id } });
  } catch (err) {
    console.error('create-booking: Slack notification failed', err);
  }

  // 5. Confirmation email with calendar attachment. Also non-fatal.
  const calendar = weeklyWindow({
    serviceLabel: priced.service,
    serviceDay: data.serviceDay,
    slotStart: data.slotStart,
    slotEnd,
    uid: `${record.id}@alamolitterpatrol.com`,
  });
  let emailSent = false;
  try {
    const mail = bookingEmail({
      booking: { ...data, slotEnd, price: priced.price, per: priced.per, seniorApplied: priced.seniorApplied, listedSetupFee: priced.listedSetupFee, setupFee: priced.setupFee, card },
      contact: { name: data.name, email: data.email },
      serviceLabel: priced.service,
      calendar,
      boxNote,
    });
    const result = await sendEmail({
      to: data.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: [{ filename: 'alamo-litter-patrol.ics', content: calendar.ics }],
    });
    emailSent = result.sent;
  } catch (err) {
    console.error('create-booking: confirmation email failed', err);
  }

  return json(200, {
    ok: true,
    recordId: record.id,
    emailSent,
    booking: {
      serviceType: data.serviceType,
      count: data.count,
      accessType: data.accessType,
      serviceDay: data.serviceDay,
      slotStart: data.slotStart,
      slotEnd,
      price: priced.price,
      per: priced.per,
      setupFee: priced.setupFee,
      listedSetupFee: priced.listedSetupFee,
      setupWaived: priced.setupWaived,
      ownBoxes: priced.ownBoxes,
      suppliedBoxes: priced.suppliedBoxes,
      extraBoxes: priced.extraBoxes,
      boxPrice: priced.boxPrice,
      foundingApplied: priced.foundingApplied,
      card,
      seniorApplied: priced.seniorApplied,
    },
  });
};
