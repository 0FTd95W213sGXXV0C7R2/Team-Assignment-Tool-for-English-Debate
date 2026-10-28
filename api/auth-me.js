
import {
  getSession,
  clearSessionCookie,
  sendSessionJson,
} from "./_session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendSessionJson(res, 405, {
      error: "method_not_allowed",
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
          user: null,
        },
        {
          "Set-Cookie": clearSessionCookie(),
        },
      );
    }

    return sendSessionJson(res, 200, {
      authenticated: true,
      user: {
        id: session.userId,
      },
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error("Authentication status check failed:", error);

    return sendSessionJson(res, 503, {
      error: "authentication_temporarily_unavailable",
    });
  }
}
