
import { sendSessionJson } from "./_session.js";

/**
 * 旧ログアウトAPIとの互換性を維持する。
 *
 * 新方式では、ブラウザー側で
 * supabase.auth.signOut() を呼び出してログアウトする。
 * このAPIはCookieセッションの失効処理を行わない。
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  res.setHeader("Cache-Control", "no-store");

  return sendSessionJson(res, 200, {
    success: true,
    message: "ブラウザー側のSupabase Authからログアウトしてください。",
  });
}
