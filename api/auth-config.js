function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.end(JSON.stringify(data));
}

function getSupabaseConfig() {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    return null;
  }

  if (
    parsedUrl.protocol !== "https:" &&
    parsedUrl.hostname !== "localhost" &&
    parsedUrl.hostname !== "127.0.0.1"
  ) {
    return null;
  }

  if (parsedUrl.username || parsedUrl.password) {
    return null;
  }

  return {
    supabaseUrl: parsedUrl.origin,
    supabaseAnonKey
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return sendJson(res, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "GETリクエストのみ利用できます。"
    });
  }

  const config = getSupabaseConfig();

  if (!config) {
    console.error(
      "auth-config: Supabase URLまたは公開キーが未設定、または不正です。"
    );

    return sendJson(res, 503, {
      error: "AUTH_CONFIG_UNAVAILABLE",
      message: "認証設定を読み込めませんでした。"
    });
  }

  return sendJson(res, 200, config);
}
