import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const latestRun = await prisma.reconciliationRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  return NextResponse.json({ latestRun });
}
