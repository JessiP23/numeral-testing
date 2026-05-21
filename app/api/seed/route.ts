import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const TEST_CUSTOMERS = [
  { email: "alice@acme.com", state: "CA", city: "San Francisco", zip: "94105" },
  { email: "bob@techco.com", state: "NY", city: "New York", zip: "10001" },
  { email: "carol@startup.io", state: "TX", city: "Austin", zip: "78701" },
  { email: "dave@ecomm.shop", state: "WA", city: "Seattle", zip: "98101" },
  { email: "eve@saas.co", state: "FL", city: "Miami", zip: "33101" },
  { email: "frank@platform.io", state: "IL", city: "Chicago", zip: "60601" },
  { email: "grace@digital.co", state: "MA", city: "Boston", zip: "02101" },
  { email: "henry@media.com", state: "CO", city: "Denver", zip: "80201" },
  // Repeat NY to push that state's nexus exposure
  { email: "alice@acme.com", state: "NY", city: "New York", zip: "10001" },
  { email: "ivan@corp.com", state: "TN", city: "Nashville", zip: "37201" },
];

export async function POST() {
  const results: Array<{ id?: string; status?: string; error?: string }> = [];

  for (const customer of TEST_CUSTOMERS) {
    try {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" },
        billing_details: {
          email: customer.email,
          address: {
            city: customer.city,
            state: customer.state,
            postal_code: customer.zip,
            country: "US",
          },
        },
      });

      const pi = await stripe.paymentIntents.create({
        amount: Math.floor(Math.random() * 50000) + 5000, // $50 - $550
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        return_url: "http://localhost:3000",
      });

      results.push({ id: pi.id, status: pi.status });
    } catch (error) {
      results.push({ error: error instanceof Error ? error.message : "failed" });
    }
  }

  return NextResponse.json({ seeded: results.length, results });
}
