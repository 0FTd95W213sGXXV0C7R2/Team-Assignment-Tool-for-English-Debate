import {
  revokeSession,
  clearSessionCookie,
  sendSessionJson,
} from "./_session.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    await revokeSession(req);

    return sendSessionJson(
      res,
      200,
      { success: true },
      { "Set-Cookie": clearSessionCookie() }
    );
  } catch (error) {
    console.error(
      "Logout failed:",
      error?.status || "unknown"
    );

    // サーバー側で失効できなかった場合でも、
    // ブラウザ側のCookieは削除する。
    return sendSessionJson(
      res,
      503,
      {
        error: "サーバー側のログアウト処理を完了できませんでした。もう一度お試しください。",
      },
      { "Set-Cookie": clearSessionCookie() }
    );
  }
}
