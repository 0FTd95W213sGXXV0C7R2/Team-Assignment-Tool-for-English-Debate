import { authorizeAdmin, supabase } from "./_admin.js";
import { sendSessionJson } from "./_session.js";

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function readBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendSessionJson(res, 405, {
      error: "Method not allowed",
    });
  }

  const actor = await authorizeAdmin(req, res);
  if (!actor) return;

  try {
    if (req.method === "GET") {
      const members = await supabase(
        "debate_members?select=user_id,joined_at,revoked_at&order=joined_at.asc&limit=1000"
      );

      const roles = await supabase(
        "debate_admin_roles?select=user_id,created_at,suspended_at,suspended_by,suspension_reason&limit=1000"
      );

      if (!Array.isArray(members) || !Array.isArray(roles)) {
        return sendSessionJson(res, 502, {
          error: "メンバー情報を取得できませんでした。",
        });
      }

      const roleByUserId = new Map(
        roles.map((role) => [role.user_id, role])
      );

      const result = members.map((member) => {
        const role = roleByUserId.get(member.user_id);

        return {
          userId: member.user_id,
          joinedAt: member.joined_at,
          accountRevoked: member.revoked_at !== null,
          isAdmin: Boolean(role),
          adminSuspended: role ? role.suspended_at !== null : true,
          adminCreatedAt: role?.created_at ?? null,
          suspendedAt: role?.suspended_at ?? null,
          suspendedBy: role?.suspended_by ?? null,
          suspensionReason: role?.suspension_reason ?? null,
          isCurrentUser: member.user_id === actor.userId,
        };
      });

      return sendSessionJson(res, 200, {
        ok: true,
        members: result,
      });
    }

    const body = readBody(req);

    if (
      !body ||
      !isUuid(body.userId) ||
      !["suspend", "reinstate"].includes(body.action)
    ) {
      return sendSessionJson(res, 400, {
        error: "リクエストの形式が正しくありません。",
      });
    }

    const targetUserId = body.userId.toLowerCase();

    if (targetUserId === actor.userId) {
      return sendSessionJson(res, 400, {
        error: "自分自身の管理者権限はこの画面から変更できません。",
      });
    }

    const members = await supabase(
      "debate_members?select=user_id,revoked_at" +
        `&user_id=eq.${encodeURIComponent(targetUserId)}&limit=1`
    );

    if (
      !Array.isArray(members) ||
      members.length !== 1 ||
      members[0].revoked_at !== null
    ) {
      return sendSessionJson(res, 404, {
        error: "有効なアカウントが見つかりません。",
      });
    }

    const roles = await supabase(
      "debate_admin_roles?select=user_id,suspended_at" +
        `&user_id=eq.${encodeURIComponent(targetUserId)}&limit=1`
    );

    if (!Array.isArray(roles) || roles.length !== 1) {
      return sendSessionJson(res, 404, {
        error: "対象アカウントの管理者ロールが見つかりません。",
      });
    }

    const role = roles[0];

    if (body.action === "suspend") {
      if (role.suspended_at !== null) {
        return sendSessionJson(res, 200, {
          ok: true,
          message: "このアカウントの管理者権限はすでに停止されています。",
        });
      }

      const activeRoles = await supabase(
        "debate_admin_roles?select=user_id&suspended_at=is.null&limit=2"
      );

      if (!Array.isArray(activeRoles)) {
        return sendSessionJson(res, 503, {
          error: "管理者数を確認できませんでした。",
        });
      }

      if (activeRoles.length <= 1) {
        return sendSessionJson(res, 409, {
          error: "最後の管理者の権限は停止できません。",
        });
      }

      const reason =
        typeof body.reason === "string"
          ? body.reason.trim().slice(0, 500)
          : "";

      await supabase(
        "debate_admin_roles?user_id=eq." +
          encodeURIComponent(targetUserId) +
          "&suspended_at=is.null",
        {
          method: "PATCH",
          headers: {
            Prefer: "return=minimal",
          },
          body: {
            suspended_at: new Date().toISOString(),
            suspended_by: actor.userId,
            suspension_reason: reason || null,
          },
        }
      );

      return sendSessionJson(res, 200, {
        ok: true,
        message: "管理者権限を停止しました。",
      });
    }

    if (role.suspended_at === null) {
      return sendSessionJson(res, 200, {
        ok: true,
        message: "このアカウントの管理者権限はすでに有効です。",
      });
    }

    await supabase(
      "debate_admin_roles?user_id=eq." +
        encodeURIComponent(targetUserId),
      {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal",
        },
        body: {
          suspended_at: null,
          suspended_by: null,
          suspension_reason: null,
        },
      }
    );

    return sendSessionJson(res, 200, {
      ok: true,
      message: "管理者権限を再有効化しました。",
    });
  } catch (error) {
    console.error(
      "Admin member management failed:",
      error?.status || "unknown"
    );

    return sendSessionJson(res, 503, {
      error: "管理者アカウントの操作を完了できませんでした。",
    });
  }
}
