// /api/create-checkout.js
export const config = { runtime: "nodejs" };

import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const ALLOW_ORIGINS = new Set([
  "https://gabrioladirectory.ca",
  "https://www.gabrioladirectory.ca",
]);

function setCors(res, originHeader) {
  const origin = originHeader || "";
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  if (ALLOW_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
}

async function createSession({ amount_cents, currency = "cad", email, description, businessName, contactName, phone }) {
  const amt = Number(amount_cents);
  if (!amt || isNaN(amt) || amt < 50) throw new Error("Amount too small");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email || undefined,
    line_items: [{
      price_data: {
        currency,
        unit_amount: amt,
        product_data: { name: description || "Gabriola Directory — Listings & Ads" },
      },
      quantity: 1,
    }],
    metadata: { businessName, contactName, phone },
    success_url: "https://gabrioladirectory.ca/?thanks=1&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: "https://gabrioladirectory.ca/?canceled=1",
  });

  return session.url;
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const { amount_cents, currency, email, description, businessName, contactName, phone } = req.query || {};
      const url = await createSession({ amount_cents, currency, email, description, businessName, contactName, phone });
      return res.redirect(303, url);
    }

    if (req.method === "POST") {
      const { amount_cents, currency, email, description, businessName, contactName, phone } = req.body || {};
      const url = await createSession({ amount_cents, currency, email, description, businessName, contactName, phone });
      return res.status(200).json({ url });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err?.message || "Bad request" });
  }
}
