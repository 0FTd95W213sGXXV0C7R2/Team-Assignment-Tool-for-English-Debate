import { timingSafeEqual } from 'node:crypto';

export function requireAdmin(req) {
  const secret = process.env.ADMIN_API_TOKEN;
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secret || !supplied) return false;
  const a = Buffer.from(secret), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeNonNegativeBigint(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return String(value);
  }
  if (typeof value !== 'string' || value.length > 19 ||
      !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    if (parsed > 9223372036854775807n) return null;
    return value;
  } catch {
    return null;
  }
}

function parseSupabaseJson(text) {
  const preserved = text.replace(
    /("(?:id|revision|audit_id)"\s*:\s*)(-?\d+)(?=\s*[,}\]])/g,
    (match, prefix, digits) => {
      if (Number.isSafeInteger(Number(digits))) return match;
      return prefix + JSON.stringify(digits);
    }
  );
  return JSON.parse(preserved);
}

export async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw new Error('Server configuration missing');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers }
  });
  const responseText = await response.text();
  const body = responseText ? parseSupabaseJson(responseText) : {};
  if (!response.ok) {
    const allowed = [
      'REVISION_CONFLICT',
      'DUPLICATE_MOTION',
      'NOT_FOUND',
      'DELETED',
      'SNAPSHOT_NOT_FOUND',
      'INVALID_REQUEST',
      'INVALID_SNAPSHOT'
    ];
    const message = String(body.message || '');
    const code = allowed.find(value => message === value) ||
      (message.startsWith('RATE_LIMIT') ? message : null);
    throw new Error(code || `Database request failed (${response.status})`);
  }
  return response.status === 204 ? null : body;
}

export function reject(req, res) {
  if (!requireAdmin(req)) { res.status(401).json({ error: 'Unauthorized' }); return true; }
  return false;
}
