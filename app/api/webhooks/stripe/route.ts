import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { transactionQueue } from "@/lib/queue";
import { isChaosMode } from "@/lib/chaos";
import { logger, withCorrelationId } from "@/lib/logger";
import type Stripe from "stripe";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_EVENTS = new Set(["charge.succeeded", "charge.refunded"]);

// Generate a correlation ID for distributed tracing
function generateCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  const correlationId = generateCorrelationId();
  const log = withCorrelationId(correlationId);

  log.info({ signaturePresent: !!signature }, "Webhook received");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    log.info({ eventId: event.id, eventType: event.type }, "Signature verified");
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "Signature verification failed");
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

  log.info({ eventId: event.id }, "Event persisted to audit log");

  // CHAOS MODE: simulate webhook drops. Return 200 (so Stripe doesn't retry
  // immediately) and silently fail to enqueue. The reconciliation job will
  // catch the gap as MISSING_IN_LOCAL — the operational story.
  if (isChaosMode() && SUPPORTED_EVENTS.has(event.type) && Math.random() < 0.5) {
    log.warn({ eventId: event.id }, "Chaos mode: dropping webhook");
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        errorMessage: "[CHAOS MODE] Event dropped intentionally",
      },
    });
    return NextResponse.json({ received: true, chaosDropped: true, correlationId });
  }

  if (SUPPORTED_EVENTS.has(event.type)) {
    await transactionQueue.add(
      event.type,
      {
        eventId: event.id,
        eventType: event.type,
        payload: event.data.object,
        correlationId,
      },
      { jobId: event.id } // BullMQ-level dedupe; second layer below DB unique constraint.
    );
    log.info({ eventId: event.id, eventType: event.type }, "Event enqueued for processing");
  } else {
    log.info({ eventId: event.id, eventType: event.type }, "Unsupported event type, skipping");
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "DUPLICATE" }, // reused as "not actionable"
    });
  }

  return NextResponse.json({ received: true, correlationId });
}
