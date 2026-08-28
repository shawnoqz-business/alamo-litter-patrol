// Netlify form-submission notifications land here as an outgoing webhook, set
// up as an "any form" notification, so every form on the site hits this one
// function. Branch on form_name to decide channel and message shape.
//
//   out-of-area-waitlist (service-area.html, email+zip) -> SLACK_WEBHOOK_URL        -> #leads
//   founding-member      (founding-member.html, mailer) -> MAILER_SLACK_WEBHOOK_URL -> #mailer-responses
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
  const isFoundingMember = formName === 'founding-member';

  const webhookUrl = isFoundingMember
    ? process.env.MAILER_SLACK_WEBHOOK_URL
    : process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.error(
      isFoundingMember ? 'MAILER_SLACK_WEBHOOK_URL is not set' : 'SLACK_WEBHOOK_URL is not set'
    );
    return { statusCode: 500, body: 'Missing Slack webhook URL' };
  }

  const email = data.email || human.Email || 'unknown';
  const zip = data.zip || human.Zip || '';

  let text;
  if (isFoundingMember) {
    const name = data.name || human.Name || 'unknown';
    const phone = data.phone || human.Phone || 'no phone';
    text = `FOUNDING MEMBER (mailer): ${name} - ${email} - ${phone} (${zip})`;
  } else if (formName === 'out-of-area-waitlist' || formName === '') {
    // Empty form name means an older payload shape; the waitlist was the only
    // form on the site until founding-member shipped, so that stays the default.
    text = `WAITLIST (out of area): ${email} (${zip})`;
  } else {
    // A form this function hasn't been taught about yet. Say so plainly rather
    // than silently mislabeling it as a waitlist signup.
    text = `NEW SUBMISSION (${formName}): ${email} (${zip})`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error('Slack rejected the message', res.status, await res.text());
    }
  } catch (err) {
    console.error('Failed to post to Slack', err);
  }

  return { statusCode: 200, body: 'ok' };
};
