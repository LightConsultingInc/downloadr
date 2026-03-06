import https from 'https';

const PENDO_DATA_HOST = 'data.pendo-dev.pendo-dev.com';
const PENDO_INTEGRATION_KEY = '5729d3c6-40d6-40f3-aae6-dded20f60ec6';

/**
 * Sends a server-side Track Event to Pendo.
 * Failures are logged but never propagate to the caller.
 */
export function pendoTrack(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  try {
    const body = JSON.stringify({
      type: 'track',
      event,
      visitorId: 'system',
      accountId: 'system',
      timestamp: Date.now(),
      properties,
    });

    const req = https.request(
      {
        hostname: PENDO_DATA_HOST,
        path: '/data/track',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pendo-integration-key': PENDO_INTEGRATION_KEY,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        // Drain the response so the socket can be reused
        res.resume();
      },
    );

    req.on('error', () => {
      // Silently ignore – tracking must never break downloads
    });

    req.write(body);
    req.end();
  } catch {
    // Silently ignore
  }
}
