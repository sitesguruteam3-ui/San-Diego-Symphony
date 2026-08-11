import { neon } from '@neondatabase/serverless';

const DEFAULT_LAUNCH_AT = '2026-08-11T07:00:00.000Z';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function response(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function isAuthorized(event) {
  const expected = process.env.ADMIN_API_KEY;
  const received = event.headers?.['x-admin-key'] || event.headers?.['X-Admin-Key'];
  return Boolean(expected && received && received === expected);
}

export async function handler(event) {
  if (!process.env.DATABASE_URL) return response(500, { error: 'DATABASE_URL is not configured.' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS site_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    if (event.httpMethod === 'POST') {
      if (!isAuthorized(event)) return response(401, { error: 'Incorrect password.' });
      return response(200, { authenticated: true });
    }

    if (event.httpMethod === 'GET') {
      const rows = await sql`
        SELECT setting_value, updated_at
        FROM site_settings
        WHERE setting_key = 'individual_tickets_launch_at'
        LIMIT 1
      `;
      return response(200, {
        individualTicketsLaunchAt: rows[0]?.setting_value || DEFAULT_LAUNCH_AT,
        updatedAt: rows[0]?.updated_at || null
      });
    }

    if (event.httpMethod === 'PUT') {
      if (!isAuthorized(event)) return response(401, { error: 'Invalid admin key.' });

      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch { return response(400, { error: 'Request body must be valid JSON.' }); }

      const launchAt = body.individualTicketsLaunchAt;
      const timestamp = typeof launchAt === 'string' ? Date.parse(launchAt) : NaN;
      if (!Number.isFinite(timestamp)) return response(400, { error: 'A valid launch timestamp is required.' });

      const normalizedLaunchAt = new Date(timestamp).toISOString();
      const rows = await sql`
        INSERT INTO site_settings (setting_key, setting_value, updated_at)
        VALUES ('individual_tickets_launch_at', ${normalizedLaunchAt}, NOW())
        ON CONFLICT (setting_key)
        DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
        RETURNING setting_value, updated_at
      `;

      return response(200, {
        individualTicketsLaunchAt: rows[0].setting_value,
        updatedAt: rows[0].updated_at
      });
    }

    return response(405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('ticket-schedule function failed', error);
    return response(500, { error: 'Unable to access the schedule.' });
  }
}
