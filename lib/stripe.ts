import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  // Permit lazy-loading at build time; runtime calls will throw if unset.
  console.warn("[stripe] STRIPE_SECRET_KEY is not set");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder");
