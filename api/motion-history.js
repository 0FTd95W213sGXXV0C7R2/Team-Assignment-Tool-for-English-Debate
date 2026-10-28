
import { authorizeAdmin, supabase } from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

function getErrorMessage(error) {
  return [
    error?.data?.message,
    error?.message,
    error?.data?.details,
  ]
    .filter(
      (value) =>
        typeof value === "string" &&
        value.length > 0
    )
    .join(" ");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed" });
  }

  const session = await authorizeAdmin(req, res);
  if (!session) return;

  const query = req.query || {};
  const rawMotionId = query.motionId;

  if (
    Array.isArray(rawMotionId) ||
    (rawMotionId !== undefined &&
      typeof rawMotionId !== "string")
  ) {
    return send(res, 400, { error: "Invalid motionId" });
  }

  const motionId =
    rawMotionId === undefined
      ? undefined
      : rawMotionId.trim();

  if (
    motionId !== undefined &&
    !/^[a-zA-Z0-9_-]{1,100}$/.test(motionId)
  ) {
    return send(res, 400, { error: "Invalid motionId" });
  }

  const rawLimit = query.limit ?? "100";
  const limitText = String(rawLimit);
  const limit = Number(limitText);

  if (
    !/^\d+$/.test(limitText) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500
  ) {
    return send(res, 400, { error: "Invalid limit" });
  }

  const rawOffset = query.offset ?? "0";
  const offsetText = String(rawOffset);
  const offset = Number(offsetText);

  if (
    !/^\d+$/.test(offsetText) ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return send(res, 400, { error: "Invalid offset" });
  }

  const params = new URLSearchParams();
  params.set(
    "select",
    "audit_id,motion_id,action,before_data,after_data,actor,changed_at"
  );
  params.set("order", "changed_at.desc,audit_id.desc");
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  if (motionId !== undefined) {
    params.set("motion_id", `eq.${motionId}`);
  }

  try {
    const result = await supabase(
      `motion_audit?${params.toString()}`,
      { method: "GET" }
    );

    if (!Array.isArray(result)) {
      return send(res, 502, {
        error: "Invalid audit history response",
      });
    }

    return send(res, 200, {
      history: result,
      limit,
      offset,
    });
  } catch (error) {
    const status = error?.status;
    const message = getErrorMessage(error);

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
      status || "unknown",
      message ? message.slice(0, 300) : ""
    );

    return send(res, 500, {
      error: "Failed to load motion history",
    });
  }
}
