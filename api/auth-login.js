
import { sendSessionJson } from "./_session.js";

/**
 * 旧ワンタイムコード認証は廃止。
 *
 * 新しい認証方式では、フロントエンドからSupabase Authを利用する。
 * このAPIは互換性のために残すが、認証やセッション発行は行わない。
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  res.setHeader("Cache-Control", "no-store");

  return sendSessionJson(res, 410, {
    authenticated: false,
    error:
      "ワンタイムコード認証は廃止されました。Supabase Authによるログインをご利用ください。",
    code: "LEGACY_LOGIN_DISABLED",
  });
}

