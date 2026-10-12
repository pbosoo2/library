import { next } from "@vercel/functions";
import { authConfigured, sessionFromCookie, validSession } from "./lib/auth.mjs";
import { loginPage } from "./lib/login-view.mjs";
export const config = { matcher: "/:path*", runtime: "nodejs" };
const headers = { "Cache-Control": "private, no-store", "Vercel-CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" };
export default function middleware(request) {
  const url = new URL(request.url), path = url.pathname;
  const authenticated = validSession(sessionFromCookie(request.headers.get("cookie") || ""));
  if (path === "/api/login" || path === "/api/logout") return next({ headers });
  if (path === "/login" || path === "/login/") {
    if (authenticated) return new Response(null, { status: 303, headers: { ...headers, Location: "/" } });
    return new Response(loginPage({ configured: authConfigured(), error: url.searchParams.get("error") || "" }), {
      status: authConfigured() ? 200 : 503,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }
    });
  }
  if (!authenticated) {
    if (path.startsWith("/api/") || path.startsWith("/data/") || path.startsWith("/assets/")) {
      return Response.json({ error: "authentication_required" }, { status: 401, headers });
    }
    return new Response(null, { status: 303, headers: { ...headers, Location: "/login" } });
  }
  return next({ headers });
}
