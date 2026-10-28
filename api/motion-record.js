
import { createHash } from "node:crypto";
import { authorizeAdmin, supabase } from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

function normalizeRevision(value) {
  if (
    value === undefined ||
    value === null ||
    !/^\d+$/.test(String(value))
  ) {
    return null;
  }

  try {
    const revision = BigInt(value);

    if (
      revision < 0n ||
      revision > 9223372036854775807n
    ) {
      return null;
    }

    return revision.toString();
  } catch {
    return null;
  }
}

function getErrorMessage(error) {
  return [
    error?.data?.message,
    error?.message,
    error?.data?.details,
    error?.data?.hint,
  ]
    .filter(
      (value) =>
        typeof value === "string" &&
        value.length > 0
    )
    .join(" ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return send(res, 405, {
      error: "Method not allowed",
    });
  }

  const session = await authorizeAdmin(req, res);

  if (!session) {
    return;
  }

  const body = req.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return send(res, 400, {
      error: "Invalid request",
    });
  }

  const id =
    typeof body.id === "string"
      ? body.id.trim()
      : "";

  if (!id || id.length > 100) {
    return send(res, 400, {
      error: "Invalid id",
    });
  }

  const expectedRevision = normalizeRevision(
    body.expectedRevision
  );

  if (expectedRevision === null) {
    return send(res, 400, {
      error: "Invalid revision",
    });
  }

  const token = process.env.ADMIN_API_TOKEN;

  if (!token) {
    return send(res, 500, {
      error: "Server configuration missing",
    });
  }

  const clientHash = createHash("sha256")
    .update(token)
    .digest("hex");

  try {
    const result = await supabase("rpc/motion_apply", {
      method: "POST",
      body: {
        p_action: "record",
        p_id: id,
        p_row: null,
        p_expected_revision: expectedRevision,
        p_client_hash: clientHash,
      },
    });

    return send(res, 200, {
      ok: true,
      result,
    });
  } catch (error) {
    const message = getErrorMessage(error);

    if (/REVISION_CONFLICT|revision/i.test(message)) {
      return send(res, 409, {
        error: "REVISION_CONFLICT",
      });
    }

    if (/NOT_FOUND/i.test(message)) {
      return send(res, 404, {
        error: "NOT_FOUND",
      });
    }

    if (/DELETED/i.test(message)) {
      return send(res, 409, {
        error: "MOTION_DELETED",
      });
    }

    if (/RATE_LIMIT/i.test(message)) {
      return send(res, 429, {
        error: "RATE_LIMITED",
      });
    }

    if (/INVALID_/i.test(message)) {
      return send(res, 400, {
        error: "INVALID_REQUEST",
      });
    }

    console.error(
      "motion-record failed:",
      error?.status || "unknown"
    );

    return send(res, 500, {
      error: "Failed to record motion",
    });
  }
}

