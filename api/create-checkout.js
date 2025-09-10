// /api/create-checkout.js
export const config = { runtime: "nodejs" };

import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const ALLOW_ORIGINS = new Set([
  "https://gabrioladirectory.ca",
  "https://www.gabrioladirectory.ca",
]);

function cors(res, origin) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  if (ALLOW_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  cors(res, origin);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { amount_cents, currency = "cad", email, description,
            businessName, contactName, phone } = req.body || {};
    if (!amount_cents || amount_cents < 50) {
      return res.status(400).json({ error: "Amount too small" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency,
          unit_amount: amount_cents,
          product_data: { name: description || "Gabriola Directory — Listings & Ads" }
        },
        quantity: 1
      }],
      metadata: { businessName, contactName, phone },
      success_url: "https://gabrioladirectory.ca/?paid=1",
      cancel_url: "https://gabrioladirectory.ca/?paid=0"
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    // still include CORS headers (already set at top)
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
