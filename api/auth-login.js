import { createHash } from "node:crypto";
import { supabase } from "./_admin.js";
import {
  createSession,
  sessionCookie,
  sendSessionJson,
} from "./_session.js";

function sha256(value) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function getClientIp(req) {
  // プロキシが付加するヘッダーを無条件に信頼しない。
  // 本番環境では、信頼できるプロキシが設定する値を使うよう
  // デプロイ環境に合わせて別途調整する。
  const forwarded = req.headers?.["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.length <= 200) {
    return forwarded.split(",")[0].trim().slice(0, 100);
  }

  return "unknown";
}

function readBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const body = readBody(req);
  const code =
    typeof body?.code === "string" ? body.code.trim() : "";

  if (!/^[A-Za-z0-9_-]{40,50}$/.test(code)) {
    return sendSessionJson(res, 400, {
      error: "ログインコードが正しくありません。",
    });
  }

  try {
    const ip = getClientIp(req);
    const bucketHash = sha256(ip);

    // 既存のDB側レート制限RPCを使用する。
    // 制限に達した場合はログイン処理を進めない。
    const attempts = await supabase(
      "rpc/debate_consume_login_attempt",
      {
        method: "POST",
        body: {
          p_bucket_hash: bucketHash,
          p_max_attempts: 20,
        },
      }
    );

    if (attempts === false || attempts === null) {
      return sendSessionJson(res, 429, {
        error: "ログイン試行回数の上限に達しました。時間をおいて再試行してください。",
      });
    }

    const codeHash = sha256(code);

    const codes = await supabase(
      "debate_login_codes?select=user_id,code_hash,revoked_at" +
        `&code_hash=eq.${encodeURIComponent(codeHash)}&limit=1`
    );

    if (
      !Array.isArray(codes) ||
      codes.length !== 1 ||
      codes[0].revoked_at !== null
    ) {
      return sendSessionJson(res, 401, {
        error: "ログインコードが正しくありません。",
      });
    }

    const loginCode = codes[0];

    const members = await supabase(
      "debate_members?select=user_id,revoked_at" +
        `&user_id=eq.${encodeURIComponent(loginCode.user_id)}&limit=1`
    );

    if (
      !Array.isArray(members) ||
      members.length !== 1 ||
      members[0].revoked_at !== null
    ) {
      return sendSessionJson(res, 401, {
        error: "このアカウントは利用できません。",
      });
    }

    const { token, expiresAt } = await createSession(
      loginCode.user_id
    );

    return sendSessionJson(
      res,
      200,
      {
        authenticated: true,
        expiresAt,
      },
      {
        "Set-Cookie": sessionCookie(token),
      }
    );
  } catch (error) {
    console.error(
      "Login failed:",
      error?.status || "unknown"
    );

    return sendSessionJson(res, 503, {
      error: "ログイン処理を完了できませんでした。時間をおいて再試行してください。",
    });
  }
}
