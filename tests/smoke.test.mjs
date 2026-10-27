

import test from "node:test";
import assert from "node:assert/strict";
import { requireAdmin } from "../api/_admin.js";

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
