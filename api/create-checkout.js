// src/api/create-checkout.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Allow these sites to call this endpoint from the browser
const ALLOWED_ORIGINS = [
  "https://gabrioladirectory.ca",
  "https://www.gabrioladirectory.ca",
  "https://gabedir.carrd.co",
];

export default async function handler(req, res) {
  // --- CORS headers ---
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Body comes in as JSON from your site
    const {
      amount_cents,
      currency = "cad",
      email = "",
      description = "Gabriola Directory — Listings & Ads",
      businessName = "",
      contactName = "",
      phone = "",
    } = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    // Minimal validation
    const amt = Number(amount_cents);
    if (!Number.isFinite(amt) || amt < 50) {
      return res.status(400).json({ error: "Invalid amount_cents" });
    }

    const returnBase =
      origin && ALLOWED_ORIGINS.includes(origin)
        ? origin
        : "https://gabrioladirectory.ca";

    const success_url = `${returnBase}/?paid=1`;
    const cancel_url = `${returnBase}/?canceled=1`;

    // Create a one-line item checkout for the exact total
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email || undefined,
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: description,
            },
            unit_amount: amt, // already in cents
          },
          quantity: 1,
        },
      ],
      success_url,
      cancel_url,
      metadata: {
        businessName,
        contactName,
        phone,
        source: "gabrioladirectory-web",
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}
