
import { timingSafeEqual } from "node:crypto";

const MAX_BIGINT = 9223372036854775807n;

/**
 * 旧APIとの互換性を維持するためのトークン検証。
 * 使用箇所の監査が終わるまでは残す。
 */
export function requireAdmin(req) {
  const secret = process.env.ADMIN_API_TOKEN;
  const header = req.headers?.authorization || "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (!secret || !supplied) {
    return false;
  }

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

  // 数値型では安全整数を超えた値の精度が保証されない。
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

/**
 * Supabase REST APIをサーバー側から呼び出す。
 * SUPABASE_SERVICE_ROLE_KEYはサーバー環境変数からのみ取得する。
 */
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

  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.includes("://") ||
    path.split("/").some((part) => part === "..")
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
  };

  if (
    options.body !== undefined &&
    typeof options.body !== "string"
  ) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(
    `${url}/rest/v1/${path}`,
    requestOptions
  );

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
 * 認証済みユーザーの管理APIアクセスを検証する。
 * 認証済みユーザー全員を管理者とする現行仕様。
 */
export async function authorizeAdmin(req, res) {
  const {
    getSession,
    sendSessionJson,
  } = await import("./_session.js");

  let session;

  try {
    session = await getSession(req);
  } catch (error) {
    console.error(
      "Admin authentication failed:",
      error?.status || "unknown"
    );

    sendSessionJson(res, 503, {
      error: "認証サービスを一時的に利用できません。",
    });

    return null;
  }

  if (!session) {
    sendSessionJson(res, 401, {
      error: "ログインが必要です。",
    });

    return null;
  }

  return session;
}

/**
 * 旧API用の互換関数。
 * 使用箇所の監査が完了するまで残す。
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
