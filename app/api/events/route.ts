import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [events, stats] = await Promise.all([
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
    prisma.webhookEvent.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
  ]);

  return NextResponse.json({ events, stats });
}
