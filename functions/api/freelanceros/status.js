// functions/api/freelanceros/status.js
// Same-origin status proxy: forwards to the centralized mehyar.us billing
// endpoint with a browser User-Agent (server-side rule). Keeps the PWA on
// same-origin fetch so no CORS preflight is needed.
const UPSTREAM = "https://mehyar.us/api/pay/status";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!token || token.length < 16) {
      return json({ ok: false, error: "invalid_token" }, 403);
    }
    const upstream = await fetch(UPSTREAM + "?token=" + encodeURIComponent(token), {
      headers: { "user-agent": UA },
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
}
