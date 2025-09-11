// /api/stripe-webhook.js
// Vercel → Node runtime, DO NOT parse body (Stripe needs the raw bytes)
export const config = { api: { bodyParser: false }, runtime: "nodejs" };

import Stripe from "stripe";

// --- Required envs (Vercel → Project Settings → Environment Variables) ---
// STRIPE_SECRET_KEY        = sk_live_... (or sk_test_... in Test mode)
// STRIPE_WEBHOOK_SECRET    = whsec_...   (from this exact endpoint in your Stripe dashboard)
//
// --- Optional (leave blank to disable) ---
// GSHEETS_WEBHOOK_URL      = https://script.google.com/macros/s/.../exec   (Apps Script to log)
// RESEND_API_KEY           = re_...  (if you want an email ping)
// RESEND_FROM              = "GD <no-reply@gabrioladirectory.ca>"
// RESEND_TO                = "info@gabrioladirectory.ca"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Read raw body for signature verification
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Optional notifier helpers
async function notifyGAS(payload) {
  const url = process.env.GSHEETS_WEBHOOK_URL;
  if (!url) return;
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
}

async function notifyEmail(subject, html) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "no-reply@gabrioladirectory.ca";
  const to = process.env.RESEND_TO || "info@gabrioladirectory.ca";
  if (!key) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing Stripe signature header");

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle events you care about
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;

        // Minimal fields you’ll likely want:
        const record = {
          eventType: event.type,
          sessionId: s.id,
          amount_total: s.amount_total,      // in cents
          currency: s.currency,
          email: s.customer_details?.email || s.customer_email || "",
          name: s.customer_details?.name || "",
          paid: s.payment_status === "paid",
          timestamp: new Date().toISOString(),
          metadata: s.metadata || {},
        };

        // Optional logging destinations
        await notifyGAS(record);
        await notifyEmail(
          "Gabriola Directory — Payment received",
          `<p>Checkout session completed.</p>
           <ul>
             <li><strong>Session:</strong> ${record.sessionId}</li>
             <li><strong>Email:</strong> ${record.email}</li>
             <li><strong>Name:</strong> ${record.name}</li>
             <li><strong>Total:</strong> ${(record.amount_total/100).toFixed(2)} ${record.currency?.toUpperCase()}</li>
           </ul>`
        );

        break;
      }

      // Add more handlers as needed:
      // case "payment_intent.succeeded": break;

      default:
        // No-op for other events (but acknowledge so Stripe stops retrying)
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    // If your own logic fails, still return 200 so Stripe doesn’t retry forever,
    // but log a 500-style message for Vercel logs
    console.error("Webhook handler error:", err);
    return res.status(200).json({ received: true, warn: "handler-error" });
  }
}
