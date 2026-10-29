import {
  getSession,
} from "./_session.js";

import {
  isAdminUser,
} from "./_admin.js";

function sendJson(res, status, data) {
  if (res.headersSent) {
    return;
  }

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");

  return res.status(status).json(data);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return sendJson(res, 405, {
      authenticated: false,
      isAdmin: false,
      error: "METHOD_NOT_ALLOWED",
      message: "GETリクエストのみ利用できます。",
    });
  }

  try {
    const user = await getSession(req);

    if (!user) {
      return sendJson(res, 200, {
        authenticated: false,
        isAdmin: false,
        user: null,
      });
    }

    return sendJson(res, 200, {
      authenticated: true,
      isAdmin: isAdminUser(user),
      user: {
        id: user.id,
        email: user.email || null,
        provider: user.app_metadata?.provider || null,
      },
    });
  } catch (error) {
    console.error("auth-me error:", {
      status: error?.status || null,
    });

    return sendJson(res, 503, {
      authenticated: false,
      isAdmin: false,
      user: null,
      error: "AUTH_CHECK_FAILED",
      message:
        "ログイン状態を確認できませんでした。時間をおいて再度お試しください。",
    });
  }
}
