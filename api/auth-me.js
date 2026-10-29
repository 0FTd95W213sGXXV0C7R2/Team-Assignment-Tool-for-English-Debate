import { getSession } from "./_session.js";

function getAdminUserIds() {
  return (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

function isAdmin(user) {
  const adminUserIds = getAdminUserIds();
  const adminEmails = getAdminEmails();

  const userId = typeof user?.id === "string" ? user.id : "";
  const email = typeof user?.email === "string"
    ? user.email.trim().toLowerCase()
    : "";

  if (userId && adminUserIds.includes(userId)) {
    return true;
  }

  if (email && adminEmails.includes(email)) {
    return true;
  }

  return false;
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.end(JSON.stringify(data));
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
      message: "GETリクエストのみ利用できます。"
    });
  }

  try {
    const user = await getSession(req);

    if (!user) {
      return sendJson(res, 200, {
        authenticated: false,
        isAdmin: false,
        user: null
      });
    }

    const admin = isAdmin(user);

    return sendJson(res, 200, {
      authenticated: true,
      isAdmin: admin,
      user: {
        id: user.id,
        email: user.email || null,
        provider: user.app_metadata?.provider || null
      }
    });
  } catch (error) {
    console.error("auth-me error:", {
      status: error?.status || null,
      message: error?.message || "Unknown authentication error"
    });

    return sendJson(res, 503, {
      authenticated: false,
      isAdmin: false,
      user: null,
      error: "AUTH_CHECK_FAILED",
      message: "ログイン状態を確認できませんでした。時間をおいて再度お試しください。"
    });
  }
}
