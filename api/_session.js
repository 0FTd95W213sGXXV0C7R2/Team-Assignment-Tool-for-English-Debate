const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SUPABASE_PUBLIC_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";

function sendJson(res, status, body) {
  if (res.headersSent) {
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");

  return res.status(status).json(body);
}

export function sendSessionJson(res, status, body) {
  return sendJson(res, status, body);
}

function getBearerToken(req) {
  const authorization =
    req?.headers?.authorization ??
    req?.headers?.Authorization;

  if (typeof authorization !== "string") {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  return match ? match[1] : null;
}

function getSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    const error = new Error(
      "Supabaseのサーバー設定が不足しています。"
    );

    error.status = 503;
    throw error;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(SUPABASE_URL);
  } catch {
    const error = new Error(
      "SUPABASE_URLの形式が正しくありません。"
    );

    error.status = 500;
    throw error;
  }

  const isLocalhost =
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1";

  if (
    (parsedUrl.protocol !== "https:" &&
      !(parsedUrl.protocol === "http:" && isLocalhost)) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.pathname !== "/"
  ) {
    const error = new Error(
      "SUPABASE_URLの設定が正しくありません。"
    );

    error.status = 500;
    throw error;
  }

  return {
    url: parsedUrl.origin,
    publicKey: SUPABASE_PUBLIC_KEY,
  };
}

/**
 * AuthorizationヘッダーのBearerトークンを検証する。
 *
 * 戻り値：
 * - 有効なセッション：Supabaseのユーザーオブジェクト
 * - トークンなし、無効、未確認メール：null
 * - 設定不備、通信障害、予期しない応答：例外
 *
 * 管理者権限の判定は、この関数では行わない。
 */
export async function getSession(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const { url, publicKey } = getSupabaseConfig();

  let response;

  try {
    response = await fetch(`${url}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch (cause) {
    const error = new Error(
      "Supabaseの認証サーバーに接続できませんでした。"
    );

    error.status = 503;
    error.cause = cause;
    throw error;
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const error = new Error(
      `Supabaseの認証確認に失敗しました（HTTP ${response.status}）。`
    );

    error.status = response.status >= 500 ? 503 : 502;
    throw error;
  }

  let user;

  try {
    user = await response.json();
  } catch {
    const error = new Error(
      "Supabaseから不正な認証応答が返されました。"
    );

    error.status = 502;
    throw error;
  }

  if (
    !user ||
    typeof user !== "object" ||
    Array.isArray(user) ||
    typeof user.id !== "string" ||
    !user.id
  ) {
    const error = new Error(
      "Supabaseのユーザー情報が不正です。"
    );

    error.status = 502;
    throw error;
  }

  if (
    user.email &&
    !user.email_confirmed_at &&
    !user.confirmed_at
  ) {
    return null;
  }

  return user;
}

/**
 * 有効なログインセッションを要求する。
 * 失敗時は401または認証サービスのエラーを投げる。
 */
export async function requireSession(req) {
  const user = await getSession(req);

  if (!user) {
    const error = new Error("ログインが必要です。");
    error.status = 401;
    throw error;
  }

  return user;
}
