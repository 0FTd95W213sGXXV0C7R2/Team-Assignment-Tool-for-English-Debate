import { createHash } from 'node:crypto';
import { reject, supabase } from './_admin.js';

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

  if (!['insert', 'update', 'delete', 'record'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  if (action !== 'insert' && (
    typeof id !== 'string' ||
    id.length < 1 ||
    id.length > 100 ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  )) {
    return res.status(400).json({ error: 'Invalid target' });
  }

  if (['insert', 'update'].includes(action) && (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row)
  )) {
    return res.status(400).json({ error: 'Invalid row' });
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
        p_id: id ?? null,
        p_row: row ?? null,
        p_expected_revision: expectedRevision ?? null,
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

    console.error('Motion write failed:', message);
    return res.status(500).json({ error: 'Write failed' });
  }
}
