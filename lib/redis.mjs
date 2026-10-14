// Server-side REST client. Never expose either URL/token to the browser or logs.
export function redisCredentials(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return { url: url.replace(/\/$/, ''), token };
  } catch { return null; }
}
export function createRedis(credentials, fetchImpl = fetch) {
  return async (...command) => {
    const res = await fetchImpl(credentials.url, {
      method: 'POST', headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Redis HTTP status ${res.status}`);
    const json = await res.json();
    // Do not include provider error details, which might contain sensitive data.
    if (json.error || !Object.hasOwn(json, 'result')) throw new Error('Redis command failed');
    return json.result;
  };
}
