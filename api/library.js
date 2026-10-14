import { syncLibrary } from "../lib/sync-library.mjs";
import { redisCredentials, createRedis } from "../lib/redis.mjs";
import { authConfigured, validSession, sessionFromCookie } from "../lib/auth.mjs";

// Authenticated GET-only endpoint. Also checks cookies directly as defense in depth.
let pending, pendingFull;
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  if (!authConfigured()) return res.status(503).json({ error: "auth_not_configured" });
  if (!validSession(sessionFromCookie(req.headers.cookie || ""))) return res.status(401).json({ error: "authentication_required" });
  const origin = req.headers.origin;
  if (origin && origin !== `https://${req.headers.host}`) return res.status(403).json({ error: "origin_not_allowed" });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "read_only" });
  }
  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(503).json({ error: "server_not_configured" });
  const credentials = redisCredentials();
  if (!credentials) return res.status(503).json({ error: "redis_not_configured" });
  const query = new URL(req.url || "/api/library", "https://library.invalid").searchParams;
  const forceFull = query.get("full") === "1";
  try {
    // Coalesce only simultaneous requests; every later button/hourly read checks deltas.
    const read = () => syncLibrary(token, createRedis(credentials), { forceFull });
    if (forceFull) {
      if (!pendingFull) pendingFull = (pending ? pending.catch(() => {}) : Promise.resolve())
        .then(read).finally(() => { pendingFull = null; });
    } else if (!pending && !pendingFull) {
      pending = read().finally(() => { pending = null; });
    }
    const data = await (forceFull ? pendingFull : pendingFull || pending);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json(data);
  } catch (error) {
    console.error("Library sync failed");
    return res.status(502).json({ error: "library_sync_failed" });
  }
}
