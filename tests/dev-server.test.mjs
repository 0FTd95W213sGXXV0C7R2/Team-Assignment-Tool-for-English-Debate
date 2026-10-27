
import test from "node:test";
import assert from "node:assert/strict";
import { createDevelopmentServer } from "../dev-server.mjs";

let server;
let baseUrl;

test.before(async () => {
  server = createDevelopmentServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test("トップページがHTTP 200を返す", async () => {
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") || "",
    /text\/html/
  );

  const html = await response.text();
  assert.ok(html.length > 0);
});

test("存在しないページは404を返す", async () => {
  const response = await fetch(`${baseUrl}/not-found`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Not found"
  });
});

test("不正なJSONを送るAPIリクエストは400を返す", async () => {
  const response = await fetch(`${baseUrl}/api/motion-write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "{invalid json"
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid JSON body"
  });
});

test("GET専用APIへのPOSTは405を返す", async () => {
  const response = await fetch(`${baseUrl}/api/motion-history`, {
    method: "POST"
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.deepEqual(await response.json(), {
    error: "Method not allowed"
  });
});

test("存在しないAPIは404を返す", async () => {
  const response = await fetch(`${baseUrl}/api/not-found`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Not found"
  });
});

test("静的ページへのPOSTは405を返す", async () => {
  const response = await fetch(`${baseUrl}/admin.html`, {
    method: "POST"
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});
