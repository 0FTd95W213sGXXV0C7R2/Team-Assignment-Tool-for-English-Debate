import { supabase } from "./_admin.js";
import {
  requireSession,
  sendSessionJson,
} from "./_session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  // ログイン済みの有効なアカウントであることを確認する。
  // 管理者権限が停止されたアカウントでも、
  // ログインが有効なら論題一覧の閲覧は許可する。
  const session = await requireSession(req, res);

  if (!session) {
    return;
  }

  try {
    const url = new URL(
      req.url,
      "http://localhost"
    );

    const rawOffset =
      req.query?.offset ?? url.searchParams.get("offset") ?? "0";

    const offsetText = String(rawOffset);

    if (!/^(0|[1-9]\d*)$/.test(offsetText)) {
      return sendSessionJson(res, 400, {
        error: "offset の指定が正しくありません。",
      });
    }

    const offset = Number(offsetText);

    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 49999
    ) {
      return sendSessionJson(res, 400, {
        error: "offset は0以上49999以下で指定してください。",
      });
    }

    const rows = await supabase(
      "motions?select=id,motion,tournament,year,history,revision,is_deleted" +
        "&is_deleted=eq.false" +
        "&order=id.asc" +
        `&offset=${offset}&limit=1000`
    );

    if (!Array.isArray(rows)) {
      return sendSessionJson(res, 502, {
        error: "論題データの形式が正しくありません。",
      });
    }

    return sendSessionJson(res, 200, rows);
  } catch (error) {
    console.error(
      "Motion list retrieval failed:",
      error?.status || "unknown"
    );

    return sendSessionJson(res, 500, {
      error: "論題一覧を取得できませんでした。",
    });
  }
}
