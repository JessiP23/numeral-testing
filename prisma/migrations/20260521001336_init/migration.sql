-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "stripeChargeId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL DEFAULT 'demo-merchant',
    "customerEmail" TEXT,
    "billingCity" TEXT,
    "billingState" TEXT,
    "billingZip" TEXT,
    "billingCountry" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "taxAmountCents" INTEGER NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jurisdictionState" TEXT,
    "jurisdictionName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeCreatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationGap" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "gapType" TEXT NOT NULL,
    "stripeChargeId" TEXT NOT NULL,
    "stripeAmount" INTEGER,
    "localAmount" INTEGER,
    "severity" TEXT NOT NULL DEFAULT 'HIGH',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionId" TEXT,

    CONSTRAINT "ReconciliationGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "totalStripe" INTEGER NOT NULL DEFAULT 0,
    "totalLocal" INTEGER NOT NULL DEFAULT 0,
    "gapsFound" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NexusExposure" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL DEFAULT 'demo-merchant',
    "stateCode" TEXT NOT NULL,
    "stateName" TEXT NOT NULL,
    "totalRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "revenueThreshold" INTEGER NOT NULL DEFAULT 10000000,
    "txThreshold" INTEGER NOT NULL DEFAULT 200,
    "thresholdStatus" TEXT NOT NULL DEFAULT 'SAFE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NexusExposure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rawPayload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_stripeEventId_key" ON "Transaction"("stripeEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_stripeChargeId_key" ON "Transaction"("stripeChargeId");

-- CreateIndex
CREATE INDEX "Transaction_billingState_idx" ON "Transaction"("billingState");

-- CreateIndex
CREATE INDEX "Transaction_processedAt_idx" ON "Transaction"("processedAt");

-- CreateIndex
CREATE INDEX "Transaction_stripeChargeId_idx" ON "Transaction"("stripeChargeId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationGap_runId_idx" ON "ReconciliationGap"("runId");

-- CreateIndex
CREATE INDEX "ReconciliationGap_gapType_idx" ON "ReconciliationGap"("gapType");

-- CreateIndex
CREATE INDEX "NexusExposure_thresholdStatus_idx" ON "NexusExposure"("thresholdStatus");

-- CreateIndex
CREATE UNIQUE INDEX "NexusExposure_merchantId_stateCode_key" ON "NexusExposure"("merchantId", "stateCode");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "WebhookEvent_type_idx" ON "WebhookEvent"("type");

-- AddForeignKey
ALTER TABLE "ReconciliationGap" ADD CONSTRAINT "ReconciliationGap_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
