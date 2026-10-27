import { createHash } from 'node:crypto';
import { normalizeNonNegativeBigint, supabase } from './_admin.js';

const publicClientHash = createHash('sha256')
  .update('public:motion-record')
  .digest('hex');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  const targetId = typeof body?.id === 'number' && Number.isSafeInteger(body.id)
    ? String(body.id)
    : body?.id;
  const revision = normalizeNonNegativeBigint(body?.expectedRevision);

  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, 'id') ||
      !Object.hasOwn(body, 'expectedRevision') ||
      typeof targetId !== 'string' ||
      targetId.length < 1 ||
      targetId.length > 100 ||
      revision === null) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    const result = await supabase('rpc/motion_apply', {
      method: 'POST',
      body: JSON.stringify({
        p_action: 'record',
        p_id: targetId,
        p_row: null,
        p_expected_revision: revision,
        p_client_hash: publicClientHash
      })
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = String(error.message || '');

    if (message === 'REVISION_CONFLICT') {
      return res.status(409).json({ error: message });
    }

    if (message === 'NOT_FOUND' || message === 'DELETED') {
      return res.status(404).json({ error: message });
    }

    if (message.startsWith('RATE_LIMIT')) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    console.error('Motion record failed');
    return res.status(500).json({ error: 'Record failed' });
  }
}
