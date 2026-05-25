/*
  Warnings:

  - The `status` column on the `Transaction` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('RECORDED', 'REFUNDED', 'ADJUSTED', 'FILED', 'REMITTED', 'DISPUTED', 'CLOSED');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "correlationId" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'RECORDED';

-- CreateTable
CREATE TABLE "TransactionStateTransition" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fromStatus" "TransactionStatus",
    "toStatus" "TransactionStatus" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionStateTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionStateTransition_transactionId_idx" ON "TransactionStateTransition"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionStateTransition_createdAt_idx" ON "TransactionStateTransition"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_correlationId_idx" ON "Transaction"("correlationId");

-- AddForeignKey
ALTER TABLE "TransactionStateTransition" ADD CONSTRAINT "TransactionStateTransition_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
