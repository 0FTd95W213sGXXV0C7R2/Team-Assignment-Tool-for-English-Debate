
import {
  getSession,
  sendSessionJson,
} from "./_session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return sendSessionJson(res, 405, {
      error: "Method not allowed",
    });
  }

  try {
    const session = await getSession(req);

    if (!session) {
      return sendSessionJson(res, 200, {
        authenticated: false,
        isAdmin: false,
        user: null,
      });
    }

    return sendSessionJson(res, 200, {
      authenticated: true,
      isAdmin: true,
      userId: session.userId,
      email: session.email,
      provider: session.provider,
      expiresAt: session.expiresAt,
      user: {
        id: session.userId,
        email: session.email,
      },
    });
  } catch (error) {
    console.error(
      "Auth status check failed:",
      error?.status || "unknown"
    );

    return sendSessionJson(res, 503, {
      error: "ログイン状態を確認できませんでした。",
    });
  }
}

