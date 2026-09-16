// functions/api/freelanceros/data.js
// Buyer-data API for FreelancerOS. Dashboard state is stored in the shared
// mehyar_leads_prod D1 (freelanceros_orders.data_json), keyed by the buyer's
// unguessable access token.
//
//   GET  /api/freelanceros/data?token=...   -> {ok:true, data:{...}}
//   POST /api/freelanceros/data {token, data} -> {ok:true}
//
// The token is the SAME token the Stripe success_url_template receives:
// fulfillFreelanceros unifies billing_payments.access_token onto the
// freelanceros_orders row at webhook time. Unknown/short tokens fail closed
// with 404. Tokens are never logged.
const MAX_BYTES = 512 * 1024; // 512KB cap per dashboard state

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function orderForToken(db, token) {
  if (!token || typeof token !== "string" || token.length < 16) return null;
  try {
    return await db
      .prepare("SELECT id, data_json FROM freelanceros_orders WHERE access_token = ? AND status IN ('paid','ready')")
      .bind(token)
      .first();
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "unavailable" }, 503);
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();
    const row = await orderForToken(env.LEADS_DB, token);
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    let data = null;
    try {
      data = row.data_json ? JSON.parse(row.data_json) : null;
    } catch {
      data = null;
    }
    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "unavailable" }, 503);
    let body = null;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }
    const token = String((body && body.token) || "").trim();
    const data = body && body.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return json({ ok: false, error: "bad_data" }, 400);
    }
    // Defensive shape check — the dashboard always sends these four keys.
    if (!Array.isArray(data.clients) || !Array.isArray(data.invoices) ||
        !Array.isArray(data.content) || !data.settings || typeof data.settings !== "object") {
      return json({ ok: false, error: "bad_shape" }, 400);
    }
    const serialized = JSON.stringify(data);
    // UTF-8 byte count (not JS string length — names/notes may be non-ASCII).
    if (new TextEncoder().encode(serialized).length > MAX_BYTES) {
      return json({ ok: false, error: "too_large" }, 413);
    }
    const row = await orderForToken(env.LEADS_DB, token);
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    await env.LEADS_DB
      .prepare("UPDATE freelanceros_orders SET data_json = ? WHERE id = ?")
      .bind(serialized, row.id)
      .run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
}
