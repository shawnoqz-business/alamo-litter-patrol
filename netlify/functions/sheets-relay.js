exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sheetsWebhookUrl = process.env.SHEETS_WEBHOOK_URL;
  if (!sheetsWebhookUrl) {
    console.error('SHEETS_WEBHOOK_URL is not set');
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
