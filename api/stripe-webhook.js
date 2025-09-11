// === /api/stripe-webhook.js ===============================================
// Vercel: keep the raw body for Stripe signature verification
export const config = {
  api: { bodyParser: false },
  runtime: "nodejs",
};

import Stripe from "stripe";

// ---- Env (set these in Vercel → Project → Settings → Environment Variables)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;         // sk_test_… or sk_live_…
const WEBHOOK_SECRET     = process.env.STRIPE_WEBHOOK_SECRET;     // whsec_… (TEST or LIVE to match the endpoint)
const GSHEETS_WEBHOOK_URL = process.env.GSHEETS_WEBHOOK_URL || ""; // optional

if (!STRIPE_SECRET_KEY) console.error("[webhook] Missing STRIPE_SECRET_KEY");
if (!WEBHOOK_SECRET)     console.error("[webhook] Missing STRIPE_WEBHOOK_SECRET");

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ---- small helper: read raw request body safely
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---- optional: log to Google Sheets Apps Script (fire-and-forget)
async function logToSheets(payload) {
  if (!GSHEETS_WEBHOOK_URL) return;
  try {
    await fetch(GSHEETS_WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // never throw from here
    console.warn("[webhook] Sheets logging failed (ignored):", e?.message || e);
  }
}

export default async function handler(req, res) {
  // CORS (optional; Stripe doesn’t need it, but harmless)
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Stripe-Signature, Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("[webhook] hit", new Date().toISOString());

  // 1) Read raw body for signature verification
  let buf;
  try {
    buf = await readRawBody(req);
  } catch (err) {
    console.error("[webhook] raw-body-error:", err?.message || err);
    return res.status(400).json({ error: "Cannot read body" });
  }

  // 2) Verify signature
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    console.error("[webhook] Missing stripe-signature header");
    return res.status(400).json({ error: "Missing signature" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] Signature verification FAILED:", err?.message || err);
    return res.status(400).json({ error: "Bad signature" });
  }

  console.log("[webhook] event:", event.type);

  // 3) Handle events you care about
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Minimal payload to log
        const payload = {
          type: event.type,
          id: session.id,
          amount_total: session.amount_total,
          currency: session.currency,
          customer_email: session.customer_details?.email || session.customer_email || "",
          payment_intent: session.payment_intent || "",
          timestamp: new Date().toISOString(),
        };

        console.log("[webhook] checkout.session.completed:", payload);

        // optional fire-and-forget log to Google Sheets
        logToSheets({ source: "stripe-webhook", ...payload });

        break;
      }

      // add more cases as needed:
      // case "payment_intent.succeeded": { … } break;

      default:
        // Unhandled events are fine — Stripe just needs 2xx back
        console.log("[webhook] unhandled:", event.type);
    }

    // Respond 200 so Stripe stops retrying
    return res.status(200).json({ received: true });
  } catch (err) {
    // Never 5xx for business logic — ack 200 so Stripe doesn’t retry endlessly
    console.error("[webhook] handler error (acknowledged):", err?.message || err);
    return res.status(200).json({ received: true });
  }
}
