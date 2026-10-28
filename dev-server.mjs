
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import authLogin from "./api/auth-login.js";
import authMe from "./api/auth-me.js";
import authLogout from "./api/auth-logout.js";
import authCodeIssue from "./api/auth-code-issue.js";

import motionWrite from "./api/motion-write.js";
import motionRecord from "./api/motion-record.js";
import motionRestore from "./api/motion-restore.js";
import motionHistory from "./api/motion-history.js";
import motionAdminList from "./api/motion-admin-list.js";
import motionCurrent from "./api/motion-current.js";
import motionList from "./api/motion-list.js";
import addMotion from "./legacy/add-motion.js";
import adminMembers from "./api/admin-members.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const MAX_BODY_BYTES = 1024 * 1024;

const STATIC_PAGES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/add.html", "add.html"],
  ["/admin.html", "admin.html"],
]);

const API_ROUTES = new Map([
  ["auth-login", { handler: authLogin, method: "POST" }],
  ["auth-me", { handler: authMe, method: "GET" }],
  ["auth-logout", { handler: authLogout, method: "POST" }],
  ["auth-code-issue", { handler: authCodeIssue, method: "POST" }],
  
  ["motion-write", { handler: motionWrite, method: "POST" }],
  ["motion-record", { handler: motionRecord, method: "POST" }],
  ["motion-restore", { handler: motionRestore, method: "POST" }],
  ["motion-history", { handler: motionHistory, method: "GET" }],
  ["motion-admin-list", { handler: motionAdminList, method: "GET" }],
  ["motion-current", { handler: motionCurrent, method: "GET" }],
  ["motion-list", { handler: motionList, method: "GET" }],
  ["add-motion", { handler: addMotion, method: null }],
  ["admin-members", { handler: adminMembers, method: null }],
]);

function sendJson(res, status, data) {
  if (res.writableEnded) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(JSON.stringify(data));
}

function parseQuery(searchParams) {
  const query = {};

  for (const [key, value] of searchParams) {
    if (!(key in query)) {
      query[key] = value;
    } else if (Array.isArray(query[key])) {
      query[key].push(value);
    } else {
      query[key] = [query[key], value];
    }
  }

  return query;
}

async function readBody(req) {
  const chunks = [];
  let length = 0;

  for await (const chunk of req) {
    length += chunk.length;

    if (length > MAX_BODY_BYTES) {
      const error = new Error("リクエストのデータ量が上限を超えています。");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  if (!length) return undefined;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("送信データの形式が正しくありません。");
    error.statusCode = 400;
    throw error;
  }
}

function responseAdapter(res) {
  return {
    get writableEnded() {
      return res.writableEnded;
    },

    get statusCode() {
      return res.statusCode;
    },

    set statusCode(value) {
      res.statusCode = value;
    },

    setHeader(name, value) {
      if (!res.writableEnded) res.setHeader(name, value);
      return this;
    },

    writeHead(statusCode, headers = {}) {
      if (!res.writableEnded) res.writeHead(statusCode, headers);
      return this;
    },

    end(data) {
      if (!res.writableEnded) res.end(data);
      return this;
    },

    status(code) {
      res.statusCode = code;
      return this;
    },

    json(data) {
      if (res.writableEnded) return this;

      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8",
      );
      res.end(JSON.stringify(data));

      return this;
    },
  };
}

async function handleApi(req, res, pathname, socket) {
  const name = pathname
    .slice("/api/".length)
    .replace(/\.js$/, "");

  const route = API_ROUTES.get(name);

  if (!route || name.includes("/")) {
    return sendJson(res, 404, {
      error: "指定されたAPIが見つかりません。",
    });
  }

  if (route.method && route.method !== req.method) {
    res.setHeader("Allow", route.method);

    return sendJson(res, 405, {
      error: "この操作は許可されていません。",
    });
  }

  let body;

  try {
    body = await readBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, {
      error:
        error.statusCode === 413
          ? error.message
          : "送信データの形式が正しくありません。",
    });
  }

  const apiReq = {
    method: req.method,
    headers: req.headers,
    socket,
    url: req.url,
    query: parseQuery(
      new URL(req.url, "http://localhost").searchParams,
    ),
    body,
  };

  try {
    await route.handler(apiReq, responseAdapter(res));

    if (!res.writableEnded) {
      sendJson(res, 500, {
        error: "処理を完了できませんでした。",
      });
    }
  } catch (error) {
    console.error("API error:", name, error);

    if (!res.writableEnded) {
      sendJson(res, 500, {
        error: "サーバー内部でエラーが発生しました。",
      });
    }
  }
}

async function handleStatic(pathname, res, method = "GET") {
  const filename = STATIC_PAGES.get(pathname);

  if (!filename) {
    return sendJson(res, 404, {
      error: "指定されたページが見つかりません。",
    });
  }

  const filePath = resolve(ROOT, filename);

  if (!filePath.startsWith(ROOT + sep)) {
    return sendJson(res, 404, {
      error: "指定されたページが見つかりません。",
    });
  }

  try {
    const content = await readFile(filePath);

    res.writeHead(200, {
      "Content-Type":
        extname(filePath) === ".html"
          ? "text/html; charset=utf-8"
          : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });

    res.end(method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error("Page load failed:", error);

    sendJson(res, 500, {
      error: "ページを読み込めませんでした。",
    });
  }
}

export function createDevelopmentServer() {
  return createServer(async (req, res) => {
    let url;

    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return sendJson(res, 400, {
        error: "URLの形式が正しくありません。",
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, res, url.pathname, req.socket);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");

      return sendJson(res, 405, {
        error: "この操作は許可されていません。",
      });
    }

    return handleStatic(url.pathname, res, req.method);
  });
}

async function main() {
  const port = Number(process.env.PORT || 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "ポート番号は1から65535までの整数を指定してください。",
    );
  }

  const server = createDevelopmentServer();

  server.listen(port, "0.0.0.0", () => {
    console.log(`開発サーバーを起動しました: http://localhost:${port}`);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error("サーバーの起動に失敗しました:", error.message);
    process.exitCode = 1;
  });
}

