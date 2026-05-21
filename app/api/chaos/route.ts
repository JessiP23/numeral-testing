import { NextResponse } from "next/server";
import { isChaosMode, toggleChaosMode } from "@/lib/chaos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ chaosMode: isChaosMode() });
}

export async function POST() {
  return NextResponse.json({ chaosMode: toggleChaosMode() });
}
