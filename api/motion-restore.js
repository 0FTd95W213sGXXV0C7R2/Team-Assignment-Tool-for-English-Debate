import { reject, supabase } from './_admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (reject(req, res)) return;

  const { id, auditId, expectedRevision } = req.body || {};

  if (
    typeof id !== 'string' ||
    id.length < 1 ||
    id.length > 100 ||
    !Number.isSafeInteger(auditId) ||
    auditId <= 0 ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    const restored = await supabase('rpc/motion_restore_revision_checked', {
      method: 'POST',
      body: JSON.stringify({
        p_id: id,
        p_audit_id: auditId,
        p_expected_revision: expectedRevision
      })
    });

    return res.status(200).json({ restored });
  } catch (error) {
    const message = error.message || '';

    if (message.includes('DUPLICATE_MOTION')) {
      return res.status(409).json({
        error: 'Duplicate motion'
      });
    }

    if (message.includes('REVISION_CONFLICT')) {
      return res.status(409).json({ error: 'Revision conflict' });
    }

    if (message.includes('NOT_FOUND') ||
        message.includes('SNAPSHOT_NOT_FOUND')) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (message.includes('INVALID_REQUEST') ||
        message.includes('INVALID_SNAPSHOT')) {
      return res.status(422).json({ error: 'Invalid restore request' });
    }

    console.error('Restore RPC failed:', message);
    return res.status(500).json({ error: 'Restore failed' });
  }
}
