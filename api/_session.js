
import { supabase } from "./_admin.js";

export const SESSION_COOKIE = "debate_session";
export const SESSION_TTL_SECONDS = 180 * 24 * 60 * 60;

function getBearerToken(req) {
  const header = req.headers?.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  if (
    !token ||
    token.length > 8192 ||
    /\s/.test(token)
  ) {
    return null;
  }

  return token;
}

function getSupabasePublicConfig() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (
    !url ||
    !key ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)
  ) {
    throw new Error("Supabase Auth configuration missing");
  }

  return { url, key };
}

export function sessionCookie(token) {
  const secure =
    process.env.NODE_ENV === "production" ? "; Secure" : "";

  return (
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ` +
    `Max-Age=${SESSION_TTL_SECONDS}; ` +
    `Path=/; HttpOnly; SameSite=Lax${secure}`
  );
}

export function clearSessionCookie() {
  const secure =
    process.env.NODE_ENV === "production" ? "; Secure" : "";

  return (
    `${SESSION_COOKIE}=; Max-Age=0; ` +
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT; ` +
    `Path=/; HttpOnly; SameSite=Lax${secure}`
  );
}

export function sendSessionJson(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });

  res.end(JSON.stringify(data));
}

/**
 * Supabase Authのアクセストークンを検証する。
 *
 * トークンの署名や有効性を自前で推測せず、
 * Supabase Authの /auth/v1/user エンドポイントで検証する。
 *
 * Google IDを持つユーザーは、確認済みメールアドレスが
 * 許可ドメインに属している場合に限ってアクセスできる。
 *
 * メール・パスワード登録ユーザーにはドメイン制限を設けない。
 */
export async function getSession(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const { url, key } = getSupabasePublicConfig();

  const response = await fetch(`${url}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const error = new Error(
      `Supabase Auth verification failed: ${response.status}`
    );

    error.status = response.status;
    throw error;
  }

  const user = await response.json();

  if (
    !user ||
    typeof user.id !== "string" ||
    !user.id ||
    typeof user.email !== "string" ||
    !user.email
  ) {
    return null;
  }

  // メールアドレスの確認が完了していないユーザーは拒否する。
  if (!user.email_confirmed_at) {
    return null;
  }

  const email = user.email.trim().toLowerCase();
  const identities = Array.isArray(user.identities)
    ? user.identities
    : [];

  const hasGoogleIdentity =
    user.app_metadata?.provider === "google" ||
    identities.some(
      (identity) => identity?.provider === "google"
    );

  if (hasGoogleIdentity) {
    const allowedDomains = new Set([
      "st.spec.ed.jp",
      "spec.ed.jp",
    ]);

    const separator = email.lastIndexOf("@");

    if (separator < 1) {
      return null;
    }

    const domain = email.slice(separator + 1);

    if (!allowedDomains.has(domain)) {
      return null;
    }
  }

  return {
    userId: user.id,
    email,
    expiresAt: null,
    tokenHash: null,
    provider: user.app_metadata?.provider || null,
    isAdmin: true,
  };
}

/**
 * ログイン必須API用の共通ガード。
 */
export async function requireSession(req, res) {
  try {
    const session = await getSession(req);

    if (!session) {
      sendSessionJson(res, 401, {
        error: "ログインが必要です。",
      });

      return null;
    }

    return session;
  } catch (error) {
    console.error(
      "Session verification failed:",
      error?.status || "unknown"
    );

    sendSessionJson(res, 503, {
      error: "認証サービスを一時的に利用できません。",
    });

    return null;
  }
}

/**
 * 旧APIとの互換性を維持するための移行用関数。
 *
 * 新しい認証方式ではSupabase Authがセッションを管理するため、
 * この関数で独自セッションを新規作成しない。
 * 古い auth-login.js から呼び出された場合は明示的に失敗させる。
 */
export async function createSession() {
  throw new Error(
    "Legacy session creation is disabled. Use Supabase Auth."
  );
}

/**
 * Supabase Authのサインアウトは、クライアントが
 * supabase.auth.signOut() を呼び出して実行する。
 * この関数は旧APIとの互換性のために残す。
 */
export async function revokeSession() {
  return;
}

