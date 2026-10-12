import { sameOrigin, clearSessionCookie, privateHeaders } from "../lib/auth.mjs";
export default function logout(req, res) {
  privateHeaders(res);
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!sameOrigin(req)) return res.status(403).end();
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.setHeader("Location", "/login");
  return res.status(303).end();
}
