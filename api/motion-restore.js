import { reject, supabase } from './_admin.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (reject(req, res)) return;
  const { id, auditId, expectedRevision } = req.body || {};
  if (typeof id !== 'string' || !id || id.length > 100 || !Number.isSafeInteger(auditId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return res.status(400).json({ error: 'Invalid request' });
  try {
    const audits = await supabase(`motion_audit?audit_id=eq.${auditId}&motion_id=eq.${encodeURIComponent(id)}&select=before_data,action&limit=1`);
    const snapshot = audits?.[0]?.before_data;
    if (!snapshot || snapshot.id !== id || !['UPDATE','DELETE'].includes(audits[0].action)) return res.status(404).json({ error: 'Snapshot unavailable' });
    if (typeof snapshot.tournament !== 'string' || !Array.isArray(snapshot.history)) return res.status(422).json({ error: 'Invalid snapshot' });
    const payload = { motion: snapshot.motion, tournament: snapshot.tournament, year: snapshot.year, history: snapshot.history, is_deleted: false, revision: expectedRevision + 1 };
    const rows = await supabase(`motions?id=eq.${encodeURIComponent(id)}&revision=eq.${expectedRevision}&select=id,revision`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) });
    if (!rows?.length) return res.status(409).json({ error: 'Revision conflict or missing row' });
    return res.status(200).json({ restored: rows[0] });
  } catch { return res.status(500).json({ error: 'Restore failed' }); }
}
