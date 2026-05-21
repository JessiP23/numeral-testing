import { Queue } from "bullmq";
import { redis } from "./redis";

export const transactionQueue = new Queue("transactions", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const reconciliationQueue = new Queue("reconciliation", {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 10 },
  },
});
