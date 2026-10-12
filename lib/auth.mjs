import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const COOKIE_NAME = "__Host-library_session";
const MAX_SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
export function authConfigured() {
  return typeof process.env.LIBRARY_PASSWORD === "string" && process.env.LIBRARY_PASSWORD.length >= 12 && process.env.LIBRARY_PASSWORD.length <= 256
    && typeof process.env.SESSION_SECRET === "string" && process.env.SESSION_SECRET.length >= 32;
}
function hash(value) { return createHash("sha256").update(value).digest(); }
function signature(payload) {
  // Rotating either the password or the secret invalidates old sessions.
  return createHmac("sha256", process.env.SESSION_SECRET).update("library-v1:")
    .update(hash(process.env.LIBRARY_PASSWORD)).update(payload).digest();
}
export function passwordMatches(value) {
  return authConfigured() && typeof value === "string" && value.length <= 256
    && timingSafeEqual(hash(value), hash(process.env.LIBRARY_PASSWORD));
}
export function createSession(now = Date.now()) {
  if (!authConfigured()) throw new Error("Authentication is not configured");
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: now, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function sessionFromCookie(header = "") {
  if (typeof header !== "string" || header.length > 16384) return "";
  return header.split(";").map(part => part.trim()).find(part => part.startsWith(COOKIE_NAME + "="))?.slice(COOKIE_NAME.length + 1) || "";
}
export function validSession(token, now = Date.now()) {
  if (!authConfigured() || typeof token !== "string" || token.length > 1024) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, mac] = parts, supplied = Buffer.from(mac, "base64url"), expected = signature(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.v === 1 && Number.isFinite(data.iat) && data.iat <= now + 60000
      && now - data.iat < MAX_SESSION_AGE && /^[a-f0-9]{32}$/.test(data.nonce);
  } catch { return false; }
}
export function sessionCookie(token) {
  // No Expires or Max-Age: browser-session cookie, not a persistent login.
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
export function clearSessionCookie() { return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
export function sameOrigin(req) {
  try { return new URL(req.headers.origin).origin === `https://${req.headers.host}`; } catch { return false; }
}
export function privateHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}
