import { createHash } from "node:crypto";
import { authorizeAdmin, supabase } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const session = await authorizeAdmin(req, res);

  if (!session) {
    return;
  }

  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      error: "Invalid request",
    });
  }

  const { id, expectedRevision } = body;

  if (
    typeof id !== "string" ||
    id.length < 1 ||
    id.length > 100 ||
    expectedRevision === undefined ||
    expectedRevision === null ||
    !/^\d+$/.test(String(expectedRevision))
  ) {
    return res.status(400).json({
      error: "Invalid request",
    });
  }

  let revision;

  try {
    revision = BigInt(expectedRevision);

    if (
      revision < 0n ||
      revision > 9223372036854775807n
    ) {
      return res.status(400).json({
        error: "Invalid revision",
      });
    }
  } catch {
    return res.status(400).json({
      error: "Invalid revision",
    });
  }

  const token = process.env.ADMIN_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "Server configuration missing",
    });
  }

  const clientHash = createHash("sha256")
    .update(token)
    .digest("hex");

  try {
    const result = await supabase("rpc/motion_apply", {
      method: "POST",
      body: {
        p_action: "record",
        p_id: id,
        p_row: null,
        p_expected_revision: revision.toString(),
        p_client_hash: clientHash,
      },
    });

    return res.status(200).json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = [
      error?.data?.message,
      error?.message,
      error?.data?.details,
    ]
      .filter(Boolean)
      .join(" ");

    if (/REVISION_CONFLICT|revision/i.test(message)) {
      return res.status(409).json({
        error: "REVISION_CONFLICT",
      });
    }

    if (/NOT_FOUND/i.test(message)) {
      return res.status(404).json({
        error: "NOT_FOUND",
      });
    }

    if (/DELETED/i.test(message)) {
      return res.status(409).json({
        error: "MOTION_DELETED",
      });
    }

    if (/RATE_LIMIT/i.test(message)) {
      return res.status(429).json({
        error: "RATE_LIMITED",
      });
    }

    if (/INVALID_/i.test(message)) {
      return res.status(400).json({
        error: "INVALID_REQUEST",
      });
    }

    console.error(
      "motion-record failed:",
      error?.status || "unknown"
    );

    return res.status(500).json({
      error: "Failed to record motion",
    });
  }
}
