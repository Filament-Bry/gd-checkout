// /api/stripe-webhook.js
export const config = {
  api: { bodyParser: false },     // we need the raw body for signature verify
  runtime: "nodejs",
};

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// OPTIONAL: if you want to mirror successful payments to Sheets,
// put your Apps Script URL in Vercel env as GSHEETS_WEBHOOK_URL.
const SHEETS_URL = process.env.GSHEETS_WEBHOOK_URL || "";

// tiny raw-body reader (no extra packages)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  // 1) Verify Stripe signature
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).end("Missing STRIPE_WEBHOOK_SECRET");

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("⚠️  Webhook signature verify failed:", err.message);
    return res.status(400).send(`Bad signature: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object; // Stripe.Checkout.Session
        // Pull what we care about (guarding optional fields)
        const payload = {
          type: event.type,
          at: new Date().toISOString(),
          session_id: s.id,
          amount_total: s.amount_total ?? null,
          currency: s.currency ?? null,
          status: s.status,
          customer_email: s.customer_details?.email || s.customer_email || null,
          // from create-checkout metadata
          businessName: s.metadata?.businessName || "",
          contactName: s.metadata?.contactName || "",
          phone: s.metadata?.phone || "",
        };

        console.log("✅ checkout.session.completed", payload);

        // OPTIONAL mirror to Google Sheets (Apps Script)
        if (SHEETS_URL) {
          const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
          await fetch(SHEETS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body,
          }).catch((e) => console.warn("Sheets mirror failed:", e.message));
        }
        break;
      }

      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
      case "checkout.session.expired":
        console.log(`ℹ️ ${event.type}`, event.data.object?.id);
        break;

      default:
        // Keep it quiet but acknowledged
        // console.log(`Unhandled event: ${event.type}`);
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).end("Webhook error");
  }
}
