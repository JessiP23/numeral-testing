"use client";

import { useState, useEffect } from "react";

interface DLQJob {
  id: string;
  name: string;
  data: {
    originalJobId: string;
    originalData: {
      eventId: string;
      eventType: string;
      correlationId?: string;
    };
    failedAt: string;
    error: string;
    attemptsMade: number;
  };
  failedReason: string | null;
  timestamp: number;
}

interface DLQResponse {
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  jobs: DLQJob[];
}

export default function DeadLetterQueue() {
  const [dlqData, setDlqData] = useState<DLQResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetchDLQ = async () => {
    try {
      const res = await fetch("/api/dlq");
      if (res.ok) {
        const data = await res.json();
        setDlqData(data);
      }
    } catch (error) {
      console.error("Failed to fetch DLQ:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDLQ();
    const interval = setInterval(fetchDLQ, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const handleRetry = async (jobId: string) => {
    setRetrying(jobId);
    try {
      const res = await fetch("/api/dlq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (res.ok) {
        await fetchDLQ(); // Refresh after retry
      }
    } catch (error) {
      console.error("Failed to retry job:", error);
    } finally {
      setRetrying(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h2 className="text-xl font-bold text-white mb-4">Dead-Letter Queue</h2>
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  const failedCount = dlqData?.counts.failed ?? 0;

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">Dead-Letter Queue</h2>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            failedCount > 0 ? "bg-red-900/50 text-red-300" : "bg-green-900/50 text-green-300"
          }`}>
            {failedCount} Failed Jobs
          </span>
        </div>
      </div>

      {failedCount === 0 ? (
        <div className="text-gray-400 py-8 text-center">
          No failed jobs in queue
        </div>
      ) : (
        <div className="space-y-3">
          {dlqData?.jobs.map((job) => (
            <div
              key={job.id}
              className="bg-gray-800 rounded-lg p-4 border border-gray-700"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-mono text-gray-400">
                      {job.data.originalData.eventId}
                    </span>
                    <span className="text-xs text-gray-500">
                      {job.data.originalData.eventType}
                    </span>
                  </div>
                  <div className="text-sm text-red-400 mb-2">
                    {job.data.error}
                  </div>
                  <div className="text-xs text-gray-500">
                    Attempts: {job.data.attemptsMade} • Failed: {new Date(job.data.failedAt).toLocaleString()}
                  </div>
                  {job.data.originalData.correlationId && (
                    <div className="text-xs text-gray-500 mt-1">
                      Correlation ID: {job.data.originalData.correlationId}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleRetry(job.id)}
                  disabled={retrying === job.id}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {retrying === job.id ? "Retrying..." : "Retry"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
