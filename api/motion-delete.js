
import { createHash } from "node:crypto";
import { authorizeAdmin, supabase } from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

function normalizeRevision(value) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    !/^\d+$/.test(String(value))
  ) {
    return null;
  }

  try {
    const revision = BigInt(value);

    if (revision < 0n || revision > 9223372036854775807n) {
      return null;
    }

    return revision.toString();
  } catch {
    return null;
  }
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return send(res, 400, {
      error: "Invalid request",
    });
  }

  const id =
    body.id === undefined || body.id === null
      ? ""
      : String(body.id).trim();

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

  const tokenHash = createHash("sha256")
    .update(token)
    .digest("hex");

  try {
    const result = await supabase("rpc/motion_apply", {
      method: "POST",
      body: {
        p_action: "delete",
        p_id: id,
        p_row: null,
        p_expected_revision: expectedRevision,
        p_client_hash: tokenHash,
      },
    });

    return send(res, 200, result);
  } catch (error) {
    const message = [
      error?.data?.message,
      error?.message,
      error?.data?.details,
    ]
      .filter(Boolean)
      .join(" ");

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
      "motion-delete failed:",
      error?.status || "unknown"
    );

    return send(res, 500, {
      error: "Failed to delete motion",
    });
  }
}
