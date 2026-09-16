// functions/api/freelanceros/unsubscribe.js
// One-click unsubscribe. The token is the subscriber's confirm_token
// (emailed in every product-functional message). Honored in the brand list
// and reflected in the global table.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function page(title, msg) {
  return new Response(
    "<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">" +
      "<title>" + title + "</title></head><body style=\"font-family:system-ui;background:#070b12;color:#e8eef7;" +
      "display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0\">" +
      "<div style=\"text-align:center;padding:32px\"><h1 style=\"color:#34d399\">" + title + "</h1><p>" + msg + "</p>" +
      "<p><a href=\"/\" style=\"color:#34d399\">Back to FreelancerOS</a></p></div></body></html>",
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.LEADS_DB) return page("Error", "Service unavailable.");
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!token || token.length < 16) return page("Invalid link", "This unsubscribe link is invalid.");
    const db = env.LEADS_DB;
    const row = await db
      .prepare("SELECT id, email FROM freelanceros_subscribers WHERE confirm_token = ?")
      .bind(token)
      .first();
    if (!row) return page("Invalid link", "This unsubscribe link is invalid or already used.");
    const now = new Date().toISOString();
    await db
      .prepare("UPDATE freelanceros_subscribers SET status='unsubscribed', unsubscribed_at=? WHERE id=?")
      .bind(now, row.id)
      .run();
    await db
      .prepare("UPDATE subscribers_global SET status='unsubscribed', updated_at=? WHERE email=? AND brand='freelanceros'")
      .bind(now, row.email)
      .run();
    return page("Unsubscribed", "You won't receive product emails from FreelancerOS again.");
  } catch (e) {
    return page("Error", "Something went wrong.");
  }
}
