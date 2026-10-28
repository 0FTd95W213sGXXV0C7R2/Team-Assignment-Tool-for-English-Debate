
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

  const url = process.env.SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (
    !url ||
    !anonKey ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)
  ) {
    return sendJson(res, 503, {
      error: "Supabase Auth configuration missing",
    });
  }

  return sendJson(res, 200, {
    url,
    anonKey,
  });
}
