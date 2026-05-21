import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NEXUS_THRESHOLDS } from "@/lib/jurisdictions";

export const dynamic = "force-dynamic";

export async function GET() {
  const exposures = await prisma.nexusExposure.findMany({
    orderBy: { totalRevenueCents: "desc" },
  });

  const enriched = exposures.map((e) => ({
    ...e,
    revenuePercent: (e.totalRevenueCents / NEXUS_THRESHOLDS.revenueCents) * 100,
    txPercent: (e.transactionCount / NEXUS_THRESHOLDS.transactions) * 100,
  }));

  return NextResponse.json({ exposures: enriched, thresholds: NEXUS_THRESHOLDS });
}
