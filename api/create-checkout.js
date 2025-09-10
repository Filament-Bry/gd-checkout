// /api/create-checkout.js  (Vercel serverless function)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// allow these origins
const ALLOWED = new Set([
  'https://gabedir.carrd.co',
  'https://www.gabrioladirectory.ca',
  'https://gabrioladirectory.ca',
	'http://www.gabrioladirectory.ca',
  'http://gabrioladirectory.ca',
]);

function corsHeaders(origin) {
  const allow = ALLOWED.has(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(200).set(headers).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).set(headers).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { amount_cents, currency, email, description, businessName, contactName, phone } = req.body || {};

    // TODO: validate inputs here

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency: currency || 'cad',
          product_data: {
            name: description || 'Gabriola Directory — Listings & Ads',
            metadata: { businessName, contactName, phone },
          },
          unit_amount: amount_cents,
        },
        quantity: 1,
      }],
      success_url: 'https://gabedir.carrd.co/?paid=1',
      cancel_url:  'https://gabedir.carrd.co/?canceled=1',
    });

    res.status(200).set(headers).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).set(headers).json({ error: String(err?.message || err) });
  }
}
