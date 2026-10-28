import { timingSafeEqual } from "node:crypto";

export function requireAdmin(req) {
  const secret = process.env.ADMIN_API_TOKEN;
  const header = req.headers?.authorization || "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (!secret || !supplied) return false;

  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export function normalizeNonNegativeBigint(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }

  const text = String(value);

  if (!/^(0|[1-9]\d*)$/.test(text)) return null;

  try {
    return BigInt(text).toString();
  } catch {
    return null;
  }
}

function parseSupabaseJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !url ||
    !key ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)
  ) {
    throw new Error("Server configuration missing");
  }

  const requestOptions = {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  if (
    options.body !== undefined &&
    typeof options.body !== "string"
  ) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(
    `${url}/rest/v1/${path}`,
    requestOptions,
  );

  const text = await response.text();
  const data = parseSupabaseJson(text);

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        `Supabase request failed: ${response.status}`,
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

/**
 * Cookieセッションと管理者権限を検証する。
 *
 * API側では必ず await authorizeAdmin(req, res) を使うこと。
 * 既存の requireAdmin(req) とは異なり、非同期関数。
 */
export async function authorizeAdmin(req, res) {
  const {
    getSession,
    clearSessionCookie,
    sendSessionJson,
  } = await import("./_session.js");

  let session;

  try {
    session = await getSession(req);
  } catch (error) {
    console.error(
      "Admin session verification failed:",
      error?.status || "unknown",
    );

    sendSessionJson(res, 503, {
      error: "認証サービスを一時的に利用できません。",
    });

    return null;
  }

  if (!session) {
    sendSessionJson(
      res,
      401,
      { error: "ログインが必要です。" },
      { "Set-Cookie": clearSessionCookie() },
    );

    return null;
  }

  try {
    const roles = await supabase(
      "debate_admin_roles" +
        "?select=user_id,suspended_at" +
        `&user_id=eq.${encodeURIComponent(session.userId)}` +
        "&limit=1",
    );

    if (
      !Array.isArray(roles) ||
      roles.length !== 1 ||
      roles[0].suspended_at !== null
    ) {
      sendSessionJson(res, 403, {
        error: "管理者権限がありません。",
      });

      return null;
    }

    return session;
  } catch (error) {
    console.error(
      "Admin role verification failed:",
      error?.status || "unknown",
    );

    sendSessionJson(res, 503, {
      error: "権限情報を確認できませんでした。",
    });

    return null;
  }
}

/**
 * 旧API用の互換関数。
 * 全APIの移行が完了した段階で使用箇所をなくす。
 */
export function reject(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({
      error: "Method not allowed",
    });

    return true;
  }

  if (!requireAdmin(req)) {
    res.status(401).json({
      error: "Unauthorized",
    });

    return true;
  }

  return false;
}
