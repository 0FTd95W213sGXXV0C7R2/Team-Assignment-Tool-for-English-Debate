
import {
  createHash,
  randomBytes,
} from "node:crypto";

import { requireAdmin, supabase } from "./_admin.js";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      error: "この操作は許可されていません。",
    });
  }

  if (!requireAdmin(req)) {
    return sendJson(res, 401, {
      error: "認証コードを発行する権限がありません。",
    });
  }

  const body = req.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.userId,
    )
  ) {
    return sendJson(res, 400, {
      error: "登録済みメンバーのユーザーIDを正しく指定してください。",
    });
  }

  try {
    const userId = body.userId.toLowerCase();

    const members = await supabase(
      "debate_members" +
        "?select=user_id,revoked_at" +
        `&user_id=eq.${encodeURIComponent(userId)}` +
        "&limit=1",
    );

    if (
      !Array.isArray(members) ||
      members.length !== 1 ||
      members[0].revoked_at !== null
    ) {
      return sendJson(res, 404, {
        error: "有効な登録メンバーが見つかりません。",
      });
    }

    // 暗号学的に安全な32バイトのランダムコードを生成する。
    const code = randomBytes(32).toString("base64url");
    const codeHash = sha256(code);

    // 同じメンバーのコードがあれば置き換える。
    // データベースには平文コードを保存しない。
    await supabase("debate_login_codes", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: {
        user_id: userId,
        code_hash: codeHash,
        created_at: new Date().toISOString(),
        revoked_at: null,
      },
    });

    return sendJson(res, 200, {
      ok: true,
      message:
        "ログインコードを発行しました。コードはこの画面でのみ確認できるため、安全に保管してください。",
      userId,
      code,
    });
  } catch (error) {
    console.error("Login-code issuance failed:", error);

    return sendJson(res, 503, {
      error:
        "ログインコードを発行できませんでした。設定やデータベースの状態を確認してください。",
    });
  }
}
