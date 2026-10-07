import { readLibrary } from "../lib/library.mjs";

// Public GET-only endpoint. A CORS allowlist is not an authentication mechanism.
let cached, cachedAt = 0, pending;
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGIN || "https://pbosoo2.github.io")
    .split(",").map(value => value.trim()).filter(Boolean);
  if (origin) {
    const sameOrigin = origin === `https://${req.headers.host}`;
    if (!sameOrigin && !allowed.includes(origin)) return res.status(403).json({ error: "origin_not_allowed" });
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "read_only" });
  }
  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(503).json({ error: "server_not_configured" });
  try {
    if (!cached || Date.now() - cachedAt >= 10000) {
      if (!pending) pending = readLibrary(token).then(data => {
        cached = data; cachedAt = Date.now(); return data;
      }).finally(() => { pending = null; });
      await pending;
    }
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, must-revalidate");
    return res.status(200).json(cached);
  } catch (error) {
    console.error("Library read failed:", error.message);
    return res.status(502).json({ error: "notion_read_failed" });
  }
}
