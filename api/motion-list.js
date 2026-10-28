
import { supabase } from "./_admin.js";
import {
  requireSession,
  sendSessionJson,
} from "./_session.js";

const PAGE_SIZE = 1000;
const MAX_OFFSET = 49999;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendSessionJson(res, 405, {
      error: "Method not allowed",
    });
  }

  const session = await requireSession(req, res);

  if (!session) {
    return;
  }

  try {
    const url = new URL(req.url, "http://localhost");

    const rawOffset =
      req.query?.offset ??
      url.searchParams.get("offset") ??
      "0";

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
      offset > MAX_OFFSET
    ) {
      return sendSessionJson(res, 400, {
        error: `offset は0以上${MAX_OFFSET}以下で指定してください。`,
      });
    }

    // 削除済み論題も取得し、復元機能で利用できるようにする。
    const rows = await supabase(
      "motions?select=id,motion,tournament,year,history,revision,is_deleted" +
        "&order=id.asc" +
        `&offset=${offset}&limit=${PAGE_SIZE}`
    );

    if (!Array.isArray(rows)) {
      return sendSessionJson(res, 502, {
        error: "論題データの形式が正しくありません。",
      });
    }

    return sendSessionJson(res, 200, {
      motions: rows,
      offset,
      limit: PAGE_SIZE,
    });
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
