import { supabase } from "./_admin.js";
import {
  requireSession,
  sendSessionJson,
} from "./_session.js";

const PAGE_SIZE = 1000;
const MAX_OFFSET = 49999;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return sendSessionJson(res, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "GETリクエストのみ利用できます。",
    });
  }

  let session;

  try {
    session = await requireSession(req, res);
  } catch (error) {
    console.error(
      "Motion list authentication failed:",
      error?.status || "unknown"
    );

    return sendSessionJson(res, error?.status || 500, {
      error: error?.status === 401
        ? "UNAUTHORIZED"
        : "AUTHENTICATION_FAILED",
      message: error?.status === 401
        ? "ログインが必要です。"
        : "ログイン状態を確認できませんでした。",
    });
  }

  if (!session) {
    return;
  }

  try {
    const url = new URL(req.url, "http://localhost");

    const rawOffset =
      req.query?.offset ??
      url.searchParams.get("offset") ??
      "0";

    if (
      Array.isArray(rawOffset) ||
      typeof rawOffset === "object" ||
      rawOffset === null
    ) {
      return sendSessionJson(res, 400, {
        error: "INVALID_OFFSET",
        message: "offset の指定が正しくありません。",
      });
    }

    const offsetText = String(rawOffset);

    if (!/^(0|[1-9]\d*)$/.test(offsetText)) {
      return sendSessionJson(res, 400, {
        error: "INVALID_OFFSET",
        message: "offset の指定が正しくありません。",
      });
    }

    const offset = Number(offsetText);

    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > MAX_OFFSET
    ) {
      return sendSessionJson(res, 400, {
        error: "OFFSET_OUT_OF_RANGE",
        message: `offset は0以上${MAX_OFFSET}以下で指定してください。`,
      });
    }

    /*
     * 削除済み論題も取得する。
     * 履歴からの復元機能で必要になるため、
     * is_deleted による絞り込みは行わない。
     *
     * PAGE_SIZE と MAX_OFFSET は既存仕様を維持する。
     */
    const rows = await supabase(
      "motions?select=id,motion,tournament,year,history,revision,is_deleted" +
        "&order=id.asc" +
        `&offset=${offset}&limit=${PAGE_SIZE}`
    );

    if (!Array.isArray(rows)) {
      console.error("Motion list returned an invalid response.");

      return sendSessionJson(res, 502, {
        error: "INVALID_MOTION_DATA",
        message: "論題データの形式が正しくありません。",
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
      error: "MOTION_LIST_FAILED",
      message: "論題一覧を取得できませんでした。",
    });
  }
}
