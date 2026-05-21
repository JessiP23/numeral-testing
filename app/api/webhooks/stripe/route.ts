import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { transactionQueue } from "@/lib/queue";
import { isChaosMode } from "@/lib/chaos";
import type Stripe from "stripe";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_EVENTS = new Set(["charge.succeeded", "charge.refunded"]);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid signature", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  // Audit log: persist raw event before processing. This row is the
  // append-only audit trail — the rawPayload is never modified after this
  // write, only the status field is updated by the worker.
  await prisma.webhookEvent.upsert({
    where: { id: event.id },
    update: {},
    create: {
      id: event.id,
      type: event.type,
      status: "PENDING",
      rawPayload: event as unknown as object,
      receivedAt: new Date(),
    },
  });

  // CHAOS MODE: simulate webhook drops. Return 200 (so Stripe doesn't retry
  // immediately) and silently fail to enqueue. The reconciliation job will
  // catch the gap as MISSING_IN_LOCAL — the operational story.
  if (isChaosMode() && SUPPORTED_EVENTS.has(event.type) && Math.random() < 0.5) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        errorMessage: "[CHAOS MODE] Event dropped intentionally",
      },
    });
    return NextResponse.json({ received: true, chaosDropped: true });
  }

  if (SUPPORTED_EVENTS.has(event.type)) {
    await transactionQueue.add(
      event.type,
      {
        eventId: event.id,
        eventType: event.type,
        payload: event.data.object,
      },
      { jobId: event.id } // BullMQ-level dedupe; second layer below DB unique constraint.
    );
  } else {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "DUPLICATE" }, // reused as "not actionable"
    });
  }

  return NextResponse.json({ received: true });
}
