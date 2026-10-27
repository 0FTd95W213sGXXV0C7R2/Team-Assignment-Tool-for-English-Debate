import { supabase } from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  const { motion, tournament, year, history } = req.body || {};

  if (
    typeof motion !== "string" ||
    !motion.trim() ||
    motion.length > 2000 ||
    typeof tournament !== "string" ||
    !tournament.trim() ||
    tournament.length > 200 ||
    !/^\d{4}$/.test(String(year))
  ) {
    return send(res, 400, { error: "Invalid request" });
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
        p_client_hash: "public-record",
      },
    });

    return send(res, 200, { ok: true, result });
  } catch (error) {
    console.error("motion-record failed:", error.status || "unknown");
    return send(res, 500, { error: "Failed to record motion" });
  }
}
