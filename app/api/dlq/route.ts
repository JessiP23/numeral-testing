import { NextResponse } from "next/server";
import { transactionDLQ, transactionQueue } from "@/lib/queue";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const counts = await transactionDLQ.getJobCounts();
    const jobs = await transactionDLQ.getJobs(["failed"], 0, 50);

    const jobDetails = await Promise.all(
      jobs.map(async (job) => {
        const processed = await job.getState();
        return {
          id: job.id,
          name: job.name,
          data: job.data,
          failedReason: job.failedReason,
          processed,
          timestamp: job.timestamp,
        };
      })
    );

    return NextResponse.json({
      counts,
      jobs: jobDetails,
    });
  } catch (error) {
    logger.error({ error }, "Failed to fetch DLQ jobs");
    return NextResponse.json(
      { error: "Failed to fetch DLQ jobs" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { jobId } = await req.json();

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required" },
        { status: 400 }
      );
    }

    // Get the job from DLQ
    const dlqJob = await transactionDLQ.getJob(jobId);
    if (!dlqJob) {
      return NextResponse.json(
        { error: "Job not found in DLQ" },
        { status: 404 }
      );
    }

    const originalData = dlqJob.data.originalData;

    // Remove from DLQ
    await dlqJob.remove();

    // Re-queue to main transaction queue
    await transactionQueue.add(
      originalData.eventType,
      originalData,
      {
        jobId: originalData.eventId,
      }
    );

    logger.info({ jobId, originalEventId: originalData.eventId }, "Job retried from DLQ");

    return NextResponse.json({
      success: true,
      message: "Job re-queued for processing",
      originalEventId: originalData.eventId,
    });
  } catch (error) {
    logger.error({ error }, "Failed to retry DLQ job");
    return NextResponse.json(
      { error: "Failed to retry job" },
      { status: 500 }
    );
  }
}
