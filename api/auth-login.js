
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { supabase } from "./_admin.js";

const SESSION_COOKIE = "debate_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAX_LOGIN_ATTEMPTS = 20;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqualHex(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    !/^[0-9a-f]{64}$/.test(a) ||
    !/^[0-9a-f]{64}$/.test(b)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(a, "hex"),
    Buffer.from(b, "hex"),
  );
}

function parseCookies(header) {
  const cookies = {};

  for (const part of (header || "").split(";")) {
    const separator = part.indexOf("=");

    if (separator < 1) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values.
    }
  }

  return cookies;
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });

  res.end(JSON.stringify(body));
}

function setSessionCookie(token) {
  const secure =
    process.env.NODE_ENV === "production" ? "; Secure" : "";

  return (
    `${SESSION_COOKIE}=${encodeURIComponent(token)}` +
    `; Path=/; HttpOnly; SameSite=Lax` +
    `; Max-Age=${SESSION_TTL_SECONDS}` +
    secure
  );
}

function getClientAddressKey(req) {
  // Do not trust arbitrary X-Forwarded-For headers.
  // Configure a trusted proxy explicitly before using forwarded addresses.
  const address =
    typeof req.socket?.remoteAddress === "string"
      ? req.socket.remoteAddress
      : "unknown";

  return sha256(`debate-login-address:${address}`);
}

async function consumeLoginAttempt(bucketHash) {
  const result = await supabase("rpc/debate_consume_login_attempt", {
    method: "POST",
    body: {
      p_bucket_hash: bucketHash,
      p_max_attempts: MAX_LOGIN_ATTEMPTS,
    },
  });

  return result === true;
}

function readCode(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.code !== "string"
  ) {
    return null;
  }

  const code = body.code.trim();

  // Login codes must be 32–128 characters.
  // The issuance API must generate codes compatible with this rule.
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) {
    return null;
  }

  return code;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

  let body;

  try {
    if (typeof req.body === "object" && req.body !== null) {
      body = req.body;
    } else {
      let raw = "";

      for await (const chunk of req) {
        raw += chunk;

        if (raw.length > 8192) {
          return sendJson(res, 413, {
            error: "request_too_large",
          });
        }
      }

      body = JSON.parse(raw);
    }
  } catch {
    return sendJson(res, 400, { error: "invalid_json" });
  }

  const addressBucket = getClientAddressKey(req);

  let allowed;

  try {
    allowed = await consumeLoginAttempt(addressBucket);
  } catch (error) {
    console.error("Login rate-limit check failed:", error);

    return sendJson(res, 503, {
      error: "authentication_temporarily_unavailable",
    });
  }

  if (!allowed) {
    return sendJson(res, 429, {
      error: "too_many_attempts",
    });
  }

  const code = readCode(body);

  if (!code) {
    return sendJson(res, 401, {
      error: "invalid_login_code",
    });
  }

  const codeHash = sha256(code);

  try {
    const codeRows = await supabase(
      "debate_login_codes" +
        `?select=user_id,code_hash,revoked_at` +
        `&code_hash=eq.${encodeURIComponent(codeHash)}` +
        "&limit=1",
    );

    if (!Array.isArray(codeRows) || codeRows.length !== 1) {
      return sendJson(res, 401, {
        error: "invalid_login_code",
      });
    }

    const loginCode = codeRows[0];

    if (
      loginCode.revoked_at !== null ||
      !safeEqualHex(loginCode.code_hash, codeHash)
    ) {
      return sendJson(res, 401, {
        error: "invalid_login_code",
      });
    }

    const memberRows = await supabase(
      "debate_members" +
        "?select=user_id,revoked_at" +
        `&user_id=eq.${encodeURIComponent(loginCode.user_id)}` +
        "&limit=1",
    );

    if (
      !Array.isArray(memberRows) ||
      memberRows.length !== 1 ||
      memberRows[0].revoked_at !== null
    ) {
      return sendJson(res, 401, {
        error: "invalid_login_code",
      });
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
        user_id: loginCode.user_id,
        expires_at: expiresAt,
      },
    });

    return sendJson(
      res,
      200,
      {
        ok: true,
        expiresAt,
      },
      {
        "Set-Cookie": setSessionCookie(token),
      },
    );
  } catch (error) {
    console.error("Login request failed:", error);

    return sendJson(res, 503, {
      error: "authentication_temporarily_unavailable",
    });
  }
}
