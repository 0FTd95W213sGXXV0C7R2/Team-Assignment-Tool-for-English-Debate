import { timingSafeEqual } from "node:crypto";
export function requireAdmin(req) {
  const secret = process.env.ADMIN_API_TOKEN;
  const header = req.headers.authorization || "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";
  if (!secret || !supplied) return false;
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
export function normalizeNonNegativeBigint(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) {
    return null;
  }
  try {
    return BigInt(text).toString();
  } catch {
    return null;
  }
}
function parseSupabaseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
export async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !url ||
    !key ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)
  ) {
    throw new Error("Server configuration missing");
  }
  const requestOptions = {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  };
  if (
    options.body !== undefined &&
    typeof options.body !== "string"
  ) {
    requestOptions.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${url}/rest/v1/${path}`, requestOptions);
  const text = await response.text();
  const data = parseSupabaseJson(text);
  if (!response.ok) {
    const error = new Error(
      data?.message || `Supabase request failed: ${response.status}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
export function reject(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return true;
  }
  if (!requireAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return true;
  }
  return false;
}
