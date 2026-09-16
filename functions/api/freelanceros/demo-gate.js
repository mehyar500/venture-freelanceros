// functions/api/freelanceros/demo-gate.js
// IP-based rate limit for the free demo. No account required: counts demo
// loads per IP in KV, 25 per rolling 24h. Over the limit the demo shows the
// paywall prompt instead of the interactive preview.
const LIMIT = 25;
const WINDOW_S = 24 * 3600;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.FREELANCEROS_KV) return json({ ok: true, allowed: true, gated: false });
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const key = "demo:" + ip;
    const kv = env.FREELANCEROS_KV;
    const raw = await kv.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    if (count >= LIMIT) {
      return json({ ok: true, allowed: false, remaining: 0 });
    }
    await kv.put(key, String(count + 1), { expirationTtl: WINDOW_S });
    return json({ ok: true, allowed: true, remaining: LIMIT - count - 1 });
  } catch (e) {
    // Fail open: a KV hiccup must never block the demo.
    return json({ ok: true, allowed: true, gated: false });
  }
}
