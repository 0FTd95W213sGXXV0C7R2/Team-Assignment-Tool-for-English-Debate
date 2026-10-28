import { createHash } from "node:crypto";

export async function withAdminSession(callback) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const userId = "00000000-0000-4000-8000-000000000001";
  const token = "T".repeat(43);
  const tokenHash = createHash("sha256")
    .update(token, "utf8")
    .digest("hex");

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";

  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input.url
    );
    const path = url.pathname;

    let data;

    if (path.endsWith("/debate_sessions")) {
      data = [{
        token_hash: tokenHash,
        user_id: userId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null
      }];
    } else if (path.endsWith("/debate_members")) {
      data = [{
        user_id: userId,
        revoked_at: null
      }];
    } else if (path.endsWith("/debate_admin_roles")) {
      data = [{
        user_id: userId,
        suspended_at: null
      }];
    } else {
      throw new Error(
        `Unexpected mocked Supabase request: ${path}`
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  };

  try {
    await callback({
      headers: {
        cookie: `debate_session=${token}`
      }
    });
  } finally {
    globalThis.fetch = originalFetch;

    if (originalUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalUrl;
    }

    if (originalKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  }
}