// api/create-checkout.js
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// allow prod site; add a preview origin if you need it
const ALLOWED_ORIGINS = new Set([
  "https://gabrioladir.carrd.co"
  // "http://localhost:3000" // add if testing locally
]);

function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS.has(origin) ? origin : "https://gabrioladir.carrd.co");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || "";
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    return res.status(204).end(); // preflight OK
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      amount_cents,
      currency = "cad",
      description = "Gabriola Directory — Listings & Ads",
      businessName,
      contactName,
      email,
      phone
    } = req.body || {};

    if (!amount_cents || amount_cents < 50) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email || undefined,
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: description },
            unit_amount: amount_cents
          },
          quantity: 1
        }
      ],
      success_url: "https://gabrioladir.carrd.co/?paid=1",
		cancel_url:  "https://gabrioladir.carrd.co/?canceled=1",
      metadata: {
        businessName: businessName || "",
        contactName:  contactName  || "",
        phone:        phone        || ""
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};