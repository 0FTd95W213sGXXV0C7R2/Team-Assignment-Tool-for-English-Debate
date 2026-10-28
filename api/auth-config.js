
function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return sendJson(res, 405, {
      error: "Method not allowed",
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;

  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)
  ) {
    return sendJson(res, 503, {
      error: "Supabase Auth configuration missing",
    });
  }

  return sendJson(res, 200, {
    // 現在の index.html が参照するプロパティ
    supabaseUrl,
    supabaseAnonKey,

    // 旧クライアントとの互換性を維持
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
  });
}

