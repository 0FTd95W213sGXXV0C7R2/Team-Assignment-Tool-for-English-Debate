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

  if (
    typeof secret !== "string" ||
    !secret ||
    !supplied
  ) {
    return false;
  }

  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);

  if (expectedBuffer.length !== suppliedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

/**
 * 0以上のPostgreSQL bigint値を10進文字列に正規化する。
 * 数値型は安全整数の範囲内である場合のみ受け付ける。
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
    return {
      message: text,
    };
  }
}

/**
 * Supabase REST APIをサーバー側から呼び出す。
 *
 * SUPABASE_SERVICE_ROLE_KEYはサーバー環境変数からのみ取得する。
 * クライアント側へ返却したり、ログに出力したりしないこと。
 */
export async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    typeof url !== "string" ||
    typeof key !== "string" ||
    !url ||
    !key
  ) {
    throw new Error("Server configuration missing");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid Supabase URL");
  }

  if (
    parsedUrl.protocol !== "https:" ||
    !/^([a-z0-9-]+\.)?supabase\.co$/i.test(
      parsedUrl.hostname
    ) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.pathname !== "/"
  ) {
    throw new Error("Invalid Supabase URL");
  }

  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.includes("://") ||
    path.includes("\\") ||
    path.split("/").some(
      (part) => part === "." || part === ".."
    )
  ) {
    throw new Error("Invalid Supabase REST path");
  }

  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new Error("Invalid Supabase request options");
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

  let response;

  try {
    response = await fetch(
      `${parsedUrl.origin}/rest/v1/${path}`,
      requestOptions
    );
  } catch {
    const error = new Error("Supabase network request failed");
    error.status = 503;
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
 * 認証済みユーザーの管理APIアクセスを検証する。
 *
 * 現行仕様：ログイン済みユーザーを管理APIの利用対象とする。
 * 管理者を特定ユーザーに限定する場合は、ここに許可リストの
 * 検証を追加し、auth-me.js側の判定とも統一する。
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

    if (!res.headersSent) {
      return res.status(503).json({
        error: "AUTHENTICATION_UNAVAILABLE",
        message: "認証サービスを一時的に利用できません。",
      });
    }

    return null;
  }

  if (!session) {
    if (!res.headersSent) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "ログインが必要です。",
      });
    }

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
      error: "METHOD_NOT_ALLOWED",
      message: "POSTリクエストのみ利用できます。",
    });

    return true;
  }

  if (!requireAdmin(req)) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "認証が必要です。",
    });

    return true;
  }

  return false;
}
