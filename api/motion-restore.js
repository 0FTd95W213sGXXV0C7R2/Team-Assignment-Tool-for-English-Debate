import { requireAdmin, supabase } from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
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

  const { motionId, revision, expectedRevision } = body;

  if (
    typeof motionId !== "string" ||
    !motionId.trim() ||
    !/^\d+$/.test(String(revision)) ||
    !/^\d+$/.test(String(expectedRevision))
  ) {
    return send(res, 400, { error: "Invalid restore parameters" });
  }

  try {
    const result = await supabase("rpc/motion_restore_revision_checked", {
      method: "POST",
      body: {
        p_motion_id: motionId,
        p_revision: String(revision),
        p_expected_revision: String(expectedRevision),
      },
    });

    return send(res, 200, { ok: true, result });
  } catch (error) {
    const message = error.data?.message || error.message || "";

    if (/conflict|revision/i.test(message)) {
      return send(res, 409, { error: "Revision conflict" });
    }

    if (/not found/i.test(message)) {
      return send(res, 404, { error: "Motion or revision not found" });
    }

    console.error("motion-restore failed:", error.status || "unknown");
    return send(res, 500, { error: "Failed to restore motion" });
  }
}
