
import { createHash } from "node:crypto";
import { requireAdmin, supabase } from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

function normalizeRevision(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!/^\d+$/.test(String(value))) return undefined;

  try {
    const n = BigInt(value);
    if (n < 0n || n > 9223372036854775807n) return undefined;
    return n.toString();
  } catch {
    return undefined;
  }
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
    return send(res, 400, { error: "Invalid request" });
  }

  const { action } = body;
  if (!["insert", "update", "delete", "record"].includes(action)) {
    return send(res, 400, { error: "Invalid action" });
  }

  const id = body.id === undefined ? null : String(body.id);
  if (action !== "insert" && (!id || !/^\d+$/.test(id))) {
    return send(res, 400, { error: "Invalid id" });
  }

  const expectedRevision = normalizeRevision(body.expectedRevision);
  if (expectedRevision === undefined) {
    return send(res, 400, { error: "Invalid revision" });
  }

  const row = body.row && typeof body.row === "object" &&
    !Array.isArray(body.row) ? body.row : {};

  const motion = body.motion ?? row.motion;
  const tournament = body.tournament ?? row.tournament ?? "";
  const year = body.year ?? row.year;
  const history = body.history ?? row.history ?? [];

  if (action !== "delete" && action !== "record") {
    if (
      typeof motion !== "string" ||
      !motion.trim() ||
      motion.length > 2000 ||
      typeof tournament !== "string" ||
      tournament.length > 200 ||
      !/^\d{4}$/.test(String(year))
    ) {
      return send(res, 400, { error: "Invalid motion data" });
    }
  }

  const tokenHash = createHash("sha256")
    .update(process.env.ADMIN_API_TOKEN || "")
    .digest("hex");

  try {
    const result = await supabase("rpc/motion_apply", {
      method: "POST",
      body: {
        p_action: action,
        p_id: id,
        p_row: action === "delete" || action === "record"
          ? null
          : {
              motion: motion.trim(),
              tournament: tournament.trim(),
              year: Number(year),
              history
            },
        p_expected_revision: expectedRevision,
        p_client_hash: tokenHash
      }
    });

    return send(res, 200, result);
  } catch (error) {
    const message = error.data?.message || error.message || "";

    if (/conflict|revision/i.test(message)) {
      return send(res, 409, { error: "REVISION_CONFLICT" });
    }
    if (/duplicate|unique/i.test(message)) {
      return send(res, 409, { error: "DUPLICATE_MOTION" });
    }
    if (/not found/i.test(message)) {
      return send(res, 404, { error: "NOT_FOUND" });
    }
    if (/rate.limit/i.test(message)) {
      return send(res, 429, { error: "Rate limit exceeded" });
    }

    console.error("motion-write failed:", error.status || "unknown");
    return send(res, 500, { error: "Failed to update motion" });
  }
}
