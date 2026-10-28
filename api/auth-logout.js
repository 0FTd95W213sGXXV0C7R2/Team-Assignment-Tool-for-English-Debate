
import {
  revokeSession,
  clearSessionCookie,
  sendSessionJson,
} from "./_session.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendSessionJson(
      res,
      405,
      { error: "この操作は許可されていません。" },
      { "Set-Cookie": clearSessionCookie() },
    );
  }

  try {
    await revokeSession(req);

    return sendSessionJson(
      res,
      200,
      {
        ok: true,
        message: "ログアウトしました。",
      },
      {
        "Set-Cookie": clearSessionCookie(),
      },
    );
  } catch (error) {
    console.error("Logout failed:", error);

    // Cookieを消去しても、サーバー側のセッション失効が
    // 成功したとは限らないため、成功扱いにはしない。
    return sendSessionJson(
      res,
      503,
      {
        error:
          "ログアウト処理に失敗しました。時間をおいて再度お試しください。",
      },
      {
        "Set-Cookie": clearSessionCookie(),
      },
    );
  }
}
