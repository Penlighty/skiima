import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const turnKeyApiToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;

  if (!turnKeyId || !turnKeyApiToken) {
    console.error('[API] Cloudflare TURN environment variables are not configured.');
    res.status(500).json({ error: 'Cloudflare TURN credentials are not configured on the server.' });
    return;
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${turnKeyApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttl: 86400 })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudflare API returned status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error: any) {
    console.error('[API] Error generating Cloudflare TURN credentials:', error);
    res.status(500).json({ error: error.message || 'Failed to generate credentials' });
  }
}
