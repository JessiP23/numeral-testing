# Numeral Compliance System - Architecture

## Overview

This is a production-grade Stripe-style compliance system demonstrating financial infrastructure patterns: webhook ingestion, idempotency, reconciliation, state machines, and operational observability. Designed for Numeral's backend/product engineering interview context.

## Core Design Principles

1. **Correctness over convenience** - Multi-layer idempotency, state machine enforcement, append-only audit logs
2. **Replayability** - Every event is persisted raw; can be re-processed from the audit trail
3. **Observability** - Structured logging with correlation IDs, dead-letter queues, health checks
4. **Operational resilience** - Chaos mode, gap detection, manual recovery paths
5. **Simplicity with rigor** - Clean domain models, minimal abstractions, explicit state transitions

## Architecture

```
┌─────────────────┐
│  Stripe Webhook │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js API Route (/api/webhooks/stripe)                   │
│  - Signature validation                                      │
│  - Generate correlation ID                                   │
│  - Persist to WebhookEvent (append-only audit log)           │
│  - Enqueue to BullMQ (transactionQueue)                      │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  BullMQ Queue (Redis)                                        │
│  - jobId dedupe (layer 1 idempotency)                        │
│  - Exponential backoff (3 attempts)                          │
│  - Failed jobs → Dead-Letter Queue                           │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Worker Process (transactionWorker.ts)                       │
│  - Redis SETNX idempotency (layer 2, 24h TTL)                │
│  - Normalize Stripe charge → domain model                    │
│  - State machine validation & transition recording           │
│  - DB unique constraint (layer 3)                            │
│  - Nexus exposure tracking                                   │
│  - Structured logging with correlation ID                     │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Postgres (Source of Truth)                                   │
│  - Transaction (with state transitions)                       │
│  - TransactionStateTransition (audit trail)                  │
│  - WebhookEvent (append-only raw payload)                    │
│  - NexusExposure (per-state tracking)                        │
│  - ReconciliationGap (Stripe vs local mismatches)            │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### Transaction State Machine

```
RECORDED (initial)
  ├─→ REFUNDED (charge refunded)
  ├─→ ADJUSTED (exemption applied)
  ├─→ FILED (tax filing submitted)
  ├─→ CLOSED (terminal)
REFUNDED
  └─→ CLOSED
ADJUSTED
  ├─→ FILED
  └─→ CLOSED
FILED
  ├─→ REMITTED (tax remitted)
  └─→ CLOSED
REMITTED
  └─→ CLOSED
DISPUTED
  ├─→ RECORDED
  ├─→ REFUNDED
  └─→ CLOSED
CLOSED (terminal)
```

Every state transition is recorded in `TransactionStateTransition` with:
- `fromStatus` / `toStatus`
- `reason` (e.g., "webhook_received", "refund_processed")
- `metadata` (correlation ID, event ID, etc.)
- `createdAt`

### Key Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `Transaction` | Domain model | `stripeChargeId` (unique), `status` (enum), `correlationId` |
| `TransactionStateTransition` | State audit trail | `transactionId`, `fromStatus`, `toStatus`, `reason` |
| `WebhookEvent` | Append-only audit log | `id` (event ID), `rawPayload` (immutable), `status` |
| `ReconciliationGap` | Stripe vs local mismatches | `gapType` (MISSING/AMOUNT_MISMATCH/DUPLICATE), `severity` |
| `NexusExposure` | Per-state tax nexus tracking | `stateCode`, `totalRevenueCents`, `thresholdStatus` |

## Idempotency Layers (Defense in Depth)

1. **BullMQ jobId** - Queue-level dedupe using `stripeEventId` as jobId
2. **Redis SETNX** - Worker-level dedupe with 24h TTL (`idempotency:${eventId}`)
3. **DB unique constraint** - `Transaction.stripeChargeId` unique index

If layer 1 fails, layer 2 catches it. If layer 2 fails, layer 3 catches it. This ensures exactly-once processing even under partial failures.

## Reconciliation

Periodic job compares Stripe source of truth vs local state:

```typescript
// app/api/reconcile/route.ts
- Fetch all Stripe charges (paginated)
- Fetch all local transactions
- Detect:
  - MISSING_IN_LOCAL: In Stripe, not in DB
  - AMOUNT_MISMATCH: Same ID, different amount
  - DUPLICATE: In DB, not in Stripe
- Record gaps in ReconciliationGap table
- UI shows gaps with Retry button for MISSING_IN_LOCAL
```

Retry flow:
1. Fetch charge from Stripe
2. Re-inject as synthetic event with same `eventId`
3. Idempotency layers allow re-processing
4. State transition recorded with reason "gap_retry"

## Observability

### Structured Logging

Using `pino` for structured JSON logs:

```typescript
// lib/logger.ts
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: isDevelopment ? { target: "pino-pretty" } : undefined,
});

export function withCorrelationId(correlationId: string) {
  return logger.child({ correlationId });
}
```

All logs include:
- `correlationId` (request-scoped, propagates through webhook → queue → worker)
- Structured context (event IDs, amounts, state transitions)
- Error details with stack traces

### Dead-Letter Queue

Failed jobs (after 3 retries) move to `transactions-dlq`:

```typescript
// workers/transactionWorker.ts
if (attemptsMade >= 3 && job) {
  await transactionDLQ.add(`dlq-${jobId}`, {
    originalJobId: jobId,
    originalData: job.data,
    failedAt: new Date().toISOString(),
    error,
    attemptsMade,
  });
}
```

DLQ features:
- API endpoint `/api/dlq` for inspection
- Retry button in UI to re-queue jobs
- Permanent retention for post-mortem analysis

### Health Checks

`/api/health` returns:
- DB connectivity
- Redis connectivity
- Queue status
- Chaos mode state
- Duplicates blocked count

## Chaos Mode

Simulates webhook drops for demonstration:

```typescript
// lib/chaos.ts
let chaosMode = false;

// In webhook handler:
if (isChaosMode() && Math.random() < 0.5) {
  // Drop webhook, mark as FAILED
  // Reconciliation will detect as MISSING_IN_LOCAL
  // Operator can retry via UI
}
```

Toggle via UI button or `/api/chaos` endpoint.

## Running the System

### Prerequisites

- Node.js 18+
- Postgres (Supabase or local)
- Redis (local or cloud)
- Stripe test keys

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with:
#   DATABASE_URL=postgres://...
#   REDIS_URL=redis://localhost:6379
#   STRIPE_SECRET_KEY=sk_test_...
#   STRIPE_WEBHOOK_SECRET=whsec_...

# Run migrations
pnpm exec prisma migrate dev

# Generate Prisma client
pnpm exec prisma generate
```

### Development

```bash
# Terminal 1: Start Next.js dev server
pnpm dev

# Terminal 2: Start worker process
pnpm worker

# Terminal 3 (optional): Stripe webhook forwarding
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

### Seeding Test Data

```bash
# Option 1: Via UI (click "Generate Test Data" button)
# Option 2: Via API
curl -X POST http://localhost:3000/api/seed

# Option 3: Direct Stripe sync (bypasses webhooks)
pnpm sync
```

### Reconciliation

```bash
# Trigger reconciliation job
curl -X POST http://localhost:3000/api/reconcile

# View results in dashboard Reconciliation panel
```

## Key Design Decisions

### Why State Machine?

- **Correctness**: Prevents invalid state transitions (e.g., can't go from CLOSED to RECORDED)
- **Auditability**: Every transition is recorded with reason and metadata
- **Extensibility**: Easy to add new states (FILED, REMITTED) for filing lifecycle
- **Numeral relevance**: Filing obligations are stateful; this demonstrates domain modeling

### Why Three-Layer Idempotency?

- **Defense in depth**: Each layer catches different failure modes
- **Performance**: Fast path (BullMQ) avoids DB round-trip for duplicates
- **Durability**: DB constraint is final backstop even if Redis is lost
- **Interview relevance**: Shows understanding of distributed systems challenges

### Why Append-Only Audit Log?

- **Replayability**: Can re-process any event from raw payload
- **Debugging**: Full context of what Stripe sent
- **Compliance**: Financial systems require immutable audit trails
- **Operational**: Can investigate discrepancies by comparing raw vs processed

### Why Dead-Letter Queue?

- **No data loss**: Failed jobs are preserved, not discarded
- **Operational visibility**: Can inspect why jobs failed
- **Manual recovery**: Retry button allows operator intervention
- **Post-mortem**: Keep failed jobs for analysis

### Why Correlation IDs?

- **Distributed tracing**: Follow a single request across webhook → queue → worker → DB
- **Debugging**: All logs for a request share the same ID
- **Customer support**: Can look up all operations for a specific webhook event

## Testing Strategy

### Manual Testing

1. **Idempotency**: Send same webhook twice → second blocked as DUPLICATE
2. **Chaos mode**: Enable chaos → 50% dropped → reconciliation shows gaps → retry recovers
3. **State transitions**: Create transaction → refund → verify state changes in DB
4. **Reconciliation**: Delete local transaction → run reconcile → gap detected → retry

### Automated Tests (TODO)

```bash
# Run tests (Vitest)
pnpm test

# Test coverage
pnpm test:coverage
```

Test areas:
- Idempotency layers (Redis, DB constraint)
- State machine validation
- Reconciliation gap detection
- Webhook signature verification
- DLQ retry flow

## Performance Considerations

- **Worker concurrency**: Set to 5 (configurable) to balance throughput vs DB load
- **Redis TTL**: 24h for idempotency keys (balance memory vs replay window)
- **Job retention**: Keep 100 completed, 50 failed in queue (balance memory vs debugging)
- **Pagination**: Stripe API and DB queries use pagination/limits
- **Indexes**: All foreign keys and query fields have indexes

## Security

- **Webhook signature**: Stripe signature validation before processing
- **Environment variables**: Secrets never committed to git
- **API routes**: No authentication in demo (would add in production)
- **SQL injection**: Prisma ORM prevents raw SQL injection

## Future Enhancements

1. **Filing lifecycle**: Add FILED → REMITTED states with due-date tracking
2. **Exemption certificates**: Intake flow for tax exemption documents
3. **Notice parser**: Unstructured tax notice → structured gap
4. **Metrics**: Prometheus/OpenTelemetry integration
5. **Alerting**: PagerDuty/Sentry integration for DLQ threshold
6. **Multi-tenant**: Merchant isolation at DB level
7. **Rate limiting**: Per-merchant webhook rate limits

## Interview Talking Points

### Systems Thinking

- Multi-layer idempotency for exactly-once semantics
- State machine for correctness and auditability
- Dead-letter queue for operational resilience
- Reconciliation for data integrity verification

### Correctness

- Append-only audit log (never modify raw payload)
- State transition validation prevents invalid states
- Unique constraints at DB level as final backstop
- Chaos mode demonstrates gap detection and recovery

### Observability

- Correlation IDs for distributed tracing
- Structured logging with pino
- Health checks for infra status
- DLQ for failure visibility

### Maintainability

- Clean domain models (no generic CRUD)
- Explicit state transitions (no magic strings)
- Reusable components (StatusBadge, MetricCard)
- Clear separation of concerns (API, worker, UI)

## Troubleshooting

### Worker not processing events

1. Check worker logs: `pnpm worker`
2. Verify Redis connection: `redis-cli ping`
3. Check queue status: `/api/health`
4. Verify BullMQ jobId matches event ID

### Reconciliation shows gaps

1. Check if chaos mode is enabled
2. Verify Stripe webhook forwarding is running
3. Check WebhookEvent table for FAILED status
4. Use Retry button for MISSING_IN_LOCAL gaps

### TypeScript errors about TransactionStatus

1. Run `pnpm exec prisma generate`
2. Restart TypeScript server in IDE
3. Verify migration was applied: `pnpm exec prisma migrate status`

## License

MIT - For interview demonstration purposes.
