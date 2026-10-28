import {
  getSession,
  clearSessionCookie,
  sendSessionJson,
} from "./_session.js";

import { supabase } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const session = await getSession(req);

    if (!session) {
      return sendSessionJson(
        res,
        200,
        {
          authenticated: false,
          isAdmin: false,
        },
        {
          "Set-Cookie": clearSessionCookie(),
        }
      );
    }

    const roles = await supabase(
      "debate_admin_roles?select=user_id,suspended_at" +
        `&user_id=eq.${encodeURIComponent(session.userId)}&limit=1`
    );

    const isAdmin =
      Array.isArray(roles) &&
      roles.length === 1 &&
      roles[0].suspended_at === null;

    return sendSessionJson(res, 200, {
      authenticated: true,
      isAdmin,
      userId: session.userId,
      expiresAt: session.expiresAt,
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
