import test from "node:test";
import assert from "node:assert/strict";
import { requireAdmin } from "../api/_admin.js";
import motionWrite from "../api/motion-write.js";
import { withAdminSession } from "./auth-mock.mjs";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    rawBody: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.assign(this.headers, headers);
      return this;
    },
    end(data) {
      this.rawBody = data;
      if (typeof data === "string") {
        try {
          this.body = JSON.parse(data);
        } catch {
          this.body = data;
        }
      }
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

test("管理者トークンが必要", () => {
  const original = process.env.ADMIN_API_TOKEN;

  try {
    process.env.ADMIN_API_TOKEN = "a".repeat(64);

    assert.equal(requireAdmin({ headers: {} }), false);
    assert.equal(
      requireAdmin({ headers: { authorization: "Bearer wrong" } }),
      false
    );
    assert.equal(
      requireAdmin({
        headers: { authorization: "Bearer " + "a".repeat(64) }
      }),
      true
    );
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_API_TOKEN;
    } else {
      process.env.ADMIN_API_TOKEN = original;
    }
  }
});

test("motion-write は POST 以外を拒否する", async () => {
  const res = mockResponse();

  await motionWrite(
    { method: "GET", headers: {}, body: undefined },
    res
  );

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
  assert.equal(res.body.error, "Method not allowed");
});

test("motion-write は管理者認証なしのリクエストを拒否する", async () => {
  const res = mockResponse();

  await motionWrite(
    { method: "POST", headers: {}, body: { action: "insert" } },
    res
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "ログインが必要です。");
});

test("motion-write は不正な action を拒否する", async () => {
  await withAdminSession(async (session) => {
    const res = mockResponse();

    await motionWrite(
      {
        method: "POST",
        headers: session.headers,
        body: { action: "unknown" }
      },
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "Invalid action");
  });
});

test("motion-write は revision のない更新を拒否する", async () => {
  await withAdminSession(async (session) => {
    const res = mockResponse();

    await motionWrite(
      {
        method: "POST",
        headers: session.headers,
        body: {
          action: "update",
          id: "test-id",
          motion: "THW test",
          tournament: "Test Cup",
          year: 2026
        }
      },
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "Invalid revision");
  });
});

test("motion-write は不正な論題データを拒否する", async () => {
  await withAdminSession(async (session) => {
    const res = mockResponse();

    await motionWrite(
      {
        method: "POST",
        headers: session.headers,
        body: {
          action: "insert",
          motion: "",
          tournament: "Test Cup",
          year: 2026
        }
      },
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "Invalid motion data");
  });
});
import motionRestore from "../api/motion-restore.js";
import { normalizeNonNegativeBigint } from "../api/_admin.js";

test("整数の revision を正規化する", () => {
  assert.equal(normalizeNonNegativeBigint("0"), "0");
  assert.equal(normalizeNonNegativeBigint("123"), "123");
  assert.equal(normalizeNonNegativeBigint(123), "123");
  assert.equal(normalizeNonNegativeBigint("000"), null);
  assert.equal(normalizeNonNegativeBigint("-1"), null);
  assert.equal(normalizeNonNegativeBigint("1.5"), null);
  assert.equal(normalizeNonNegativeBigint("abc"), null);
  assert.equal(normalizeNonNegativeBigint(null), null);
});

test("motion-restore は不正な入力を拒否する", async () => {
  await withAdminSession(async (session) => {
    const cases = [
      { id: "", auditId: "1", expectedRevision: "0" },
      { id: "motion-1", auditId: "0", expectedRevision: "0" },
      { id: "motion-1", auditId: "-1", expectedRevision: "0" },
      { id: "motion-1", auditId: "1", expectedRevision: "-1" },
      { id: "motion-1", auditId: "1.5", expectedRevision: "0" }
    ];

    for (const body of cases) {
      const res = {
        statusCode: 200,
        body: undefined,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        },
        setHeader() {}
      };

      await motionRestore(
        {
          method: "POST",
          headers: session.headers,
          body
        },
        res
      );

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "Invalid request");
    }
  });
});

