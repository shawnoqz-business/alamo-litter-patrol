exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('SLACK_WEBHOOK_URL is not set');
    return { statusCode: 500, body: 'Missing Slack webhook URL' };
  }

  let email = 'unknown';
  let zip = '';
  try {
    const body = JSON.parse(event.body);
    email = body.data?.email || body.human_fields?.Email || email;
    zip = body.data?.zip || '';
  } catch (e) {
    console.error('Failed to parse form submission payload', e);
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `WAITLIST (out of area): ${email} (${zip})` }),
  });

  return { statusCode: 200, body: 'ok' };
};
