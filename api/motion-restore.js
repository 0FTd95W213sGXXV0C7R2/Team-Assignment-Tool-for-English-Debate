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
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return send(res, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "POSTリクエストのみ利用できます。",
    });
  }

  let session;

  try {
    session = await authorizeAdmin(req, res);
  } catch (error) {
    console.error(
      "Motion restore authorization failed:",
      error?.status || "unknown"
    );

    return send(res, 500, {
      error: "AUTHORIZATION_FAILED",
      message: "管理者権限を確認できませんでした。",
    });
  }

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
      error: "INVALID_REQUEST",
      message: "リクエストの形式が正しくありません。",
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
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    auditKey === null ||
    auditKey === "0" ||
    revision === null
  ) {
    return send(res, 400, {
      error: "INVALID_REQUEST",
      message: "論題ID、監査ID、またはリビジョンが正しくありません。",
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
      ok: true,
      restored,
    });
  } catch (error) {
    const message = getErrorMessage(error);

    if (/DUPLICATE_MOTION|duplicate/i.test(message)) {
      return send(res, 409, {
        error: "DUPLICATE_MOTION",
        message: "復元すると同じ論題が重複するため、復元できません。",
      });
    }

    if (/REVISION_CONFLICT/i.test(message)) {
      return send(res, 409, {
        error: "REVISION_CONFLICT",
        message: "論題が別の操作で更新されています。再読み込みしてください。",
      });
    }

    if (/NOT_FOUND|SNAPSHOT_NOT_FOUND/i.test(message)) {
      return send(res, 404, {
        error: "NOT_FOUND",
        message: "復元対象の論題または履歴が見つかりません。",
      });
    }

    if (/INVALID_REQUEST|INVALID_SNAPSHOT/i.test(message)) {
      return send(res, 422, {
        error: "INVALID_RESTORE_REQUEST",
        message: "指定された履歴から復元できません。",
      });
    }

    if (/RATE_LIMIT/i.test(message)) {
      return send(res, 429, {
        error: "RATE_LIMITED",
        message: "操作回数の上限に達しました。時間をおいて再試行してください。",
      });
    }

    console.error(
      "Restore RPC failed:",
      error?.status || "unknown"
    );

    return send(res, 500, {
      error: "RESTORE_FAILED",
      message: "論題の復元に失敗しました。",
    });
  }
}
