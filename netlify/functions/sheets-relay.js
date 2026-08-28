// Dumb forwarder: passes the raw Netlify submission payload through to a Google
// Apps Script Web App, which does the actual row-writing. It exists because
// pointing Netlify straight at an Apps Script /exec URL fails health checks
// (Apps Script's redirect reads as a 4xx/5xx to Netlify).
//
//   out-of-area-waitlist -> SHEETS_WEBHOOK_URL        -> "Email Signups" sheet, Waitlist tab
//   founding-member      -> MAILER_SHEETS_WEBHOOK_URL -> founding-member sheet
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let formName = '';
  try {
    const body = JSON.parse(event.body);
    formName = body.form_name || body.data?.['form-name'] || '';
  } catch (e) {
    console.error('Failed to parse form submission payload', e);
  }

  const isFoundingMember = formName === 'founding-member';
  if (formName && formName !== 'founding-member' && formName !== 'out-of-area-waitlist') {
    console.warn(`Unrecognized form "${formName}"; relaying to the default sheet.`);
  }

  const sheetsWebhookUrl = isFoundingMember
    ? process.env.MAILER_SHEETS_WEBHOOK_URL
    : process.env.SHEETS_WEBHOOK_URL;

  if (!sheetsWebhookUrl) {
    console.error(
      isFoundingMember ? 'MAILER_SHEETS_WEBHOOK_URL is not set' : 'SHEETS_WEBHOOK_URL is not set'
    );
    return { statusCode: 500, body: 'Missing Sheets webhook URL' };
  }

  try {
    await fetch(sheetsWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body,
    });
  } catch (err) {
    console.error('Failed to forward submission to Apps Script', err);
  }

  return { statusCode: 200, body: 'ok' };
};
