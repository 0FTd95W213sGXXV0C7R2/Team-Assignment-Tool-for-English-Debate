import { createHash } from "node:crypto";
import { authorizeAdmin, supabase } from "./_admin.js";

const MAX_BIGINT = 9223372036854775807n;
const MAX_HISTORY_ITEMS = 500;
const MAX_MOTION_LENGTH = 1500;
const MAX_TOURNAMENT_LENGTH = 180;
const MAX_ID_LENGTH = 100;
const DEFAULT_DONE_DATE = "2024-01-01";

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
    .filter(
      (value) =>
        typeof value === "string" &&
        value.length > 0
    )
    .join(" ");
}

function mapRpcError(error, res) {
  const message = errorText(error);

  if (/REVISION_CONFLICT/i.test(message)) {
    return send(res, 409, {
      error: "REVISION_CONFLICT",
      message:
        "他の操作によってデータが更新されています。再読み込みしてください。",
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
      message:
        "操作回数の上限に達しました。時間をおいて再試行してください。",
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

function normalizeHistory(history) {
  if (
    !Array.isArray(history) ||
    history.length > MAX_HISTORY_ITEMS
  ) {
    return null;
  }

  const normalized = [];

  for (const item of history) {
    if (
      typeof item !== "string" ||
      item.length > 40 ||
      Number.isNaN(Date.parse(item))
    ) {
      return null;
    }

    normalized.push(item);
  }

  return normalized;
}

function validateRow(body) {
  const motion =
    typeof body.motion === "string"
      ? body.motion.trim()
      : "";

  const tournament =
    typeof body.tournament === "string"
      ? body.tournament.trim()
      : "";

  const year =
    typeof body.year === "string" ||
    (typeof body.year === "number" &&
      Number.isSafeInteger(body.year))
      ? String(body.year).trim()
      : "";

  if (
    !motion ||
    motion.length > MAX_MOTION_LENGTH
  ) {
    return {
      error: `論題は1～${MAX_MOTION_LENGTH}文字で入力してください。`,
    };
  }

  if (
    !tournament ||
    tournament.length > MAX_TOURNAMENT_LENGTH
  ) {
    return {
      error: `大会名は1～${MAX_TOURNAMENT_LENGTH}文字で入力してください。`,
    };
  }

  if (!/^\d{4}$/.test(year)) {
    return {
      error: "年度は4桁の西暦で入力してください。",
    };
  }

  let history = [];

  if (body.history !== undefined) {
    history = normalizeHistory(body.history);

    if (history === null) {
      return {
        error: "実施履歴の形式が正しくありません。",
      };
    }
  }

  return {
    row: {
      motion,
      tournament,
      year,
      history,
    },
  };
}

async function getExistingHistory(id) {
  const params = new URLSearchParams({
    select: "id,history,revision,is_deleted",
    id: `eq.${id}`,
    limit: "1",
  });

  const rows = await supabase(
    `motions?${params.toString()}`
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
}

function validateDate(date) {
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function historyFromLegacyFields(existingHistory, body) {
  const history = normalizeHistory(
    Array.isArray(existingHistory)
      ? existingHistory
      : []
  );

  if (history === null) {
    throw new Error("INVALID_HISTORY");
  }

  if (typeof body.done !== "boolean") {
    return history;
  }

  if (!body.done) {
    return [];
  }

  const date =
    typeof body.date === "string" && body.date
      ? body.date
      : DEFAULT_DONE_DATE;

  if (!validateDate(date)) {
    throw new Error("INVALID_DATE");
  }

  const normalizedDate = `${date}T00:00:00.000Z`;

  // 同じ日付の履歴があれば重複追加しない。
  const alreadyExists = history.some(
    (item) => item.slice(0, 10) === date
  );

  if (!alreadyExists) {
    if (history.length >= MAX_HISTORY_ITEMS) {
      throw new Error("HISTORY_LIMIT");
    }

    history.push(normalizedDate);
  }

  return history;
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
      "Motion write authorization failed:",
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

  // 旧フロントエンドの create も受け付ける。
  const action =
    body.action === "create"
      ? "insert"
      : body.action;

  if (!["insert", "update", "delete"].includes(action)) {
    return send(res, 400, {
      error: "INVALID_ACTION",
      message: "操作の指定が正しくありません。",
    });
  }

  const id =
    typeof body.id === "string" ||
    (typeof body.id === "number" &&
      Number.isSafeInteger(body.id))
      ? String(body.id).trim()
      : "";

  if (
    action !== "insert" &&
    (!id || id.length > MAX_ID_LENGTH)
  ) {
    return send(res, 400, {
      error: "INVALID_ID",
      message: "論題IDの指定が正しくありません。",
    });
  }

  let expectedRevision = null;

  if (action !== "insert") {
    expectedRevision = normalizeRevision(
      body.expectedRevision
    );

    if (expectedRevision === null) {
      return send(res, 400, {
        error: "INVALID_REVISION",
        message:
          "更新前のリビジョンが必要です。再読み込みしてください。",
      });
    }
  } else if (
    body.expectedRevision !== undefined &&
    body.expectedRevision !== null
  ) {
    expectedRevision = normalizeRevision(
      body.expectedRevision
    );

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

      if (error?.message === "INVALID_HISTORY") {
        return send(res, 400, {
          error: "INVALID_HISTORY",
          message: "既存の実施履歴が正しくありません。",
        });
      }

      if (error?.message === "HISTORY_LIMIT") {
        return send(res, 400, {
          error: "HISTORY_LIMIT",
          message: "実施履歴が上限に達しています。",
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

  if (
    typeof token !== "string" ||
    token.length === 0
  ) {
    console.error(
      "Motion write configuration missing: ADMIN_API_TOKEN"
    );

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
