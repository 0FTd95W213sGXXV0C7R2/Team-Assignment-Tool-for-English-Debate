
import { requireAdmin, supabase } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (!requireAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const motionId = req.query?.motionId;

  const params = new URLSearchParams({
    select: "*",
    order: "changed_at.desc",
    limit: "100"
  });

  if (motionId !== undefined) {
    if (
      typeof motionId !== "string" ||
      motionId.length < 1 ||
      motionId.length > 100
    ) {
      return res.status(400).json({
        error: "Invalid motionId"
      });
    }

    params.set("motion_id", `eq.${motionId}`);
  }

  try {
    const rows = await supabase(
      `motion_audit?${params.toString()}`
    );

    return res.status(200).json({
      ok: true,
      history: Array.isArray(rows) ? rows : []
    });
  } catch (error) {
    console.error(
      "motion-history failed:",
      error.status || "unknown"
    );

    return res.status(500).json({
      error: "Failed to load motion history"
    });
  }
}
