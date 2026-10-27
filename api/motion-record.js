
import { requireAdmin, supabase } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAdmin(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { motion, tournament, year, history } = req.body || {};

  if (
    typeof motion !== "string" ||
    !motion.trim() ||
    motion.length > 2000 ||
    typeof tournament !== "string" ||
    tournament.length > 200 ||
    !/^\d{4}$/.test(String(year))
  ) {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    const result = await supabase("rpc/motion_apply", {
      method: "POST",
      body: {
        p_action: "record",
        p_motion: motion.trim(),
        p_tournament: tournament.trim(),
        p_year: Number(year),
        p_history: history ?? {},
        p_expected_revision: null,
        p_client_hash: "admin-record"
      }
    });

    return res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error(
      "motion-record failed:",
      error.status || "unknown"
    );
    return res.status(500).json({
      error: "Failed to record motion"
    });
  }
}
