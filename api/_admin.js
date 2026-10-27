import { timingSafeEqual } from 'node:crypto';

export function requireAdmin(req) {
  const secret = process.env.ADMIN_API_TOKEN;
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secret || !supplied) return false;
  const a = Buffer.from(secret), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw new Error('Server configuration missing');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const allowed = [
      'REVISION_CONFLICT',
      'NOT_FOUND',
      'SNAPSHOT_NOT_FOUND',
      'INVALID_REQUEST',
      'INVALID_SNAPSHOT'
    ];
    const message = String(body.message || '');
    const code = allowed.find(value => message === value);
    throw new Error(code || `Database request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

export function reject(req, res) {
  if (!requireAdmin(req)) { res.status(401).json({ error: 'Unauthorized' }); return true; }
  return false;
}
