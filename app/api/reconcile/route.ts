import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST() {
  const run = await prisma.reconciliationRun.create({ data: { status: "RUNNING" } });

  // Fire-and-forget. The endpoint returns the runId so the client can poll.
  runReconciliation(run.id).catch(async (error) => {
    console.error("[reconcile] run failed", error);
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date() },
    });
  });

  return NextResponse.json({ runId: run.id, status: "RUNNING" });
}

async function runReconciliation(runId: string) {
  const stripeCharges: Stripe.Charge[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore && stripeCharges.length < 500) {
    const batch = await stripe.charges.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    stripeCharges.push(...batch.data);
    hasMore = batch.has_more;
    startingAfter = batch.data[batch.data.length - 1]?.id;
    if (!startingAfter) break;
  }

  const localTransactions = await prisma.transaction.findMany({
    select: { stripeChargeId: true, amountCents: true, id: true },
  });

  const localMap = new Map(localTransactions.map((t) => [t.stripeChargeId, t]));
  const stripeMap = new Map(stripeCharges.map((c) => [c.id, c]));

  type GapInput = {
    runId: string;
    gapType: "MISSING_IN_LOCAL" | "AMOUNT_MISMATCH" | "DUPLICATE";
    stripeChargeId: string;
    stripeAmount: number | null;
    localAmount: number | null;
    severity: "HIGH" | "MEDIUM" | "LOW";
    transactionId: string | null;
  };
  const gaps: GapInput[] = [];

  for (const charge of stripeCharges) {
    if (charge.status !== "succeeded") continue;
    const local = localMap.get(charge.id);

    if (!local) {
      gaps.push({
        runId,
        gapType: "MISSING_IN_LOCAL",
        stripeChargeId: charge.id,
        stripeAmount: charge.amount,
        localAmount: null,
        severity: charge.amount >= 10000 ? "HIGH" : "MEDIUM",
        transactionId: null,
      });
    } else if (local.amountCents !== charge.amount) {
      gaps.push({
        runId,
        gapType: "AMOUNT_MISMATCH",
        stripeChargeId: charge.id,
        stripeAmount: charge.amount,
        localAmount: local.amountCents,
        severity: "HIGH",
        transactionId: local.id,
      });
    }
  }

  for (const local of localTransactions) {
    if (!stripeMap.has(local.stripeChargeId)) {
      gaps.push({
        runId,
        gapType: "DUPLICATE",
        stripeChargeId: local.stripeChargeId,
        stripeAmount: null,
        localAmount: local.amountCents,
        severity: "MEDIUM",
        transactionId: local.id,
      });
    }
  }

  if (gaps.length > 0) {
    await prisma.reconciliationGap.createMany({ data: gaps });
  }

  await prisma.reconciliationRun.update({
    where: { id: runId },
    data: {
      status: "COMPLETE",
      totalStripe: stripeCharges.filter((c) => c.status === "succeeded").length,
      totalLocal: localTransactions.length,
      gapsFound: gaps.length,
      completedAt: new Date(),
    },
  });
}
