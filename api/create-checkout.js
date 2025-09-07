// api/create-checkout.js
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
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
      success_url: "https://gabrioladir.carrd.co/thank-you",
      cancel_url: "https://gabrioladir.carrd.co/payment-cancelled",
      metadata: {
        businessName: businessName || "",
        contactName: contactName || "",
        phone: phone || ""
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};