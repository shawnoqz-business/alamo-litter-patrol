// Netlify form-submission notifications land here as an outgoing webhook, set
// up as an "any form" notification, so every form on the site hits this one
// function. Branch on form_name to decide channel and message shape.
//
//   out-of-area-waitlist (service-area.html, email+zip) -> SLACK_WEBHOOK_URL        -> #leads
//   founding-member      (founding-member.html, mailer) -> MAILER_SLACK_WEBHOOK_URL -> #mailer-responses
//   booking              (book.html, via create-booking.js, not a Netlify form)
//                                                       -> BOOKING_SLACK_WEBHOOK_URL (bookings channel; #leads is for promos only)
//
// create-booking.js calls notify() directly rather than going through the
// webhook, so the message-building and posting live in notify() and the
// handler is just the webhook adapter.

const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };

function buildMessage({ formName, data = {}, human = {} }) {
  const isFoundingMember = formName === 'founding-member';
  const email = data.email || human.Email || 'unknown';
  const zip = data.zip || human.Zip || '';

  if (formName === 'booking' || formName === 'booking-failed') {
    const failed = formName === 'booking-failed';
    const unit = data.serviceType === 'Litter-Robot' ? 'unit' : 'box';
    const count = Number(data.count) || 1;
    const day = DAY_NAMES[data.serviceDay] || data.serviceDay || '?';
    const lines = [
      failed
        ? `:rotating_light: *Booking failed for ${data.name || 'unknown'}* (card saved in Stripe, no Airtable record)`
        : `:paw_prints: *New booking: ${data.name || 'unknown'}*`,
      `${data.serviceType || '?'}, ${count} ${unit}${count === 1 ? '' : unit === 'box' ? 'es' : 's'}, ${(data.accessType || '?').toLowerCase()}`,
      `${day}s, ${data.slotStart || '?'} to ${data.slotEnd || '?'}`,
      `${data.price || ''}${data.seniorDiscount ? ' (senior discount)' : ''} · ${data.setupFee || 'setup fee ?'}${data.foundingMember ? ' · founding member' : ''}`,
      `${data.address || ''}`,
      `${data.phone || 'no phone'} · ${email}`,
    ];
    if (data.accessNotes) lines.push(`Access: ${data.accessNotes}`);
    if (data.notes) lines.push(`Notes: ${data.notes}`);
    if (failed) {
      if (data.stripeCustomerId) lines.push(`Stripe customer ${data.stripeCustomerId}`);
      lines.push(`Error: ${data.failure || 'unknown'}. Add this customer to Airtable by hand.`);
    }
    return { text: lines.join('\n'), webhookEnv: 'BOOKING_SLACK_WEBHOOK_URL' };
  }

  if (isFoundingMember) {
    const name = data.name || human.Name || 'unknown';
    const phone = data.phone || human.Phone || 'no phone';
    return { text: `FOUNDING MEMBER (mailer): ${name} - ${email} - ${phone} (${zip})`, webhookEnv: 'MAILER_SLACK_WEBHOOK_URL' };
  }

  if (formName === 'out-of-area-waitlist' || formName === '') {
    // Empty form name means an older payload shape; the waitlist was the only
    // form on the site until founding-member shipped, so that stays the default.
    return { text: `WAITLIST (out of area): ${email} (${zip})`, webhookEnv: 'SLACK_WEBHOOK_URL' };
  }

  // A form this function hasn't been taught about yet. Say so plainly rather
  // than silently mislabeling it as a waitlist signup.
  return { text: `NEW SUBMISSION (${formName}): ${email} (${zip})`, webhookEnv: 'SLACK_WEBHOOK_URL' };
}

// Builds and posts the Slack message. Resolves true when Slack accepted it.
async function notify({ formName, data, human }) {
  const { text, webhookEnv } = buildMessage({ formName, data, human });
  const webhookUrl = process.env[webhookEnv];
  if (!webhookUrl) {
    console.error(`${webhookEnv} is not set`);
    return false;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error('Slack rejected the message', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to post to Slack', err);
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body = {};
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    console.error('Failed to parse form submission payload', e);
  }

  const data = body.data || {};
  const human = body.human_fields || {};
  const formName = body.form_name || data['form-name'] || '';

  const { webhookEnv } = buildMessage({ formName, data, human });
  if (!process.env[webhookEnv]) {
    console.error(`${webhookEnv} is not set`);
    return { statusCode: 500, body: 'Missing Slack webhook URL' };
  }

  await notify({ formName, data, human });
  return { statusCode: 200, body: 'ok' };
};

exports.notify = notify;
exports.buildMessage = buildMessage;
