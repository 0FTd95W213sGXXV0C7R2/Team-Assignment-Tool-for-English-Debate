
import { requireAdmin, supabase } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAdmin(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const motionId = req.query?.motionId;
    let path = "motion_audit?select=*&order=created_at.desc&limit=100";

    if (motionId !== undefined) {
      if (
        typeof motionId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(motionId)
      ) {
        return res.status(400).json({ error: "Invalid motionId" });
      }

      path += "&motion_id=eq." + encodeURIComponent(motionId);
    }

    const rows = await supabase(path);

    return res.status(200).json({
      ok: true,
      history: Array.isArray(rows) ? rows : []
    });
  } catch (error) {
    console.error(
      "motion-history failed:",
      error.status || "unknown"
    );

    return res.status(500).json({
      error: "Failed to load motion history"
    });
  }
}
