import { authorizeAdmin, supabase } from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, {
      error: "Method not allowed",
    });
  }

  const session = await authorizeAdmin(req, res);

  if (!session) {
    return;
  }

  const query = req.query || {};
  const rawMotionId = query.motionId;

  if (
    Array.isArray(rawMotionId) ||
    (rawMotionId !== undefined &&
      (typeof rawMotionId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(rawMotionId)))
  ) {
    return send(res, 400, {
      error: "Invalid motionId",
    });
  }

  const rawLimit = query.limit ?? "100";
  const limit = Number(rawLimit);

  if (
    !/^\d+$/.test(String(rawLimit)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500
  ) {
    return send(res, 400, {
      error: "Invalid limit",
    });
  }

  const rawOffset = query.offset ?? "0";
  const offset = Number(rawOffset);

  if (
    !/^\d+$/.test(String(rawOffset)) ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return send(res, 400, {
      error: "Invalid offset",
    });
  }

  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "changed_at.desc");
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  if (rawMotionId !== undefined) {
    params.set("motion_id", `eq.${rawMotionId}`);
  }

  try {
    const result = await supabase(
      `motion_audit?${params.toString()}`,
      { method: "GET" }
    );

    return send(res, 200, {
      history: Array.isArray(result) ? result : [],
      limit,
      offset,
    });
  } catch (error) {
    const status = error?.status;

    if (status === 401 || status === 403) {
      return send(res, 502, {
        error: "Audit history access denied",
      });
    }

    if (status === 404) {
      return send(res, 503, {
        error: "Audit history is not configured",
      });
    }

    console.error(
      "motion-history failed:",
      status || "unknown"
    );

    return send(res, 500, {
      error: "Failed to load motion history",
    });
  }
}
