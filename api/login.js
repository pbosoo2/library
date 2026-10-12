import { authConfigured, passwordMatches, createSession, sessionCookie, sameOrigin, privateHeaders } from "../lib/auth.mjs";
// Best-effort per-instance throttling; strong passwords remain necessary.
const attempts = new Map();
function redirect(res, target) { res.setHeader("Location", target); return res.status(303).end(); }
export default async function login(req, res) {
  privateHeaders(res);
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!sameOrigin(req)) return res.status(403).end();
  if (!authConfigured()) return res.status(503).json({ error: "auth_not_configured" });
  if (Number(req.headers["content-length"]) > 2048) return res.status(413).end();
  const ip = String(req.headers["x-real-ip"] || "unknown"), now = Date.now();
  let bucket = attempts.get(ip);
  if (!bucket || now - bucket.started >= 15 * 60 * 1000) bucket = { started: now, failures: 0 };
  if (bucket.failures >= 10) { res.setHeader("Retry-After", "900"); return redirect(res, "/login?error=limited"); }
  const body = req.body;
  const password = typeof body === "string" ? new URLSearchParams(body).get("password") : body?.password;
  if (!passwordMatches(password)) {
    bucket.failures++; attempts.set(ip, bucket);
    if (attempts.size > 1000) attempts.delete(attempts.keys().next().value);
    return redirect(res, "/login?error=invalid");
  }
  attempts.delete(ip);
  res.setHeader("Set-Cookie", sessionCookie(createSession()));
  return redirect(res, "/");
}
