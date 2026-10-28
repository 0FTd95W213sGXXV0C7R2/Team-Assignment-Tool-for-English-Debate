
import {
  authorizeAdmin,
  supabase,
  normalizeNonNegativeBigint,
} from "./_admin.js";

function send(res, status, body) {
  return res.status(status).json(body);
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

  const auditKey = normalizeNonNegativeBigint(
    body.auditId
  );

  const revision = normalizeNonNegativeBigint(
    body.expectedRevision
  );

  if (
    !id ||
    id.length > 100 ||
    auditKey === null ||
    auditKey === "0" ||
    revision === null
  ) {
    return send(res, 400, {
      error: "Invalid request",
    });
  }

  try {
    const restored = await supabase(
      "rpc/motion_restore_revision_checked",
      {
        method: "POST",
        body: {
          p_id: id,
          p_audit_id: auditKey,
          p_expected_revision: revision,
        },
      }
    );

    return send(res, 200, {
      restored,
    });
  } catch (error) {
    const message = getErrorMessage(error);

    if (/DUPLICATE_MOTION|duplicate/i.test(message)) {
      return send(res, 409, {
        error: "DUPLICATE_MOTION",
      });
    }

    if (/REVISION_CONFLICT|revision/i.test(message)) {
      return send(res, 409, {
        error: "REVISION_CONFLICT",
      });
    }

    if (
      /NOT_FOUND|SNAPSHOT_NOT_FOUND/i.test(message)
    ) {
      return send(res, 404, {
        error: "NOT_FOUND",
      });
    }

    if (
      /INVALID_REQUEST|INVALID_SNAPSHOT/i.test(message)
    ) {
      return send(res, 422, {
        error: "INVALID_RESTORE_REQUEST",
      });
    }

    console.error(
      "Restore RPC failed:",
      error?.status || "unknown"
    );

    return send(res, 500, {
      error: "Restore failed",
    });
  }
}

