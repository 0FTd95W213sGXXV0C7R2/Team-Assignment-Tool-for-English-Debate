import { supabase } from "./_admin.js";
import {
  requireSession,
  sendSessionJson,
} from "./_session.js";

const PAGE_SIZE = 1000;
const MAX_OFFSET = 49999;

function sendError(res, status, error, message) {
  return sendSessionJson(res, status, {
    error,
    message,
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return sendError(
      res,
      405,
      "METHOD_NOT_ALLOWED",
      "GETリクエストのみ利用できます。"
    );
  }

  try {
    await requireSession(req);
  } catch (error) {
    const status =
      error?.status === 401
        ? 401
        : error?.status === 503
          ? 503
          : 502;

    console.error(
      "Motion list authentication failed:",
      status
    );

    return sendError(
      res,
      status,
      status === 401
        ? "UNAUTHORIZED"
        : "AUTHENTICATION_FAILED",
      status === 401
        ? "ログインが必要です。"
        : "ログイン状態を確認できませんでした。"
    );
  }

  try {
    const url = new URL(req.url, "http://localhost");

    const queryOffset = url.searchParams.getAll("offset");
    const requestOffset = req.query?.offset;

    if (
      queryOffset.length > 1 ||
      (Array.isArray(requestOffset) &&
        requestOffset.length !== 1)
    ) {
      return sendError(
        res,
        400,
        "INVALID_OFFSET",
        "offset の指定が正しくありません。"
      );
    }

    const rawOffset =
      requestOffset !== undefined
        ? Array.isArray(requestOffset)
          ? requestOffset[0]
          : requestOffset
        : queryOffset.length === 1
          ? queryOffset[0]
          : "0";

    if (
      typeof rawOffset !== "string" &&
      typeof rawOffset !== "number"
    ) {
      return sendError(
        res,
        400,
        "INVALID_OFFSET",
        "offset の指定が正しくありません。"
      );
    }

    const offsetText = String(rawOffset);

    if (!/^(0|[1-9]\d*)$/.test(offsetText)) {
      return sendError(
        res,
        400,
        "INVALID_OFFSET",
        "offset の指定が正しくありません。"
      );
    }

    const offset = Number(offsetText);

    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > MAX_OFFSET
    ) {
      return sendError(
        res,
        400,
        "OFFSET_OUT_OF_RANGE",
        `offset は0以上${MAX_OFFSET}以下で指定してください。`
      );
    }

    /*
     * 削除済み論題も取得する。
     * 復元機能で利用するため、is_deletedでは絞り込まない。
     */
    const rows = await supabase(
      "motions?select=id,motion,tournament,year,history,revision,is_deleted" +
        "&order=id.asc" +
        `&offset=${offset}&limit=${PAGE_SIZE}`
    );

    if (!Array.isArray(rows)) {
      console.error("Motion list returned an invalid response.");

      return sendError(
        res,
        502,
        "INVALID_MOTION_DATA",
        "論題データの形式が正しくありません。"
      );
    }

    return sendSessionJson(res, 200, {
      motions: rows,
      offset,
      limit: PAGE_SIZE,
    });
  } catch (error) {
    const status =
      error?.status === 503
        ? 503
        : error?.status === 502
          ? 502
          : 500;

    console.error(
      "Motion list retrieval failed:",
      status
    );

    return sendError(
      res,
      status,
      "MOTION_LIST_FAILED",
      "論題一覧を取得できませんでした。"
    );
  }
}
