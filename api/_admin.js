import { timingSafeEqual } from "node:crypto";

const MAX_BIGINT = 9223372036854775807n;

function sendJson(res, status, body) {
  if (res.headersSent) {
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");

  return res.status(status).json(body);
}

/**
 * 旧APIとの互換性を維持するためのトークン検証。
 * ADMIN_API_TOKENを使用する旧API専用。
 */
export function requireAdmin(req) {
  const secret = process.env.ADMIN_API_TOKEN;
  const header =
    req?.headers?.authorization ??
    req?.headers?.Authorization ??
    "";

  const match =
    typeof header === "string"
      ? header.match(/^Bearer\s+(\S+)$/)
      : null;

  const supplied = match ? match[1] : "";

  if (
    typeof secret !== "string" ||
    !secret ||
    !supplied
  ) {
    return false;
  }

  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

/**
 * 非負の整数をPostgreSQL BIGINTの範囲内で正規化する。
 */
export function normalizeNonNegativeBigint(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
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

  try {
    const parsed = BigInt(text);

    if (parsed < 0n || parsed > MAX_BIGINT) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function parseSupabaseJson(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function getSupabaseUrl() {
  const value = process.env.SUPABASE_URL;

  if (typeof value !== "string" || !value) {
    throw new Error("SUPABASE_URL is not configured");
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL is invalid");
  }

  if (
    parsed.protocol !== "https:" ||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("SUPABASE_URL is invalid");
  }

  return parsed.origin;
}

/**
 * Supabase REST APIをサーバー側から呼び出す。
 * Service Roleキーはクライアントへ返さない。
 */
export async function supabase(path, options = {}) {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (typeof key !== "string" || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured"
    );
  }

  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.includes("://") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    path.split("/").some(
      (part) => part === "." || part === ".."
    )
  ) {
    throw new Error("Invalid Supabase REST path");
  }

  const headers = new Headers(options.headers || {});

  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestOptions = {
    ...options,
    headers,
    cache: "no-store",
  };

  if (
    options.body !== undefined &&
    typeof options.body !== "string"
  ) {
    requestOptions.body = JSON.stringify(options.body);
  }

  let response;

  try {
    response = await fetch(
      `${url}/rest/v1/${path}`,
      requestOptions
    );
  } catch (cause) {
    const error = new Error("Supabase request failed");
    error.status = 503;
    error.cause = cause;
    throw error;
  }

  const text = await response.text();
  const data = parseSupabaseJson(text);

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        `Supabase request failed: ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

/**
 * 管理者の判定。
 *
 * ADMIN_USER_IDSまたはADMIN_EMAILSに登録されたユーザーのみ許可。
 * 両方が設定されている場合は、いずれかに一致すれば許可する。
 * どちらも未設定の場合は、管理者を許可しない。
 */
export function isAdminUser(user) {
  if (
    !user ||
    typeof user.id !== "string" ||
    !user.id
  ) {
    return false;
  }

  const allowedIds = (
    process.env.ADMIN_USER_IDS || ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const allowedEmails = (
    process.env.ADMIN_EMAILS || ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const idMatches = allowedIds.includes(user.id);

  const email =
    typeof user.email === "string"
      ? user.email.trim().toLowerCase()
      : "";

  const emailMatches =
    email !== "" && allowedEmails.includes(email);

  return idMatches || emailMatches;
}

/**
 * ログイン状態と管理者権限を検証する。
 */
export async function authorizeAdmin(req, res) {
  const { getSession } = await import("./_session.js");

  let session;

  try {
    session = await getSession(req);
  } catch (error) {
    console.error(
      "Admin authentication failed:",
      error?.status || "unknown"
    );

    sendJson(res, 503, {
      error: "認証サービスを一時的に利用できません。",
      code: "AUTH_SERVICE_UNAVAILABLE",
    });

    return null;
  }

  if (!session) {
    sendJson(res, 401, {
      error: "ログインが必要です。",
      code: "AUTH_REQUIRED",
    });

    return null;
  }

  if (!isAdminUser(session)) {
    sendJson(res, 403, {
      error: "管理者権限が必要です。",
      code: "ADMIN_REQUIRED",
    });

    return null;
  }

  return session;
}

/**
 * 旧API用の互換関数。
 * Bearerトークンによる管理者認証を維持する。
 */
export function reject(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    sendJson(res, 405, {
      error: "Method not allowed",
    });

    return true;
  }

  if (!requireAdmin(req)) {
    sendJson(res, 401, {
      error: "Unauthorized",
    });

    return true;
  }

  return false;
}
