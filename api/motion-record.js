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

function getRpcErrorStatus(error) {
  const status = Number(error?.status);

  return Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : null;
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
      "Motion record authorization failed:",
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
      message: "リクエスト形式が正しくありません。",
    });
  }

  const id =
    typeof body.id === "string"
      ? body.id.trim()
      : "";

  if (!id || id.length > 100) {
    return send(res, 400, {
      error: "INVALID_ID",
      message: "論題IDの指定が正しくありません。",
    });
  }

  const expectedRevision = normalizeRevision(
    body.expectedRevision
  );

  if (expectedRevision === null) {
    return send(res, 400, {
      error: "INVALID_REVISION",
      message: "revisionの指定が正しくありません。",
    });
  }

  const token = process.env.ADMIN_API_TOKEN;

  if (
    typeof token !== "string" ||
    token.length === 0
  ) {
    console.error(
      "Motion record configuration missing: ADMIN_API_TOKEN"
    );

    return send(res, 500, {
      error: "SERVER_CONFIGURATION_ERROR",
      message: "サーバー設定に問題があります。",
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
    const status = getRpcErrorStatus(error);

    if (/REVISION_CONFLICT/i.test(message)) {
      return send(res, 409, {
        error: "REVISION_CONFLICT",
        message: "論題が別の操作で更新されています。最新の情報を再取得してください。",
      });
    }

    if (/NOT_FOUND/i.test(message)) {
      return send(res, 404, {
        error: "NOT_FOUND",
        message: "対象の論題が見つかりません。",
      });
    }

    if (/DELETED/i.test(message)) {
      return send(res, 409, {
        error: "MOTION_DELETED",
        message: "削除済みの論題は記録できません。",
      });
    }

    if (/RATE_LIMIT/i.test(message)) {
      return send(res, 429, {
        error: "RATE_LIMITED",
        message: "操作回数の上限に達しました。時間をおいて再試行してください。",
      });
    }

    if (/INVALID_/i.test(message)) {
      return send(res, 400, {
        error: "INVALID_REQUEST",
        message: "リクエスト内容が正しくありません。",
      });
    }

    // 認証・権限・競合などの既知エラーを上で処理した後、
    // その他のエラーは内部情報を公開せず返す。
    console.error(
      "motion-record failed:",
      status || "unknown"
    );

    return send(res, 500, {
      error: "MOTION_RECORD_FAILED",
      message: "論題の記録に失敗しました。",
    });
  }
}
