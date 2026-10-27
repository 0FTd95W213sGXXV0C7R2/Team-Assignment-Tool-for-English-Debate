import { reject, supabase } from './_admin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (reject(req, res)) return;

  const offset = Number(req.query?.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= 50000) {
    return res.status(400).json({ error: 'Invalid offset' });
  }

  try {
    const rows = await supabase(
      'motions?select=id,motion,tournament,year,revision,is_deleted' +
      '&order=id.asc&offset=' + offset + '&limit=1000'
    );
    return res.status(200).json(rows);
  } catch {
    console.error('Admin motion list query failed');
    return res.status(500).json({ error: 'Failed to load motions' });
  }
}
