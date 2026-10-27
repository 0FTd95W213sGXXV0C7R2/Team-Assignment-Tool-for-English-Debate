import { createHash } from "node:crypto";
import { requireAdmin, supabase } from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

function validText(value, max = 500) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  if (!requireAdmin(req)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return send(res, 400, { error: "Invalid request body" });
  }

  const { action, motion, tournament, year, history, expectedRevision } = body;

  if (!["insert", "update", "delete", "record"].includes(action)) {
    return send(res, 400, { error: "Invalid action" });
  }

  if (!validText(motion, 2000)) {
    return send(res, 400, { error: "Invalid motion" });
  }

  if (!validText(tournament, 200)) {
    return send(res, 400, { error: "Invalid tournament" });
  }

  if (
    !(typeof year === "string" || typeof year === "number") ||
    !/^\d{4}$/.test(String(year))
  ) {
    return send(res, 400, { error: "Invalid year" });
  }

  const tokenHash = createHash("sha256")
    .update(process.env.ADMIN_API_TOKEN || "")
    .digest("hex");

  try {
    const result = await supabase("rpc/motion_apply", {
      method: "POST",
      body: {
        p_action: action,
        p_motion: motion.trim(),
        p_tournament: tournament.trim(),
        p_year: Number(year),
        p_history: history ?? {},
        p_expected_revision: expectedRevision ?? null,
        p_client_hash: tokenHash,
      },
    });

    return send(res, 200, { ok: true, result });
  } catch (error) {
    const message = error.data?.message || error.message || "";

    if (/conflict|revision/i.test(message)) {
      return send(res, 409, { error: "Revision conflict" });
    }

    if (/duplicate|unique/i.test(message)) {
      return send(res, 409, { error: "Duplicate motion" });
    }

    if (/not found/i.test(message)) {
      return send(res, 404, { error: "Motion not found" });
    }

    console.error("motion-write failed:", error.status || "unknown");
    return send(res, 500, { error: "Failed to update motion" });
  }
}
