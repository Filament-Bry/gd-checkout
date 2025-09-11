// /api/stripe-webhook.js
// Minimal, production-safe Stripe webhook for Vercel (Node runtime).
// Verifies signature using the *raw* request body, then handles events.

export const config = { runtime: "nodejs" }; // Vercel Node (not Edge)

import Stripe from "stripe";
import getRawBody from "raw-body"; // add to package.json:  "raw-body": "^2.5.2"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

/** Optional: forward successful payments to Google Sheets (Apps Script) */
async function forwardToSheets(payload) {
  const url = process.env.GSHEETS_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("Apps Script forward failed:", e?.message || e);
  }
}

/** Optional: email a short receipt via Resend (only if RESEND_API_KEY set) */
async function emailReceipt({ subject, text }) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL || "info@gabrioladirectory.ca";
  const from = process.env.FROM_EMAIL || "noreply@gabrioladirectory.ca";
  if (!key) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
  } catch (e) {
    console.error("Resend email failed:", e?.message || e);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).end("Missing STRIPE_WEBHOOK_SECRET");

  let event;
  try {
    // IMPORTANT: use raw body for signature verification
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || "invalid signature"}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;

        // Basic details (Stripe amounts are in the smallest currency unit)
        const amount = s.amount_total ?? 0;
        const currency = (s.currency || "cad").toUpperCase();
        const email = s.customer_details?.email || s.customer_email || "";
        const meta = s.metadata || {};

        // Forward to Sheets (optional)
        await forwardToSheets({
          type: event.type,
          session_id: s.id,
          created_unix: s.created,
          amount_total: amount,
          currency,
          customer_email: email,
          businessName: meta.businessName || "",
          contactName: meta.contactName || "",
          phone: meta.phone || "",
          // add anything else you want to log…
        });

        // Email (optional)
        await emailReceipt({
          subject: `✅ Payment received — ${amount/100} ${currency}`,
          text:
`Payment received
Session: ${s.id}
Amount: ${(amount/100).toFixed(2)} ${currency}
Email: ${email}
Business: ${meta.businessName || "-"}
Contact: ${meta.contactName || "-"}
Phone: ${meta.phone || "-"}`
        });

        break;
      }

      // You can handle more events here if needed:
      // case "payment_intent.succeeded": …
      default:
        // No-op for other event types
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err?.message || err);
    return res.status(500).json({ error: "handler failure" });
  }
}
