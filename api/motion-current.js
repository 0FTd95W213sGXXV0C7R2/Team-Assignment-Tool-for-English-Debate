import { reject, supabase } from './_admin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (reject(req, res)) return;

  const id = req.query?.id;

  if (typeof id !== 'string' || id.length < 1 || id.length > 100) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  try {
    const rows = await supabase(
      'motions?select=id,motion,tournament,year,history,revision,is_deleted&id=eq.' +
      encodeURIComponent(id) +
      '&limit=1'
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json(rows[0]);
  } catch {
    return res.status(500).json({ error: 'Failed to load revision' });
  }
}
