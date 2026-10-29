import { authorizeAdmin, supabase } from "./_admin.js";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const MAX_OFFSET = 49999;

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");

  if (res.headersSent) {
    return;
  }

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

function parseInteger(value, { min, max }) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  if (
    typeof value === "number" &&
    !Number.isSafeInteger(value)
  ) {
    return null;
  }

  const text = String(value);

  if (!/^(0|[1-9]\d*)$/.test(text)) {
    return null;
  }

  const number = Number(text);

  if (
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    return null;
  }

  return number;
}

function getSingleQueryValue(query, key, defaultValue) {
  const value = query[key];

  if (value === undefined) {
    return { value: defaultValue, valid: true };
  }

  if (Array.isArray(value) || typeof value !== "string") {
    return { value: null, valid: false };
  }

  return { value, valid: true };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return send(res, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "GETリクエストのみ利用できます。",
    });
  }

  let session;

  try {
    session = await authorizeAdmin(req, res);
  } catch (error) {
    console.error(
      "Motion history authorization failed:",
      error?.status || "unknown"
    );

    return send(res, 503, {
      error: "AUTHORIZATION_FAILED",
      message: "管理者権限を確認できませんでした。時間をおいて再試行してください。",
    });
  }

  if (!session) {
    return;
  }

  const query = req.query || {};

  const motionIdResult = getSingleQueryValue(
    query,
    "motionId",
    undefined
  );

  if (!motionIdResult.valid) {
    return send(res, 400, {
      error: "INVALID_MOTION_ID",
      message: "motionIdの指定が正しくありません。",
    });
  }

  const motionId =
    motionIdResult.value === undefined
      ? undefined
      : motionIdResult.value.trim();

  if (
    motionId !== undefined &&
    !/^[a-zA-Z0-9_-]{1,100}$/.test(motionId)
  ) {
    return send(res, 400, {
      error: "INVALID_MOTION_ID",
      message: "motionIdの指定が正しくありません。",
    });
  }

  const limitResult = getSingleQueryValue(
    query,
    "limit",
    String(DEFAULT_LIMIT)
  );

  if (!limitResult.valid) {
    return send(res, 400, {
      error: "INVALID_LIMIT",
      message: "limitの指定が正しくありません。",
    });
  }

  const limit = parseInteger(limitResult.value, {
    min: 1,
    max: MAX_LIMIT,
  });

  if (limit === null) {
    return send(res, 400, {
      error: "INVALID_LIMIT",
      message: `limitは1以上${MAX_LIMIT}以下で指定してください。`,
    });
  }

  const offsetResult = getSingleQueryValue(
    query,
    "offset",
    "0"
  );

  if (!offsetResult.valid) {
    return send(res, 400, {
      error: "INVALID_OFFSET",
      message: "offsetの指定が正しくありません。",
    });
  }

  const offset = parseInteger(offsetResult.value, {
    min: 0,
    max: MAX_OFFSET,
  });

  if (offset === null) {
    return send(res, 400, {
      error: "INVALID_OFFSET",
      message: `offsetは0以上${MAX_OFFSET}以下で指定してください。`,
    });
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
      console.error("Motion history returned an invalid response.");

      return send(res, 502, {
        error: "INVALID_AUDIT_RESPONSE",
        message: "監査履歴のデータ形式が正しくありません。",
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
      console.error("Motion history access denied:", status);

      return send(res, 502, {
        error: "AUDIT_HISTORY_ACCESS_DENIED",
        message: "監査履歴にアクセスできませんでした。",
      });
    }

    if (status === 404) {
      return send(res, 503, {
        error: "AUDIT_HISTORY_NOT_CONFIGURED",
        message: "監査履歴機能が設定されていません。",
      });
    }

    console.error(
      "motion-history failed:",
      status || "unknown",
      message ? message.slice(0, 300) : ""
    );

    return send(res, status === 503 ? 503 : 500, {
      error: "MOTION_HISTORY_FAILED",
      message: "監査履歴を取得できませんでした。",
    });
  }
}
