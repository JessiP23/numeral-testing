import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [gaps, latestRun] = await Promise.all([
    prisma.reconciliationGap.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        transaction: { select: { billingState: true, customerEmail: true } },
      },
    }),
    prisma.reconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  return NextResponse.json({ gaps, latestRun });
}
