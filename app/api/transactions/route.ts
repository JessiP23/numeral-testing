import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const state = searchParams.get("state");

  const where = state ? { billingState: state.toUpperCase() } : {};

  const [transactions, total, summary] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { processedAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({
      _sum: { amountCents: true, taxAmountCents: true },
      _count: { id: true },
    }),
  ]);

  return NextResponse.json({
    transactions,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: {
      totalRevenue: summary._sum.amountCents ?? 0,
      totalTax: summary._sum.taxAmountCents ?? 0,
      count: summary._count.id,
    },
  });
}
