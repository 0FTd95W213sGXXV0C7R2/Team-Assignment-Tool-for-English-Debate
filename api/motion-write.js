
import { createHash } from "node:crypto";
import { authorizeAdmin, supabase } from "./_admin.js";

const MAX_BIGINT = 9223372036854775807n;

function send(res, status, body) {
  return res.status(status).json(body);
}

function normalizeRevision(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }

  const text = String(value);

  if (!/^(0|[1-9]\d*)$/.test(text)) {
    return null;
  }

  try {
    const revision = BigInt(text);

    if (revision < 0n || revision > MAX_BIGINT) {
      return null;
    }

    return revision.toString();
  } catch {
    return null;
  }
}

function errorText(error) {
  return [
    error?.data?.message,
    error?.message,
    error?.data?.details,
    error?.data?.hint,
  ]
    .filter(Boolean)
    .join(" ");
}

function mapRpcError(error, res) {
  const message = errorText(error);

  if (/REVISION_CONFLICT/i.test(message)) {
    return send(res, 409, {
      error: "REVISION_CONFLICT",
      message: "他の操作によってデータが更新されています。再読み込みしてください。",
    });
  }

  if (/DUPLICATE_MOTION|duplicate key/i.test(message)) {
    return send(res, 409, {
      error: "DUPLICATE_MOTION",
      message: "同じ論題が既に登録されています。",
    });
  }

  if (/SNAPSHOT_NOT_FOUND|NOT_FOUND/i.test(message)) {
    return send(res, 404, {
      error: "NOT_FOUND",
      message: "対象の論題が見つかりません。",
    });
  }

  if (/MOTION_DELETED|DELETED/i.test(message)) {
    return send(res, 409, {
      error: "MOTION_DELETED",
      message: "対象の論題は削除済みです。",
    });
  }

  if (/RATE_LIMIT/i.test(message)) {
    return send(res, 429, {
      error: "RATE_LIMITED",
      message: "操作回数の上限に達しました。時間をおいて再試行してください。",
    });
  }

  if (/INVALID_|INVALID REQUEST/i.test(message)) {
    return send(res, 400, {
      error: "INVALID_REQUEST",
      message: "入力内容が正しくありません。",
    });
  }

  console.error(
    "motion-write RPC failed:",
    error?.status || "unknown"
  );

  return send(res, 500, {
    error: "WRITE_FAILED",
    message: "論題を保存できませんでした。",
  });
}

function validateRow(body) {
  const motion =
    typeof body.motion === "string" ? body.motion.trim() : "";

  const tournament =
    typeof body.tournament === "string"
      ? body.tournament.trim()
      : "";

  const year =
    typeof body.year === "string" || typeof body.year === "number"
      ? String(body.year).trim()
      : "";

  if (!motion || motion.length > 1500) {
    return { error: "論題は1～1500文字で入力してください。" };
  }

  if (!tournament || tournament.length > 180) {
    return { error: "大会名は1～180文字で入力してください。" };
  }

  if (!/^\d{4}$/.test(year)) {
    return { error: "年度は4桁の西暦で入力してください。" };
  }

  if (
    body.history !== undefined &&
    (!Array.isArray(body.history) ||
      body.history.length > 500 ||
      body.history.some(
        (item) =>
          typeof item !== "string" ||
          item.length > 40 ||
          Number.isNaN(Date.parse(item))
      ))
  ) {
    return { error: "実施履歴の形式が正しくありません。" };
  }

  return {
    row: {
      motion,
      tournament,
      year,
      history: body.history || [],
    },
  };
}

async function getExistingHistory(id) {
  const params = new URLSearchParams({
    select: "id,history,revision,is_deleted",
    id: `eq.${id}`,
    limit: "1",
  });

  const rows = await supabase(`motions?${params.toString()}`);

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
}

function historyFromLegacyFields(existingHistory, body) {
  const history = Array.isArray(existingHistory)
    ? existingHistory.filter(
        (item) =>
          typeof item === "string" &&
          !Number.isNaN(Date.parse(item))
      )
    : [];

  if (typeof body.done !== "boolean") {
    return history;
  }

  if (!body.done) {
    return [];
  }

  const date =
    typeof body.date === "string" && body.date
      ? body.date
      : "2024-01-01";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("INVALID_DATE");
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("INVALID_DATE");
  }

  // 同じ日付の既存履歴を重複追加しない。
  const normalizedDate = `${date}T00:00:00.000Z`;

  if (!history.some((item) => item.slice(0, 10) === date)) {
    history.push(normalizedDate);
  }

  return history;
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
      error: "INVALID_REQUEST",
      message: "リクエストの形式が正しくありません。",
    });
  }

  // フロントエンドの旧操作名 create も受け付ける。
  const action = body.action === "create" ? "insert" : body.action;

  if (!["insert", "update", "delete"].includes(action)) {
    return send(res, 400, {
      error: "INVALID_ACTION",
      message: "操作の指定が正しくありません。",
    });
  }

  const id =
    typeof body.id === "string" || typeof body.id === "number"
      ? String(body.id).trim()
      : "";

  if (
    action !== "insert" &&
    (!id || id.length > 100)
  ) {
    return send(res, 400, {
      error: "INVALID_ID",
      message: "論題IDの指定が正しくありません。",
    });
  }

  let expectedRevision = null;

  if (action !== "insert") {
    expectedRevision = normalizeRevision(body.expectedRevision);

    if (expectedRevision === null) {
      return send(res, 400, {
        error: "INVALID_REVISION",
        message: "更新前のリビジョンが必要です。再読み込みしてください。",
      });
    }
  } else if (
    body.expectedRevision !== undefined &&
    body.expectedRevision !== null
  ) {
    expectedRevision = normalizeRevision(body.expectedRevision);

    if (expectedRevision === null) {
      return send(res, 400, {
        error: "INVALID_REVISION",
        message: "リビジョンの指定が正しくありません。",
      });
    }
  }

  let row = null;

  if (action === "insert" || action === "update") {
    const validation = validateRow(body);

    if (validation.error) {
      return send(res, 400, {
        error: "INVALID_REQUEST",
        message: validation.error,
      });
    }

    row = validation.row;

    try {
      if (body.history === undefined) {
        if (action === "update") {
          const existing = await getExistingHistory(id);

          if (!existing) {
            return send(res, 404, {
              error: "NOT_FOUND",
              message: "対象の論題が見つかりません。",
            });
          }

          if (existing.is_deleted) {
            return send(res, 409, {
              error: "MOTION_DELETED",
              message: "対象の論題は削除済みです。",
            });
          }

          row.history = historyFromLegacyFields(
            existing.history,
            body
          );
        } else {
          row.history = historyFromLegacyFields([], body);
        }
      }
    } catch (error) {
      if (error?.message === "INVALID_DATE") {
        return send(res, 400, {
          error: "INVALID_DATE",
          message: "実施日の指定が正しくありません。",
        });
      }

      console.error(
        "Existing motion retrieval failed:",
        error?.status || "unknown"
      );

      return send(res, 500, {
        error: "MOTION_READ_FAILED",
        message: "既存の論題データを確認できませんでした。",
      });
    }
  }

  const token = process.env.ADMIN_API_TOKEN;

  if (!token) {
    return send(res, 500, {
      error: "SERVER_CONFIGURATION_ERROR",
      message: "サーバー設定が不足しています。",
    });
  }

  const clientHash = createHash("sha256")
    .update(token)
    .digest("hex");

  try {
    const result = await supabase("rpc/motion_apply", {
      method: "POST",
      body: {
        p_action: action,
        p_id: action === "insert" ? null : id,
        p_row: row,
        p_expected_revision: expectedRevision,
        p_client_hash: clientHash,
      },
    });

    return send(res, 200, {
      ok: true,
      action,
      result,
    });
  } catch (error) {
    return mapRpcError(error, res);
  }
}
