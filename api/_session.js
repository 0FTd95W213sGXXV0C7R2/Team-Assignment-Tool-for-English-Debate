const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SUPABASE_PUBLIC_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";

function getBearerToken(req) {
  const authorization = req?.headers?.authorization ||
    req?.headers?.Authorization;

  if (typeof authorization !== "string") {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function getSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error("Supabaseのサーバー設定が不足しています。");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(SUPABASE_URL);
  } catch {
    throw new Error("SUPABASE_URLの形式が正しくありません。");
  }

  if (
    parsedUrl.protocol !== "https:" &&
    parsedUrl.hostname !== "localhost" &&
    parsedUrl.hostname !== "127.0.0.1"
  ) {
    throw new Error("Supabase URLにはHTTPSを使用してください。");
  }

  return {
    url: parsedUrl.origin,
    publicKey: SUPABASE_PUBLIC_KEY
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
 * 注意：
 * この関数は管理者権限そのものを判定しない。
 * 管理者判定は呼び出し側で別途実施する。
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
        Accept: "application/json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    const networkError = new Error(
      "Supabaseの認証サーバーに接続できませんでした。"
    );

    networkError.cause = error;
    throw networkError;
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const error = new Error(
      `Supabaseの認証確認に失敗しました（HTTP ${response.status}）。`
    );

    error.status = response.status;
    throw error;
  }

  let user;

  try {
    user = await response.json();
  } catch {
    throw new Error("Supabaseから不正な認証応答が返されました。");
  }

  if (
    !user ||
    typeof user !== "object" ||
    typeof user.id !== "string" ||
    !user.id
  ) {
    throw new Error("Supabaseのユーザー情報が不正です。");
  }

  /*
   * メール認証を必須にする構成では、
   * 未確認のメールアカウントを拒否する。
   * Google OAuthなどでは通常、確認済みメールが返される。
   */
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
 *
 * @returns {Promise<object>} Supabaseのユーザーオブジェクト
 * @throws {Error} セッションが無効、または認証確認に失敗した場合
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
