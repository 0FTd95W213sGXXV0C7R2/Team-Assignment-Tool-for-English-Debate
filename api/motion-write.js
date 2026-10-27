import { createHash } from “node:crypto”;
import { requireAdmin, supabase } from “./_admin.js”;

function send(res, status, body) {
return res.status(status).json(body);
}

function normalizeRevision(value) {
if (value === undefined || value === null || value === “”) {
return null;
}

if (!/^\d+$/.test(String(value))) {
return undefined;
}

try {
const revision = BigInt(value);
if (revision < 0n || revision > 9223372036854775807n) {
return undefined;
}
return revision.toString();
} catch {
return undefined;
}
}

export default async function handler(req, res) {
if (req.method !== “POST”) {
res.setHeader(“Allow”, “POST”);
return send(res, 405, { error: “Method not allowed” });
}

if (!requireAdmin(req)) {
return send(res, 401, { error: “Unauthorized” });
}

const body = req.body;
if (!body || typeof body !== “object” || Array.isArray(body)) {
return send(res, 400, { error: “Invalid request” });
}

const { action } = body;
if (![“insert”, “update”, “delete”, “record”].includes(action)) {
return send(res, 400, { error: “Invalid action” });
}

const id = body.id == null ? null : String(body.id);

if (
action !== “insert” &&
(!id || id.length > 100)
) {
return send(res, 400, { error: “Invalid id” });
}

const expectedRevision = normalizeRevision(body.expectedRevision);

if (
expectedRevision === undefined ||
(action !== “insert” && expectedRevision === null)
) {
return send(res, 400, { error: “Invalid revision” });
}

const row =
body.row &&
typeof body.row === “object” &&
!Array.isArray(body.row)
? body.row
: {};

const motion = body.motion ?? row.motion;
const tournament = body.tournament ?? row.tournament ?? “”;
const year = body.year ?? row.year;
const history = body.history ?? row.history ?? [];

if (action === “insert” || action === “update”) {
if (
typeof motion !== “string” ||
!motion.trim() ||
motion.trim().length > 1500 ||
typeof tournament !== “string” ||
!tournament.trim() ||
tournament.trim().length > 180 ||
!/^\d{4}$/.test(String(year)) ||
!Array.isArray(history) ||
history.length > 500 ||
history.some(
(item) => typeof item !== “string” || item.length > 40
)
) {
return send(res, 400, { error: “Invalid motion data” });
}
}

const token = process.env.ADMIN_API_TOKEN;
if (!token) {
return send(res, 500, { error: “Server configuration missing” });
}

const tokenHash = createHash(“sha256”).update(token).digest(“hex”);

try {
const result = await supabase(“rpc/motion_apply”, {
method: “POST”,
body: {
p_action: action,
p_id: id,
p_row:
action === “insert” || action === “update”
? {
motion: motion.trim(),
tournament: tournament.trim(),
year: String(year),
history
}
: null,
p_expected_revision: expectedRevision,
p_client_hash: tokenHash
}
});

return send(res, 200, result);

} catch (error) {
const message = error.data?.message || error.message || “”;

if (/REVISION_CONFLICT|revision/i.test(message)) {
  return send(res, 409, { error: "REVISION_CONFLICT" });
}
if (/DUPLICATE_MOTION|duplicate|unique/i.test(message)) {
  return send(res, 409, { error: "DUPLICATE_MOTION" });
}
if (/NOT_FOUND/i.test(message)) {
  return send(res, 404, { error: "NOT_FOUND" });
}
if (/DELETED/i.test(message)) {
  return send(res, 409, { error: "MOTION_DELETED" });
}
if (/RATE_LIMIT/i.test(message)) {
  return send(res, 429, { error: "RATE_LIMITED" });
}
if (/INVALID_/i.test(message)) {
  return send(res, 400, { error: "INVALID_REQUEST" });
}
console.error("motion-write failed:", error.status || "unknown");
return send(res, 500, { error: "Failed to update motion" });

}
}
