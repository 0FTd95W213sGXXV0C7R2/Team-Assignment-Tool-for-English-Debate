import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import {
  authorizeAdmin,
  supabase,
} from "./_admin.js";

import { sendSessionJson } from "./_session.js";

function sha256(value) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

async function createAuthUser() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !url ||
    !key ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)
  ) {
    throw new Error("Server configuration missing");
  }

  const userId = randomUUID();
  const email = `debate-${userId}@accounts.invalid`;
  const password = randomBytes(32).toString("base64url");

  const response = await fetch(
    `${url}/auth/v1/admin/users`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: userId,
        email,
        password,
        email_confirm: true,
        user_metadata: {
          account_type: "debate_internal",
        },
      }),
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      result?.msg ||
      result?.message ||
      result?.error_description ||
      "Auth user creation failed"
    );

    error.status = response.status;
    throw error;
  }

  if (!result?.id || !isUuid(result.id)) {
    throw new Error("Invalid Auth user response");
  }

  return result.id;
}

async function createMemberAndAdmin(userId) {
  await supabase("debate_members", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
    },
    body: {
      user_id: userId,
      revoked_at: null,
    },
  });

  await supabase("debate_admin_roles", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
    },
    body: {
      user_id: userId,
      suspended_at: null,
      suspended_by: null,
      suspension_reason: null,
    },
  });
}

async function issueLoginCode(userId) {
  const code = randomBytes(32).toString("base64url");
  const codeHash = sha256(code);

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

  return code;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendSessionJson(res, 405, {
      error: "この操作は許可されていません。",
    });
  }

  const adminSession = await authorizeAdmin(req, res);

  if (!adminSession) {
    return;
  }

  const body = req.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body.userId !== undefined && !isUuid(body.userId))
  ) {
    return sendSessionJson(res, 400, {
      error: "リクエストの形式が正しくありません。",
    });
  }

  let userId;
  let createdAccount = false;

  try {
    if (body.userId !== undefined) {
      // 既存メンバーへのコード再発行
      userId = body.userId.toLowerCase();

      const members = await supabase(
        "debate_members?select=user_id,revoked_at" +
          `&user_id=eq.${encodeURIComponent(userId)}&limit=1`
      );

      if (
        !Array.isArray(members) ||
        members.length !== 1 ||
        members[0].revoked_at !== null
      ) {
        return sendSessionJson(res, 404, {
          error: "有効なメンバーが見つかりません。",
        });
      }

      const roles = await supabase(
        "debate_admin_roles?select=user_id,suspended_at" +
          `&user_id=eq.${encodeURIComponent(userId)}&limit=1`
      );

      if (
        !Array.isArray(roles) ||
        roles.length !== 1 ||
        roles[0].suspended_at !== null
      ) {
        return sendSessionJson(res, 409, {
          error: "管理者権限が停止されたアカウントにはコードを再発行できません。",
        });
      }
    } else {
      // 新しい内部アカウントを作成する
      userId = await createAuthUser();
      createdAccount = true;

      await createMemberAndAdmin(userId);
    }

    const code = await issueLoginCode(userId);

    return sendSessionJson(res, 200, {
      ok: true,
      userId,
      code,
      createdAccount,
      message: createdAccount
        ? "新しい管理者アカウントを作成し、ログインコードを発行しました。コードは安全な場所に保管してください。"
        : "ログインコードを再発行しました。以前のコードは使用できなくなります。",
    });
  } catch (error) {
    console.error(
      "Login-code issuance failed:",
      error?.status || "unknown"
    );

    return sendSessionJson(res, 503, {
      error:
        createdAccount
          ? "アカウント作成処理が完了しませんでした。データベースに一部の情報が残っている可能性があるため、再試行前に状態を確認してください。"
          : "ログインコードを発行できませんでした。",
    });
  }
}
