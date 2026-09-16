// functions/api/freelanceros/subscribe.js
// Email capture for the free tier. Single opt-in: the buyer typed their own
// address on the site. Stored in the brand list (freelanceros_subscribers)
// AND the global brand-tagged table (subscribers_global). No campaigns are
// sent from this list without Mayor's explicit go-ahead (standing order);
// transactional/product mail only.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function randomToken(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
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
    const email = String((body && body.email) || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return json({ ok: false, error: "bad_email" }, 400);
    }
    const source = String((body && body.source) || "site").slice(0, 32);
    const ip = request.headers.get("cf-connecting-ip") || "";
    const db = env.LEADS_DB;
    const now = new Date().toISOString();

    // Brand list: upsert, (re)confirm unless previously unsubscribed.
    const existing = await db
      .prepare("SELECT id, status FROM freelanceros_subscribers WHERE email = ?")
      .bind(email)
      .first();
    const unsubToken = randomToken(16);
    if (existing) {
      if (existing.status === "unsubscribed") {
        return json({ ok: false, error: "unsubscribed" }, 409);
      }
      await db
        .prepare(
          "UPDATE freelanceros_subscribers SET status='confirmed', confirmed_at=?, source=?, ip=? WHERE id=?"
        )
        .bind(now, source, ip, existing.id)
        .run();
    } else {
      await db
        .prepare(
          "INSERT INTO freelanceros_subscribers (email, status, confirm_token, source, ip, confirmed_at) VALUES (?, 'confirmed', ?, ?, ?, ?)"
        )
        .bind(email, unsubToken, source, ip, now)
        .run();
    }

    // Global brand-tagged table: upsert.
    await db
      .prepare(
        "INSERT INTO subscribers_global (email, brand, status, updated_at) VALUES (?, 'freelanceros', 'confirmed', ?) " +
          "ON CONFLICT(email, brand) DO UPDATE SET status='confirmed', updated_at=excluded.updated_at"
      )
      .bind(email, now)
      .run();

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
}
