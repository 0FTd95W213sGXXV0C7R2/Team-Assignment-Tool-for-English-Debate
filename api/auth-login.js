
import { createHash } from "node:crypto";
import { supabase } from "./_admin.js";
import {
  createSession,
  sessionCookie,
  sendSessionJson,
} from "./_session.js";

const MAX_LOGIN_ATTEMPTS = 20;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sendError(res, status, message) {
  return sendSessionJson(res, status, {
    ok: false,
    error: message,
  });
}

function getClientAddressKey(req) {
  // 任意の X-Forwarded-For は信用しない。
  // 信頼できるプロキシを設定する場合は別途対応する。
  const address =
    typeof req.socket?.remoteAddress === "string"
      ? req.socket.remoteAddress
      : "unknown";

  return sha256(`debate-login-address:${address}`);
}

async function consumeLoginAttempt(bucketHash) {
  const result = await supabase(
    "rpc/debate_consume_login_attempt",
    {
      method: "POST",
      body: {
        p_bucket_hash: bucketHash,
        p_max_attempts: MAX_LOGIN_ATTEMPTS,
      },
    },
  );

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

  if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) {
    return null;
  }

  return code;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendError(
      res,
      405,
      "この操作は許可されていません。",
    );
  }

  let body;

  try {
    if (
      req.body &&
      typeof req.body === "object" &&
      !Buffer.isBuffer(req.body)
    ) {
      body = req.body;
    } else {
      let raw = "";

      for await (const chunk of req) {
        raw += chunk.toString("utf8");

        if (Buffer.byteLength(raw, "utf8") > 8192) {
          return sendError(
            res,
            413,
            "送信データの量が上限を超えています。",
          );
        }
      }

      body = JSON.parse(raw);
    }
  } catch {
    return sendError(
      res,
      400,
      "送信データの形式が正しくありません。",
    );
  }

  let allowed;

  try {
    allowed = await consumeLoginAttempt(
      getClientAddressKey(req),
    );
  } catch (error) {
    console.error("Login rate-limit check failed:", error);

    return sendError(
      res,
      503,
      "認証サービスを一時的に利用できません。時間をおいて再度お試しください。",
    );
  }

  if (!allowed) {
    return sendError(
      res,
      429,
      "ログイン試行回数が上限に達しました。しばらくしてから再度お試しください。",
    );
  }

  const code = readCode(body);

  if (!code) {
    return sendError(
      res,
      401,
      "ログインコードが正しくありません。",
    );
  }

  const codeHash = sha256(code);

  try {
    const codeRows = await supabase(
      "debate_login_codes" +
        "?select=user_id,code_hash,revoked_at" +
        `&code_hash=eq.${encodeURIComponent(codeHash)}` +
        "&limit=1",
    );

    if (
      !Array.isArray(codeRows) ||
      codeRows.length !== 1
    ) {
      return sendError(
        res,
        401,
        "ログインコードが正しくありません。",
      );
    }

    const loginCode = codeRows[0];

    if (
      loginCode.revoked_at !== null ||
      loginCode.code_hash !== codeHash
    ) {
      return sendError(
        res,
        401,
        "ログインコードが正しくありません。",
      );
    }

    const members = await supabase(
      "debate_members" +
        "?select=user_id,revoked_at" +
        `&user_id=eq.${encodeURIComponent(loginCode.user_id)}` +
        "&limit=1",
    );

    if (
      !Array.isArray(members) ||
      members.length !== 1 ||
      members[0].revoked_at !== null
    ) {
      return sendError(
        res,
        401,
        "このアカウントは利用できません。管理者にお問い合わせください。",
      );
    }

    const session = await createSession(loginCode.user_id);

    return sendSessionJson(
      res,
      200,
      {
  ok: true,
  message: "ログインしました。",
  user: {
    id: loginCode.user_id,
  },
  expiresAt: session.expiresAt,
},
      {
        "Set-Cookie": sessionCookie(session.token),
      },
    );
  } catch (error) {
    console.error("Login request failed:", error);

    return sendError(
      res,
      503,
      "ログイン処理に失敗しました。時間をおいて再度お試しください。",
    );
  }
}

