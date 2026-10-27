import { createHash } from 'node:crypto';
import { normalizeNonNegativeBigint, reject, supabase } from './_admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (reject(req, res)) return;

  const {
    action,
    id,
    row,
    expectedRevision
  } = req.body || {};
  const targetId = typeof id === 'number' && Number.isSafeInteger(id)
    ? String(id)
    : id;
  const revision = normalizeNonNegativeBigint(expectedRevision);
  const allowedFields = new Set(['motion', 'tournament', 'year', 'history']);

  if (!['insert', 'update', 'delete', 'record'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  if (action === 'insert' &&
      ((id !== undefined && id !== null) ||
       (expectedRevision !== undefined && expectedRevision !== null))) {
    return res.status(400).json({ error: 'Invalid target' });
  }

  if (action !== 'insert' && (
    typeof targetId !== 'string' ||
    targetId.length < 1 ||
    targetId.length > 100 ||
    revision === null
  )) {
    return res.status(400).json({ error: 'Invalid target' });
  }

  if (['insert', 'update'].includes(action)) {
    const invalidHistory = row?.history !== undefined &&
      (!Array.isArray(row.history) || row.history.length > 1000 ||
        row.history.some(value => typeof value !== 'string' ||
          Number.isNaN(Date.parse(value))));
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).some(key => !allowedFields.has(key)) ||
        typeof row.motion !== 'string' || !row.motion.trim() ||
        row.motion.length > 2000 ||
        typeof row.tournament !== 'string' || row.tournament.length > 300 ||
        typeof row.year !== 'string' || row.year.length > 20 ||
        invalidHistory || !Array.isArray(row.history)) {
      return res.status(400).json({ error: 'Invalid row' });
    }
  }

  try {
    // 管理者操作の識別子。固定値ではなく環境変数から生成。
    const clientHash = createHash('sha256')
      .update('admin:' + process.env.ADMIN_API_TOKEN)
      .digest('hex');

    const result = await supabase('rpc/motion_apply', {
      method: 'POST',
      body: JSON.stringify({
        p_action: action,
        p_id: targetId ?? null,
        p_row: row ?? null,
        p_expected_revision: revision,
        p_client_hash: clientHash
      })
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = String(error.message || '');

    if (message === 'REVISION_CONFLICT' ||
        message === 'DUPLICATE_MOTION') {
      return res.status(409).json({ error: message });
    }

    if (message === 'NOT_FOUND' || message === 'DELETED') {
      return res.status(404).json({ error: message });
    }

    if (message.startsWith('RATE_LIMIT')) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    console.error('Motion write failed');
    return res.status(500).json({ error: 'Write failed' });
  }
}
