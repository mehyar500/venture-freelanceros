/* FreelancerOS — shared app logic.
 *
 * Buy buttons POST {product_id, email, params} DIRECTLY to the centralized
 * checkout https://mehyar.us/api/pay/checkout (house pattern, same as
 * Designful). Price and success/cancel URLs come from the billing_products
 * row — the client never sends them.
 */
"use strict";

var PRODUCT_ID = "freelanceros-os";
/* Same-origin proxies (functions/api/freelanceros/): forward 1:1 to the
 * centralized mehyar.us billing endpoints. Same-origin = no CORS preflight. */
var CHECKOUT_URL = "/api/freelanceros/checkout";
var STATUS_URL = "/api/freelanceros/status";
var SUPPORT_EMAIL = "info@mehyar.us";

/* ---------- helpers ---------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim());
}
function uid(prefix) {
  return (prefix || "id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/* ---------- buy modal ---------- */
function openBuyModal() {
  var modal = $("#buy-modal");
  if (!modal) return;
  var email = $("#buy-email");
  var err = $("#buy-error");
  if (email) email.value = "";
  if (err) err.textContent = "";
  modal.hidden = false;
  if (email) email.focus();
}
function closeBuyModal() {
  var modal = $("#buy-modal");
  if (modal) modal.hidden = true;
}

function checkoutPayload(email) {
  return {
    product_id: PRODUCT_ID,
    email: email,
    params: { source: "site" }
  };
}

/* Production checkout: POST the payload, redirect to Stripe. */
async function liveCheckout(email) {
  var res;
  try {
    res = await fetch(CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload(email))
    });
  } catch (e) {
    return { ok: false, error: "Couldn't reach checkout — check your connection and try again." };
  }
  var data = null;
  try { data = await res.json(); } catch (e) { /* fall through */ }
  if (!res.ok || !data || data.ok !== true || !data.checkout_url) {
    var msg = (data && (data.message || data.error)) || ("Checkout failed (HTTP " + res.status + ").");
    return { ok: false, error: String(msg).slice(0, 200) };
  }
  window.location.href = data.checkout_url;
  return { ok: true };
}

function wireBuyButtons() {
  $all("[data-buy]").forEach(function (btn) {
    btn.addEventListener("click", function () { openBuyModal(); });
  });
  $all("[data-close-buy]").forEach(function (el) {
    el.addEventListener("click", function () { closeBuyModal(); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeBuyModal();
  });
  var buyForm = $("#buy-form");
  if (buyForm) {
    buyForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var emailEl = $("#buy-email");
      var err = $("#buy-error");
      var email = emailEl.value.trim();
      if (!validEmail(email)) {
        err.textContent = "Enter a valid email — your dashboard link goes there.";
        return;
      }
      err.textContent = "";
      var btn = buyForm.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = "Starting secure checkout…"; }
      liveCheckout(email).then(function (r) {
        if (!r.ok) {
          err.textContent = r.error;
          if (btn) { btn.disabled = false; btn.textContent = "Continue to secure checkout →"; }
        }
        /* on success the page redirects to Stripe — nothing else to do */
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", wireBuyButtons);
document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("subscribe-form");
  if (!form) return;
  var input = document.getElementById("subscribe-email");
  var msg = document.getElementById("subscribe-msg");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = (input.value || "").trim();
    if (!validEmail(email)) {
      msg.textContent = "Please enter a valid email address.";
      msg.style.color = "#f87171";
      return;
    }
    msg.textContent = "Subscribing…";
    msg.style.color = "";
    fetch("/api/freelanceros/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email, source: "landing" })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) {
        msg.textContent = "You're in. Watch your inbox for new templates.";
        msg.style.color = "#34d399";
        input.value = "";
      } else if (d && d.error === "unsubscribed") {
        msg.textContent = "That address was unsubscribed. Email info@mehyar.us to rejoin.";
        msg.style.color = "#fbbf24";
      } else {
        msg.textContent = "Something went wrong — please try again.";
        msg.style.color = "#f87171";
      }
    }).catch(function () {
      msg.textContent = "Something went wrong — please try again.";
      msg.style.color = "#f87171";
    });
  });
});

window.FreelancerOSCheckout = {
  productId: PRODUCT_ID,
  checkoutUrl: CHECKOUT_URL,
  statusUrl: STATUS_URL,
  supportEmail: SUPPORT_EMAIL,
  openBuyModal: openBuyModal,
  wireBuyButtons: wireBuyButtons,
  esc: esc,
  uid: uid,
  validEmail: validEmail
};
