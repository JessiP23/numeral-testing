import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint: pipe an arbitrary POST body + Stripe-Signature header
 * through `stripe.webhooks.constructEvent`. Returns valid:true if the HMAC
 * matches the configured STRIPE_WEBHOOK_SECRET, valid:false otherwise.
 *
 * Lets you demo signature validation without forging a full Stripe payload —
 * just hit it with curl from the demo machine.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  if (!secret) {
    return NextResponse.json(
      { valid: false, reason: "STRIPE_WEBHOOK_SECRET not configured" },
      { status: 500 }
    );
  }

  try {
    const event = stripe.webhooks.constructEvent(body, sig, secret);
    return NextResponse.json({ valid: true, eventId: event.id, eventType: event.type });
  } catch (err) {
    return NextResponse.json(
      { valid: false, reason: err instanceof Error ? err.message : "unknown" },
      { status: 400 }
    );
  }
}
