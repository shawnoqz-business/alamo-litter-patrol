// Booking confirmation email, sent through Resend's REST API.
//
// Env:
//   RESEND_API_KEY        required to send; when missing, sending is skipped
//                         (logged) and the booking still succeeds.
//   BOOKING_FROM_EMAIL    optional, default "Alamo Litter Patrol <hello@alamolitterpatrol.com>"
//                         (the domain must be verified in Resend)
//   BOOKING_NOTIFY_EMAIL  optional, default hello@alamolitterpatrol.com, gets a copy

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Alamo Litter Patrol <hello@alamolitterpatrol.com>';
const DEFAULT_NOTIFY = 'hello@alamolitterpatrol.com';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(n) {
  return `$${Number(n).toLocaleString('en-US')}`;
}

// Builds subject/html/text for a completed booking.
function bookingEmail({ booking: b, contact, serviceLabel, calendar, boxNote }) {
  const firstName = (contact.name || '').split(' ')[0] || 'there';
  const unit = b.serviceType === 'Litter-Robot' ? 'unit' : 'box';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : w === 'box' ? 'es' : 's'}`;
  const days = `${calendar.dayName}s`;
  const priceLine = `${money(b.price)}/${b.per}${b.seniorApplied ? ' with senior discount' : ''}`;
  const setupLine = b.listedSetupFee === 0 ? 'No setup fee' : `${money(b.setupFee)} one-time for boxes we supply${boxNote ? ` (${boxNote})` : ''}`;

  const rows = [
    ['Service', `${serviceLabel}, ${plural(b.count, unit)}, ${b.accessType.toLowerCase()}`],
    ['Your window', `${days}, ${b.slotStart} to ${b.slotEnd}`],
    ['Price', priceLine],
    ['Setup', setupLine],
    ['Card on file', b.card ? `${b.card.brand} ending in ${b.card.last4}, nothing charged yet` : 'saved, nothing charged yet'],
  ];

  const next = [
    ['Within 24-48 hours', 'We email or text to say hello and confirm your first service date.'],
    ['Day before service', 'Reminder text with option to reply SKIP.'],
    ['Service day', "We arrive within your window and do the job. For porch service, or if you're not around, we text a photo when we're done so you know your box is ready."],
    ['Billing', "On the 1st of each month we charge your card for the previous month's visits."],
  ];

  const subject = `You're booked: ${serviceLabel} on ${days}`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FDF6EC;font-family:'DM Sans',Helvetica,Arial,sans-serif;color:#023047;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="background:#ffffff;border-radius:8px;padding:28px 24px;border:2px solid #219EBC;">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#219EBC;font-weight:700;">You're booked</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;">See you ${escapeHtml(calendar.dayName)}, ${escapeHtml(firstName)}!</h1>
    <table style="width:100%;border-collapse:collapse;font-size:15px;">
      ${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #E8E8E8;font-weight:700;width:38%;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:8px 0;border-bottom:1px solid #E8E8E8;vertical-align:top;">${escapeHtml(v)}</td></tr>`).join('')}
    </table>
    <p style="margin:20px 0 10px;"><a href="${calendar.googleUrl}" style="display:inline-block;background:#FFB703;color:#023047;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:4px;font-size:14px;">Add to Google Calendar</a></p>
    <p style="margin:0 0 20px;font-size:13px;color:#555555;">Apple or Outlook? Open the attached calendar file. The entry repeats weekly starting ${escapeHtml(calendar.firstDateLabel)}. We'll text you to confirm your first visit date. If it changes, just update the calendar entry.</p>
    <h2 style="margin:24px 0 8px;font-size:18px;">What happens next</h2>
    <ul style="padding-left:18px;margin:0;font-size:15px;line-height:1.6;">
      ${next.map(([k, v]) => `<li style="margin-bottom:6px;"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</li>`).join('')}
    </ul>
    <p style="margin:24px 0 0;font-size:14px;color:#555555;">Need to change anything? Reply to this email or write to <a href="mailto:hello@alamolitterpatrol.com" style="color:#219EBC;">hello@alamolitterpatrol.com</a>.</p>
  </div>
  <p style="text-align:center;font-size:12px;color:#888888;margin:16px 0 0;">Alamo Litter Patrol &middot; San Antonio, TX &middot; Built by cat people. For cat people.</p>
</div>
</body></html>`;

  const text = [
    `You're booked! See you ${calendar.dayName}, ${firstName}.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Add to Google Calendar: ${calendar.googleUrl}`,
    `Apple or Outlook: open the attached calendar file. Repeats weekly starting ${calendar.firstDateLabel}.`,
    '',
    'What happens next',
    ...next.map(([k, v]) => `- ${k}: ${v}`),
    '',
    'Need to change anything? Reply to this email or write to hello@alamolitterpatrol.com.',
  ].join('\n');

  return { subject, html, text };
}

// Sends through Resend. Resolves { sent: true, id } or { sent: false, reason }.
async function sendEmail({ to, subject, html, text, attachments = [], bcc }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('email: RESEND_API_KEY is not set; skipping confirmation email');
    return { sent: false, reason: 'not-configured' };
  }
  const payload = {
    from: process.env.BOOKING_FROM_EMAIL || DEFAULT_FROM,
    to: [to],
    bcc: bcc === undefined ? [process.env.BOOKING_NOTIFY_EMAIL || DEFAULT_NOTIFY] : bcc,
    reply_to: process.env.BOOKING_NOTIFY_EMAIL || DEFAULT_NOTIFY,
    subject,
    html,
    text,
    attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'utf8').toString('base64') })),
  };
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error('email: Resend rejected the message', res.status, body);
    return { sent: false, reason: `resend-${res.status}` };
  }
  let id = null;
  try {
    id = JSON.parse(body).id;
  } catch (e) {
    id = null;
  }
  return { sent: true, id };
}

module.exports = { bookingEmail, sendEmail };
