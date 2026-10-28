
import { createHash, randomBytes } from "node:crypto";
import { supabase } from "./_admin.js";

export const SESSION_COOKIE = "debate_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseCookies(header) {
  const cookies = {};

  for (const part of (header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookies.
    }
  }

  return cookies;
}

function cookieOptions() {
  const secure =
    process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function sessionCookie(token) {
  return (
    `${SESSION_COOKIE}=${encodeURIComponent(token)}` +
    `; Max-Age=${SESSION_TTL_SECONDS}; ${cookieOptions()}`
  );
}

export function clearSessionCookie() {
  return (
    `${SESSION_COOKIE}=; Max-Age=0; ${cookieOptions()}`
  );
}

export function sendSessionJson(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });

  res.end(JSON.stringify(data));
}

export async function createSession(userId) {
  if (typeof userId !== "string" || !userId) {
    throw new Error("INVALID_SESSION_USER");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000,
  ).toISOString();

  await supabase("debate_sessions", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
    },
    body: {
      token_hash: tokenHash,
      user_id: userId,
      expires_at: expiresAt,
    },
  });

  return {
    token,
    expiresAt,
  };
}

export async function getSession(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[SESSION_COOKIE];

  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{40,50}$/.test(token)
  ) {
    return null;
  }

  const tokenHash = sha256(token);

  const sessions = await supabase(
    "debate_sessions" +
      "?select=token_hash,user_id,expires_at,revoked_at" +
      `&token_hash=eq.${encodeURIComponent(tokenHash)}` +
      "&limit=1",
  );

  if (!Array.isArray(sessions) || sessions.length !== 1) {
    return null;
  }

  const session = sessions[0];

  if (
    session.revoked_at !== null ||
    !Number.isFinite(Date.parse(session.expires_at)) ||
    Date.parse(session.expires_at) <= Date.now()
  ) {
    return null;
  }

  const members = await supabase(
    "debate_members" +
      "?select=user_id,revoked_at" +
      `&user_id=eq.${encodeURIComponent(session.user_id)}` +
      "&limit=1",
  );

  if (
    !Array.isArray(members) ||
    members.length !== 1 ||
    members[0].revoked_at !== null
  ) {
    return null;
  }

  return {
    userId: session.user_id,
    expiresAt: session.expires_at,
    tokenHash,
  };
}

export async function requireSession(req, res) {
  try {
    const session = await getSession(req);

    if (!session) {
      sendSessionJson(
        res,
        401,
        { error: "authentication_required" },
        { "Set-Cookie": clearSessionCookie() },
      );

      return null;
    }

    return session;
  } catch (error) {
    console.error("Session verification failed:", error);

    sendSessionJson(res, 503, {
      error: "authentication_temporarily_unavailable",
    });

    return null;
  }
}

export async function revokeSession(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[SESSION_COOKIE];

  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{40,50}$/.test(token)
  ) {
    return;
  }

  const tokenHash = sha256(token);

  await supabase(
    `debate_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
      },
      body: {
        revoked_at: new Date().toISOString(),
      },
    },
  );
}
