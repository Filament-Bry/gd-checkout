// /api/stripe-webhook.js
export const config = { api: { bodyParser: false }, runtime: "nodejs" };

import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Optional: Google Apps Script to log paid orders
const GSHEETS_WEBHOOK_URL = process.env.GSHEETS_WEBHOOK_URL || "";

// Optional: email via Resend (super simple). Leave blank to skip.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "no-reply@gabrioladirectory.ca";
const RESEND_TO = process.env.RESEND_TO || "info@gabrioladirectory.ca";

// ---- helpers ----
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on("data", (c) => data.push(c));
    req.on("end", () => resolve(Buffer.concat(data)));
    req.on("error", reject);
  });
}

async function notifyOwner(subject, html) {
  if (!RESEND_API_KEY) return; // email disabled
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [RESEND_TO],
        subject,
        html,
      }),
    });
    await r.text(); // best-effort
  } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).end("Missing STRIPE_WEBHOOK_SECRET");

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("⚠️  Webhook signature verify failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // We care about the completed Checkout
    if (event.type === "checkout.session.completed") {
      const session = event.data.object; // https://stripe.com/docs/api/checkout/sessions/object
      const amount = (session.amount_total ?? 0) / 100;
      const currency = (session.currency || "cad").toUpperCase();
      const email = session.customer_details?.email || session.customer_email || "";
      const meta = session.metadata || {};

      // Log → Google Sheets (optional)
      if (GSHEETS_WEBHOOK_URL) {
        const payload = {
          event: event.type,
          timestamp: new Date().toISOString(),
          email,
          amount,
          currency,
          payment_status: session.payment_status,
          checkout_id: session.id,
          businessName: meta.businessName || "",
          contactName: meta.contactName || "",
          phone: meta.phone || "",
        };
        try {
          const j = JSON.stringify(payload);
          // Try sendBeacon-like POST (text/plain), fallback to urlencoded
          try {
            await fetch(GSHEETS_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: j,
            });
          } catch {
            await fetch(GSHEETS_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ payload: j }),
            });
          }
        } catch (e) {
          console.error("Sheets log failed:", e?.message);
        }
      }

      // Email owner (optional)
      await notifyOwner(
        "✅ Gabriola Directory – Payment received",
        `
        <p>A payment was completed.</p>
        <ul>
          <li><strong>Amount:</strong> ${amount.toLocaleString(undefined,{maximumFractionDigits:2})} ${currency}</li>
          <li><strong>Email:</strong> ${email || "(none)"} </li>
          <li><strong>Status:</strong> ${session.payment_status}</li>
          <li><strong>Checkout ID:</strong> ${session.id}</li>
          <li><strong>Business:</strong> ${meta.businessName || ""}</li>
          <li><strong>Contact:</strong> ${meta.contactName || ""}</li>
          <li><strong>Phone:</strong> ${meta.phone || ""}</li>
        </ul>
        `
      );
    }

    // Always 200 quickly so Stripe doesn't retry
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handling error:", err);
    res.status(200).json({ received: true }); // still 200 to avoid noisy retries
  }
}
