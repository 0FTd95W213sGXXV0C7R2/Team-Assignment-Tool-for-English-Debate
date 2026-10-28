
import { timingSafeEqual } from "node:crypto";

/**
 * 旧APIとの互換性を維持するためのトークン検証。
 * Supabase Authへの移行後も、内部処理などで使用される
 * 可能性があるため、使用箇所の監査が終わるまでは残す。
 */
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

/**
 * SupabaseのREST APIをサーバー側から呼び出す。
 * サービスロールキーはサーバー環境変数からのみ取得する。
 * ブラウザーへこのキーを返してはならない。
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
 * 認証済みユーザーの管理APIアクセスを検証する。
 *
 * 認証そのものは _session.js の getSession() に委譲する。
 * 新しい仕様では、認証に成功したユーザー全員を管理者とする。
 * debate_admin_roles テーブルの個別登録・停止状態には依存しない。
 *
 * API側では必ず await authorizeAdmin(req, res) を使うこと。
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
      error?.status || "unknown",
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

  // 管理者ロールの個別登録は要求しない。
  // getSession() が認証済みユーザーのみを返すことが前提。
  return session;
}

/**
 * 旧API用の互換関数。
 * 移行完了後、全使用箇所を確認してから扱いを決める。
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

