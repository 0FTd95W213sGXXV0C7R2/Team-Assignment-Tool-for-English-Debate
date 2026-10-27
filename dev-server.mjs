
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import motionWrite from "./api/motion-write.js";
import motionRecord from "./api/motion-record.js";
import motionRestore from "./api/motion-restore.js";
import motionHistory from "./api/motion-history.js";
import motionAdminList from "./api/motion-admin-list.js";
import motionCurrent from "./api/motion-current.js";
import motionList from "./api/motion-list.js";
import addMotion from "./api/add-motion.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const MAX_BODY_BYTES = 1024 * 1024;

const STATIC_PAGES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/add.html", "add.html"],
  ["/admin.html", "admin.html"]
]);

const API_ROUTES = new Map([
  ["motion-write", { handler: motionWrite, method: "POST" }],
  ["motion-record", { handler: motionRecord, method: "POST" }],
  ["motion-restore", { handler: motionRestore, method: "POST" }],
  ["motion-history", { handler: motionHistory, method: "GET" }],
  ["motion-admin-list", { handler: motionAdminList, method: "GET" }],
  ["motion-current", { handler: motionCurrent, method: "GET" }],
  ["motion-list", { handler: motionList, method: "GET" }],
  ["add-motion", { handler: addMotion, method: null }]
]);

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function parseQuery(searchParams) {
  const query = {};
  for (const [key, value] of searchParams) {
    if (!(key in query)) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

async function readBody(req) {
  const chunks = [];
  let length = 0;

  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (!length) return undefined;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function responseAdapter(res) {
  return {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(data) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
      return this;
    }
  };
}

async function handleApi(req, res, pathname) {
  const name = pathname.slice("/api/".length).replace(/\.js$/, "");
  const route = API_ROUTES.get(name);

  if (!route || name.includes("/")) {
    return sendJson(res, 404, { error: "Not found" });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, {
      error: error.message
    });
  }

  if (route.method && route.method !== req.method) {
    res.setHeader("Allow", route.method);
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const apiReq = {
    method: req.method,
    headers: req.headers,
    query: parseQuery(new URL(req.url, "http://localhost").searchParams),
    body
  };

  try {
    await route.handler(apiReq, responseAdapter(res));
  } catch (error) {
    console.error("API error:", name, error.status || "unknown");
    if (!res.writableEnded) {
      sendJson(res, 500, { error: "Internal server error" });
    }
  }
}

async function handleStatic(pathname, res) {
  const filename = STATIC_PAGES.get(pathname);
  if (!filename) {
    return sendJson(res, 404, { error: "Not found" });
  }

  const filePath = resolve(ROOT, filename);
  if (!filePath.startsWith(ROOT + sep)) {
    return sendJson(res, 404, { error: "Not found" });
  }

  try {
    const content = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader(
      "Content-Type",
      extname(filePath) === ".html"
        ? "text/html; charset=utf-8"
        : "application/octet-stream"
    );
    res.end(content);
  } catch {
    sendJson(res, 500, { error: "Failed to load page" });
  }
}

export function createDevelopmentServer() {
  return createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return sendJson(res, 400, { error: "Invalid URL" });
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, res, url.pathname);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    return handleStatic(url.pathname, res);
  });
}

async function main() {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be between 1 and 65535");
  }

  const server = createDevelopmentServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Development server: http://localhost:${port}`);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

