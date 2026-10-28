
import {
  createHash,
  randomBytes,
} from "node:crypto";

import {
  requireAdmin,
  supabase,
} from "./_admin.js";

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

  // 既存のサーバー管理トークンによる認証。
  // この関数の戻り値ではなく、レスポンスが終了したかで判定する。
  try {
    await requireAdmin(req, res);

    if (res.writableEnded) {
      return;
    }
  } catch (error) {
    console.error("Login-code issuance authorization failed:", error);

    return sendJson(res, 500, {
      error: "認証コードの発行権限を確認できませんでした。",
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
    const members = await supabase(
      "debate_members" +
        "?select=user_id,revoked_at" +
        `&user_id=eq.${encodeURIComponent(body.userId)}` +
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

    // 32バイトの暗号学的乱数をBase64URLで表現する。
    const code = randomBytes(32).toString("base64url");
    const codeHash = sha256(code);

    // 同一メンバーのコードを更新する。
    // 既存のコードは新しいハッシュに置き換わるため使用できなくなる。
    await supabase("debate_login_codes", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: {
        user_id: body.userId,
        code_hash: codeHash,
        created_at: new Date().toISOString(),
        revoked_at: null,
      },
    });

    return sendJson(res, 200, {
      ok: true,
      message: "ログインコードを発行しました。このコードを安全に保管してください。",
      userId: body.userId,
      code,
    });
  } catch (error) {
    console.error("Login-code issuance failed:", error);

    return sendJson(res, 503, {
      error: "ログインコードを発行できませんでした。時間をおいて再度お試しください。",
    });
  }
}
