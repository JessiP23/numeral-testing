import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transactionQueue } from "@/lib/queue";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const gap = await prisma.reconciliationGap.findUnique({ where: { id } });

  if (!gap || gap.gapType !== "MISSING_IN_LOCAL") {
    return NextResponse.json(
      { error: "Gap not retryable", gapType: gap?.gapType ?? null },
      { status: 400 }
    );
  }

  // Pull the original charge straight from Stripe and re-inject it into the
  // worker pipeline as a synthetic event. Same idempotency layers apply.
  const charge = await stripe.charges.retrieve(gap.stripeChargeId);
  const syntheticEventId = `retry_${gap.stripeChargeId}`;

  await prisma.webhookEvent.upsert({
    where: { id: syntheticEventId },
    update: {},
    create: {
      id: syntheticEventId,
      type: "charge.succeeded",
      status: "PENDING",
      rawPayload: charge as unknown as object,
      receivedAt: new Date(),
    },
  });

  await transactionQueue.add(
    "charge.succeeded",
    {
      eventId: syntheticEventId,
      eventType: "charge.succeeded",
      payload: charge,
    },
    { jobId: syntheticEventId }
  );

  return NextResponse.json({ queued: true, jobId: syntheticEventId, chargeId: gap.stripeChargeId });
}
