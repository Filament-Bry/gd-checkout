// /api/stripe-webhook.js
export const config = { api: { bodyParser: false }, runtime: "nodejs" };

import Stripe from "stripe";

// Use your TEST secret while testing (sk_test_...)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Helper to read raw body (needed for signature verification)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on("data", (c) => data.push(c));
    req.on("end", () => resolve(Buffer.concat(data)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const sig = req.headers["stripe-signature"];
  const whsec = process.env.STRIPE_WEBHOOK_SECRET; // whsec_... (TEST while testing)

  if (!whsec) {
    console.error("Missing STRIPE_WEBHOOK_SECRET env var");
    return res.status(500).json({ error: "Server not configured" });
  }

  let event;
  try {
    const raw = await readRawBody(req);       // IMPORTANT: raw body
    event = stripe.webhooks.constructEvent(raw, sig, whsec);
  } catch (err) {
    console.error("❌ Webhook signature verify failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err?.message || "Bad request"}`);
  }

  // Handle the event(s) you care about
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("✅ checkout.session.completed", {
          id: session.id,
          amount_total: session.amount_total,
          currency: session.currency,
          email: session.customer_details?.email || session.customer_email,
          metadata: session.metadata,
        });
        break;
      }
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    // Acknowledge receipt
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("⚠️ Webhook handler error:", err);
    return res.status(500).json({ error: "Handler failure" });
  }
}
