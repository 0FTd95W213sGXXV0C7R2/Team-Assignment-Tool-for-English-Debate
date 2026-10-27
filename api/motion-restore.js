
import { reject, supabase, normalizeNonNegativeBigint } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (reject(req, res)) return;

  const { id, auditId, expectedRevision } = req.body || {};
  const auditKey = normalizeNonNegativeBigint(auditId);
  const revision = normalizeNonNegativeBigint(expectedRevision);

  if (
    !(typeof id === "string" ||
      (typeof id === "number" && Number.isSafeInteger(id))) ||
    String(id).length < 1 ||
    String(id).length > 100 ||
    auditKey === null ||
    auditKey === "0" ||
    revision === null
  ) {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    const restored = await supabase("rpc/motion_restore_revision_checked", {
      method: "POST",
      body: JSON.stringify({
        p_id: String(id),
        p_audit_id: auditKey,
        p_expected_revision: revision
      })
    });

    return res.status(200).json({ restored });
  } catch (error) {
    const message = error.message || "";

    if (message.includes("DUPLICATE_MOTION")) {
      return res.status(409).json({ error: "Duplicate motion" });
    }

    if (message.includes("REVISION_CONFLICT")) {
      return res.status(409).json({ error: "Revision conflict" });
    }

    if (
      message.includes("NOT_FOUND") ||
      message.includes("SNAPSHOT_NOT_FOUND")
    ) {
      return res.status(404).json({ error: "Not found" });
    }

    if (
      message.includes("INVALID_REQUEST") ||
      message.includes("INVALID_SNAPSHOT")
    ) {
      return res.status(422).json({ error: "Invalid restore request" });
    }

    console.error("Restore RPC failed");
    return res.status(500).json({ error: "Restore failed" });
  }
}
