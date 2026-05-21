import { prisma } from "@/lib/prisma";
import DashboardClient from "@/components/DashboardClient";
import { NEXUS_THRESHOLDS } from "@/lib/jurisdictions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  let payload;
  try {
    const [transactions, nexus, gaps, events, latestRun, summary] = await Promise.all([
      prisma.transaction.findMany({ orderBy: { processedAt: "desc" }, take: 50 }),
      prisma.nexusExposure.findMany({ orderBy: { totalRevenueCents: "desc" } }),
      prisma.reconciliationGap.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          transaction: { select: { billingState: true, customerEmail: true } },
        },
      }),
      prisma.webhookEvent.findMany({
        orderBy: { receivedAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          status: true,
          errorMessage: true,
          receivedAt: true,
          processedAt: true,
        },
      }),
      prisma.reconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
      prisma.transaction.aggregate({
        _sum: { amountCents: true, taxAmountCents: true },
        _count: { id: true },
      }),
    ]);

    const enrichedNexus = nexus.map((e) => ({
      ...e,
      revenuePercent: (e.totalRevenueCents / NEXUS_THRESHOLDS.revenueCents) * 100,
      txPercent: (e.transactionCount / NEXUS_THRESHOLDS.transactions) * 100,
    }));

    payload = {
      transactions,
      nexus: enrichedNexus,
      gaps,
      events,
      latestRun,
      summary: {
        totalRevenue: summary._sum.amountCents ?? 0,
        totalTax: summary._sum.taxAmountCents ?? 0,
        count: summary._count.id,
      },
      dbError: null as string | null,
    };
  } catch (error) {
    payload = {
      transactions: [],
      nexus: [],
      gaps: [],
      events: [],
      latestRun: null,
      summary: { totalRevenue: 0, totalTax: 0, count: 0 },
      dbError: error instanceof Error ? error.message : "Database unreachable",
    };
  }

  return <DashboardClient {...payload} />;
}
