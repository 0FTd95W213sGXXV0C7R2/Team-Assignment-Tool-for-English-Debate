import test from "node:test";
import assert from "node:assert/strict";
import { requireAdmin } from "../api/_admin.js";
import motionWrite from "../api/motion-write.js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
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
  const original = process.env.ADMIN_API_TOKEN;

  try {
    process.env.ADMIN_API_TOKEN = "a".repeat(64);

    const res = mockResponse();

    await motionWrite(
      { method: "POST", headers: {}, body: { action: "insert" } },
      res
    );

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "Unauthorized");
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_API_TOKEN;
    } else {
      process.env.ADMIN_API_TOKEN = original;
    }
  }
});

test("motion-write は不正な action を拒否する", async () => {
  const original = process.env.ADMIN_API_TOKEN;

  try {
    process.env.ADMIN_API_TOKEN = "a".repeat(64);

    const res = mockResponse();

    await motionWrite(
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + "a".repeat(64)
        },
        body: { action: "unknown" }
      },
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "Invalid action");
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_API_TOKEN;
    } else {
      process.env.ADMIN_API_TOKEN = original;
    }
  }
});

test("motion-write は revision のない更新を拒否する", async () => {
  const original = process.env.ADMIN_API_TOKEN;

  try {
    process.env.ADMIN_API_TOKEN = "a".repeat(64);

    const res = mockResponse();

    await motionWrite(
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + "a".repeat(64)
        },
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
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_API_TOKEN;
    } else {
      process.env.ADMIN_API_TOKEN = original;
    }
  }
});

test("motion-write は不正な論題データを拒否する", async () => {
  const original = process.env.ADMIN_API_TOKEN;

  try {
    process.env.ADMIN_API_TOKEN = "a".repeat(64);

    const res = mockResponse();

    await motionWrite(
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + "a".repeat(64)
        },
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
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_API_TOKEN;
    } else {
      process.env.ADMIN_API_TOKEN = original;
    }
  }
});

