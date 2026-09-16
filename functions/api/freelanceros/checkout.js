// functions/api/freelanceros/checkout.js
// Same-origin checkout proxy: forwards to the centralized mehyar.us billing
// endpoint with a browser User-Agent (server-side rule). Keeps the PWA on
// same-origin fetch so no CORS preflight is needed.
const UPSTREAM = "https://mehyar.us/api/pay/checkout";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request }) {
  try {
    let body = null;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }
    // Narrow allowlist: product_id must be freelanceros-os, no price override.
    if (!body || body.product_id !== "freelanceros-os") {
      return json({ ok: false, error: "invalid_product" }, 400);
    }
    const email = String(body.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "bad_email" }, 400);
    }
    const params = body.params && typeof body.params === "object" ? body.params : {};
    const payload = { product_id: "freelanceros-os", email, params, test: body.test === true };
    if (JSON.stringify(payload).length > 2048) {
      return json({ ok: false, error: "params_too_large" }, 400);
    }
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify(payload),
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

export async function onRequestGet() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
