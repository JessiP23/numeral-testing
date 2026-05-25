import { Queue } from "bullmq";
import { redis } from "./redis";

export const transactionQueue = new Queue("transactions", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 0 }, // Keep failed jobs for DLQ inspection
  },
});

// Dead-letter queue for failed transaction jobs
export const transactionDLQ = new Queue("transactions-dlq", {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 0 }, // Keep permanently for inspection
  },
});

export const reconciliationQueue = new Queue("reconciliation", {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 10 },
  },
});
