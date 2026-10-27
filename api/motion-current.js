import { requireAdmin, supabase } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAdmin(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const motionId = req.query?.motionId;

  if (
    typeof motionId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(motionId)
  ) {
    return res.status(400).json({ error: "Invalid motionId" });
  }

  try {
    const rows = await supabase(
      `motions?select=*&id=eq.${encodeURIComponent(motionId)}&limit=1`
    );

    const motion = Array.isArray(rows) ? rows[0] ?? null : null;

    if (!motion) {
      return res.status(404).json({ error: "Motion not found" });
    }

    return res.status(200).json({ ok: true, motion });
  } catch (error) {
    console.error("motion-current failed:", error.status || "unknown");
    return res.status(500).json({
      error: "Failed to load motion",
    });
  }
}
