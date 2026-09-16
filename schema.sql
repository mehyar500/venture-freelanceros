-- pwa/schema.sql — FreelancerOS PWA schema + billing catalog seed.
-- Apply to the shared mehyar-jobs D1. Safe to re-run (IF NOT EXISTS / upserts).
-- NOTE: nothing in ~/workspace/repos/mehyar-web is touched by this file.

-- ── orders: one row per paid FreelancerOS purchase ─────────────────────────
CREATE TABLE IF NOT EXISTS freelanceros_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id    INTEGER NOT NULL,          -- billing_payments.id (unique: idempotent fulfill)
  product_id    TEXT NOT NULL,             -- billing_products.id
  email         TEXT NOT NULL,
  data_json     TEXT NOT NULL DEFAULT '{}',-- buyer dashboard state, keyed by access_token
  status        TEXT NOT NULL DEFAULT 'paid', -- paid
  access_token  TEXT NOT NULL,             -- unguessable buyer capability token
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ready_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_freelanceros_orders_token ON freelanceros_orders(access_token);
-- Idempotency key for the webhook fulfillment hook (one order per payment).
CREATE UNIQUE INDEX IF NOT EXISTS idx_freelanceros_orders_payment ON freelanceros_orders(payment_id);

-- ── billing catalog: 1 SKU, fulfillment='freelanceros' ──────────────────────
-- success_url_template: Stripe {access_token} is the freelanceros_orders token,
-- written by fulfillFreelanceros at webhook time.

INSERT INTO billing_products
  (id, name, brand, price_cents, currency, fulfillment, description, success_url_template, cancel_url, allowed_return_hosts, active, digital_file)
VALUES
  ('freelanceros-os', 'FreelancerOS — Freelancer Operating System', 'freelanceros', 2900, 'usd', 'freelanceros',
   'The freelancer operating system: client tracker with follow-up reminders, branded invoice generator with PDF export, content pipeline board, and a downloadable template pack (contract, proposal, onboarding). One-time payment, yours forever.',
   'https://freelanceros.mehyar.us/success.html?token={access_token}',
   'https://freelanceros.mehyar.us/#pricing', 'freelanceros.mehyar.us', 1, NULL)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, price_cents=excluded.price_cents, fulfillment=excluded.fulfillment,
  description=excluded.description, success_url_template=excluded.success_url_template,
  cancel_url=excluded.cancel_url, allowed_return_hosts=excluded.allowed_return_hosts,
  active=excluded.active;
