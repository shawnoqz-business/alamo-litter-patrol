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
  try {
    const body = JSON.parse(event.body);
    email = body.payload?.data?.email || body.payload?.human_fields?.email || email;
  } catch (e) {
    console.error('Failed to parse form submission payload', e);
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `New email signup: ${email}` }),
  });

  return { statusCode: 200, body: 'ok' };
};
