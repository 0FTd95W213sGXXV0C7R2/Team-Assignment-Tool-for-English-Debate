
import { supabase } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const offset = Number(req.query?.offset ?? 0);

  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= 50000
  ) {
    return res.status(400).json({ error: "Invalid offset" });
  }

  try {
    const rows = await supabase(
      "motions?select=id,motion,tournament,year,history,revision,is_deleted" +
      "&is_deleted=eq.false" +
      "&order=id.asc" +
      "&offset=" + offset +
      "&limit=1000"
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error("motion-list failed:", error.status || "unknown");
    return res.status(500).json({
      error: "Failed to load motions",
    });
  }
}

