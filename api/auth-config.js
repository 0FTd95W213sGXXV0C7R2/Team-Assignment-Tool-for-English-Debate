
function getPublicSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (
    !url ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ||
    !anonKey ||
    /\s/.test(anonKey)
  ) {
    return null;
  }

  return {
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
  };
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const config = getPublicSupabaseConfig();

  if (!config) {
    return res.status(503).json({
      error:
        "Supabase Authの公開設定が不足しています。サーバー環境変数を確認してください。",
    });
  }

  return res.status(200).json(config);
}
