import { reject, supabase } from './_admin.js';
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (reject(req, res)) return;
  const id = String(req.query?.id || '');
  if (!id || id.length > 100) return res.status(400).json({ error: 'Invalid id' });
  const offset = Number(req.query?.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= 50000) {
    return res.status(400).json({ error: 'Invalid offset' });
  }
  try {
    const rows = await supabase(`motion_audit?motion_id=eq.${encodeURIComponent(id)}&select=audit_id,motion_id,action,before_data,after_data,changed_at&order=audit_id.desc&offset=${offset}&limit=100`);
    return res.status(200).json({ rows });
  } catch {
    console.error('Motion history query failed');
    return res.status(500).json({ error: 'Failed to load history' });
  }
}
