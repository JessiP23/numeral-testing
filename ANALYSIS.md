# Numeral Compliance Inspector — Architecture & Operations Analysis

This document explains every moving part of the system, how data flows end-to-end, why the dashboard was empty in your last session, how to verify each layer is healthy, and how idempotency works.

---

## TL;DR — Why your dashboard was empty

You had **only `pnpm dev` running**. The pipeline needs **three** processes running simultaneously:

| Terminal | Command                                                        | What it does                                                            |
| -------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1        | `pnpm dev`                                                     | Next.js app — serves the dashboard, accepts webhooks, exposes `/api/*`. |
| 2        | `pnpm worker`                                                  | BullMQ worker — drains the queue and writes transactions to Postgres.   |
| 3        | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` | Stripe CLI tunnel — forwards real Stripe webhooks to your localhost.   |

Without (2) and (3), this is exactly what happens:

1. You click **Generate Test Data**.
2. `/api/seed` calls Stripe, creating real test charges (this is why your Stripe dashboard shows numbers going up — that part works).
3. Stripe tries to deliver webhooks for those charges.
4. **No `stripe listen` running → webhooks never reach your localhost.**
5. `/api/webhooks/stripe` is never invoked.
6. Nothing is enqueued, nothing is written to Postgres, dashboard stays empty.

**No AI / Groq key is required** for any of this. The seed uses Stripe's built-in test card token (`tok_visa`) directly. The only third-party API you need is Stripe in test mode.

---

## How to verify each layer (in order)

The new **system status row** at the top of the dashboard (and `GET /api/health`) gives you a live view of all four. Open the dashboard and watch the dots — if any are red, that's where the pipeline is broken.

### 1. Postgres is reachable and migrated

```bash
# Is the container up?
docker ps --filter name=postgres-numeral

# Can psql connect?
docker exec -it postgres-numeral psql -U postgres -d compliance -c "\dt"
# You should see: Transaction, IdempotencyKey, ReconciliationGap,
# ReconciliationRun, NexusExposure, WebhookEvent, _prisma_migrations
```

Also via Prisma:

```bash
pnpm db:studio        # opens Prisma Studio at http://localhost:5555
# or
pnpm exec prisma migrate status
```

Or hit the new health endpoint:

```bash
curl -s http://localhost:3000/api/health | jq .db
# { "ok": true, "latencyMs": 4 }
```

> **Note:** Your local machine already has a host Postgres on port `5432`, so the Docker container is mapped to **`5433`**. The `.env` files reflect this. If you ever swap to host Postgres directly, update `DATABASE_URL`.

### 2. Redis is reachable

```bash
redis-cli -h 127.0.0.1 -p 6379 PING        # → PONG
redis-cli KEYS 'bull:transactions:*' | head # job/queue keys
redis-cli KEYS 'idempotency:*'      | head  # SETNX dedupe keys
```

Health endpoint:

```bash
curl -s http://localhost:3000/api/health | jq .redis
# { "ok": true, "latencyMs": 1 }
```

### 3. Worker is alive and consuming

The dashboard's **Queue** dot shows `waiting / active / failed` counts. With no worker, you'll see `waiting` keep climbing as jobs queue up.

```bash
curl -s http://localhost:3000/api/health | jq .queue
# { "ok": true, "waiting": 0, "active": 0, "failed": 0, "hasWorker": true }
```

In the worker terminal you should see lines like:

```
Transaction worker running...
[worker] job evt_1ABC... completed: { transactionId: '...' }
```

If you see no log line per job after seeding, the worker isn't connected to the same Redis the app uses (check `REDIS_URL`).

### 4. Stripe webhook tunnel is forwarding

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# → Ready! Your webhook signing secret is whsec_XXXXXXXX (use this in .env.local)
```

Two important things:

- **Copy that `whsec_...` into `.env.local`** as `STRIPE_WEBHOOK_SECRET`, then restart `pnpm dev`. The signing secret is what `stripe.webhooks.constructEvent()` uses to verify the request — if it's wrong, `/api/webhooks/stripe` returns `400 Invalid signature` and nothing gets recorded.
- The Stripe CLI prints each delivery: `2026-... [200] POST http://localhost:3000/api/webhooks/stripe [evt_...]`. If you don't see those lines after clicking Generate Test Data, no webhook is being delivered.

The system-status **Stripe** dot is green only when both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set to non-placeholder values.

---

## The end-to-end pipeline (annotated)

```
+--------------------+
|  Browser button:   |
|  "Generate Test    |
|   Data"            |
+----------+---------+
           |  fetch POST /api/seed
           v
+--------------------+        +--------------------+
| /api/seed          | -----> | Stripe API         |  10x charges
|  (creates 10 PIs)  |        | (test mode)        |  using tok_visa
+--------------------+        +---------+----------+
                                        |
                                        |  Stripe enqueues outbound
                                        |  webhook deliveries
                                        v
                              +--------------------+
                              | stripe listen      |
                              | (Stripe CLI on     |
                              |  your machine)     |
                              +---------+----------+
                                        |  HTTPS POST → localhost:3000
                                        v
+----------------------------------------+
| /api/webhooks/stripe (Next.js route)   |
|  1) verify signature with whsec_       |
|  2) prisma.webhookEvent.upsert(...)    |  ←  raw audit log
|  3) transactionQueue.add(             |
|       jobId: event.id     <- dedupe layer 1 (BullMQ)
|     )                                  |
|  4) return 200 (always fast)           |
+--------+-------------------------------+
         |  enqueue
         v
+----------------------------------------+
| BullMQ in Redis ('transactions' queue) |
+--------+-------------------------------+
         |
         v
+----------------------------------------+
| workers/transactionWorker.ts           |
|                                        |
|  Layer 1: Redis SETNX                  |
|    SET idempotency:<eventId> NX EX 86400
|    -> if already set: status=DUPLICATE, return
|                                        |
|  Layer 2: Prisma upsert on             |
|     stripeChargeId (UNIQUE)            |
|     -> double safety in case Redis is  |
|        flushed between attempts        |
|                                        |
|  Side-effects:                         |
|    - normalize Stripe → Numeral schema |
|    - calculateTax(amount, state)       |
|    - upsertNexusExposure(state, amount)|
|    - mark webhookEvent PROCESSED       |
+--------+-------------------------------+
         |
         v
+----------------------------------------+
| Postgres                               |
|   Transaction, NexusExposure,          |
|   WebhookEvent, ReconciliationRun,     |
|   ReconciliationGap                    |
+--------+-------------------------------+
         |
         |  server-side render via prisma
         v
+----------------------------------------+
| /dashboard (Server Component)          |
|   reads all 5 tables in parallel,      |
|   passes to <DashboardClient/>         |
+--------+-------------------------------+
         |
         |  router.refresh() every 3s
         |  (auto-refresh toggle)
         v
+--------------------+
|  UI updates        |
|  near real-time    |
+--------------------+
```

---

## Real-time update strategy

This build polls the server component every 3 seconds via `router.refresh()`. That's a deliberate choice over websockets/SSE because:

1. The data is naturally bursty (a few transactions per click), not high-frequency.
2. `router.refresh()` re-renders the **server component** with fresh DB queries — no manual cache invalidation logic.
3. Polling at 3s keeps p95 latency from "webhook lands" to "UI shows it" under ~5s, which matches what an internal ops tool wants.

If you want stricter real-time, the upgrade path is:

- Add `revalidateTag(...)` calls in the worker after each `Transaction.upsert` and use `unstable_cache` on the page reads. (Pull model → push model.)
- Or stand up an SSE endpoint at `/api/stream` that pipes Postgres `LISTEN/NOTIFY` events to the browser.

The auto-refresh toggle in the header lets you turn polling off for debugging.

---

## Idempotency — three layers, why each one matters

You asked: "do I need to implement idempotency?" — **already implemented, three deep**:

| Layer | Where                                                  | Mechanism                                                                                        | What it catches                                                              |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1     | `app/api/webhooks/stripe/route.ts`                     | `transactionQueue.add(..., { jobId: event.id })` — BullMQ refuses to enqueue a duplicate jobId. | Stripe redelivering the same `evt_*` because we returned slowly the first time. |
| 2     | `workers/transactionWorker.ts`                         | `redis.set("idempotency:<eventId>", "1", "EX", 86400, "NX")`                                     | A retry that *did* re-enter the worker (e.g. after a worker crash mid-job). |
| 3     | `prisma/schema.prisma` — `Transaction.stripeChargeId @unique` | DB-level unique constraint, paired with `prisma.transaction.upsert` keyed on `stripeChargeId`. | Backstop in case Redis is flushed/wiped between layers 1 and 2.             |

**Why three?** Each layer has a different failure mode:

- BullMQ jobIds are ephemeral — once a job completes and is removed (we set `removeOnComplete: { count: 100 }`), the same jobId can be enqueued again.
- Redis SETNX has a 24h TTL and can be lost on a Redis restart.
- The DB unique constraint is permanent but only kicks in *after* you've already done the (cheap) work of normalizing the charge — it's the slowest of the three but the only one that survives total infrastructure loss.

This is the same pattern Numeral has to use internally: every Stripe webhook can arrive 1+ times, and the cost of double-recording a transaction is double-filing taxes (real legal liability), so you defend in depth.

---

## What "Generate Test Data" actually does

```ts
// app/api/seed/route.ts
for (const customer of TEST_CUSTOMERS) {
  // 1. create a PaymentMethod with a test address
  const pm = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },          // Stripe's built-in always-succeed test card
    billing_details: { email, address: { city, state, postal_code, country: "US" } },
  });
  // 2. create + confirm a PaymentIntent in one call
  const pi = await stripe.paymentIntents.create({
    amount: random($50…$550 in cents),
    currency: "usd",
    payment_method: pm.id,
    confirm: true,
    return_url: "http://localhost:3000",
  });
}
```

There are 10 customers, 8 unique states, with `alice@acme.com / NY` repeated to push New York's nexus exposure faster. Confirming a PaymentIntent in test mode causes Stripe to fire `charge.succeeded` — which (if your `stripe listen` tunnel is open) lands at `/api/webhooks/stripe`.

---

## What the dashboard is really showing you

| Section                | Source                                                                                   | What it proves                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Metric cards           | `prisma.transaction.aggregate` + `reconciliationGap.count`                              | The DB has data and aggregations are correct.                                                            |
| Transaction Timeline   | `prisma.transaction` last 50, ordered by `processedAt`                                  | Normalization, jurisdiction lookup, and tax math worked.                                                 |
| Reconciliation Panel   | `prisma.reconciliationRun` + `reconciliationGap` (open only)                            | Gap detection between Stripe ledger and local DB.                                                        |
| Nexus Tracker          | `prisma.nexusExposure` per state, with revenue% and txCount% bars                       | The worker is correctly aggregating per state and threshold logic (`SAFE`/`WARNING`/`EXCEEDED`) is firing. |
| Event Log              | `prisma.webhookEvent` last 50                                                            | Webhook ingestion contract — every event is logged before it's processed, with status transitions visible. |
| **System Status row**  | `GET /api/health` — pings Postgres, Redis, queue counts, env config                     | All four infra dependencies are alive.                                                                   |

When you demo this, the **Event Log** is the most important section to look at first — it's where invisible failures (webhook retries, signature mismatches, worker crashes) become visible.

---

## What I changed in this session vs. the original spec

1. **Removed `export const config = { api: { bodyParser: false } }`** from the webhook route. That syntax is Pages Router; in App Router, route handlers receive raw bodies via `await req.text()`, which is what the implementation already does.
2. **Pinned Prisma to `^6.19.3`**. Prisma 7 requires Node `>= 20.19`; you're on `20.18.0`. Either upgrade Node or stay on Prisma 6 — the schema is identical.
3. **Used `pnpm`** (your repo has `pnpm-workspace.yaml` and `pnpm-lock.yaml`) and added a `pnpm.onlyBuiltDependencies` allowlist so Prisma engines compile without the interactive prompt.
4. **Postgres mapped to host port `5433`**, not `5432`. You already have a host postgres on `5432`. The Docker container is on `5433` and `.env`/`.env.local` reflect this.
5. **Added `/api/health`** plus a live `<SystemStatus />` component in the dashboard header. Each dependency is pingable from the UI without leaving the dashboard.
6. **Added auto-refresh (`router.refresh()` every 3s)** with a toggle in the header so the dashboard reflects new data as the worker writes it.
7. **Surfaced seed errors to the UI** — clicking Generate Test Data now shows whether Stripe accepted the charges and reminds you that the webhook flow needs `stripe listen`.
8. **`/` redirects to `/dashboard`** — the Next.js boilerplate landing page is gone.

---

## Step-by-step recovery from your current state

1. **Open three terminals** in `~/compliance`.

2. **Terminal 1 — app:**
   ```bash
   pnpm dev
   ```

3. **Terminal 2 — worker:**
   ```bash
   pnpm worker
   ```
   You should see `Transaction worker running...` and nothing else until jobs arrive.

4. **Terminal 3 — Stripe CLI:**
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Copy the printed `whsec_...` into `.env.local`:
   ```env
   STRIPE_WEBHOOK_SECRET="whsec_THE_VALUE_IT_PRINTED"
   ```

5. **Set your Stripe secret key** in `.env.local`:
   ```env
   STRIPE_SECRET_KEY="sk_test_..."   # from dashboard.stripe.com → Developers → API keys
   ```

6. **Restart Terminal 1** (`pnpm dev`) so it picks up the new `.env.local` values.

7. **Open <http://localhost:3000>** — the system-status row at the top should show four green dots: Postgres, Redis, Queue, Stripe.

8. **Click Generate Test Data.** Within ~1 second you should see:
   - Terminal 3 (Stripe CLI) printing 10x `[200] POST .../api/webhooks/stripe [evt_...]`
   - Terminal 2 (worker) printing 10x `[worker] job evt_... completed`
   - The dashboard auto-refreshing within 3s, showing transactions, nexus bars, and event log entries

9. **Click Run Reconciliation.** It will list ~10 charges in Stripe vs local, find 0 gaps. If you stop the worker, seed again, and rerun, you'll get `MISSING_IN_LOCAL` rows — that's the system catching a webhook drop.

---

## "How do I test the database connects?"

Three ways, in increasing order of integration:

1. **Direct psql:**
   ```bash
   docker exec -it postgres-numeral psql -U postgres -d compliance -c "SELECT count(*) FROM \"Transaction\";"
   ```

2. **Prisma:**
   ```bash
   pnpm exec prisma migrate status   # are migrations applied?
   pnpm db:studio                    # GUI at http://localhost:5555
   ```

3. **App-level health check (recommended for the demo):**
   ```bash
   curl -s http://localhost:3000/api/health | jq
   ```
   Returns `{ db: { ok, latencyMs }, redis: {...}, queue: {...}, stripe: {...} }`. The dashboard renders this same payload as the colored status dots.

---

## Reference — files map

```
app/
  api/
    webhooks/stripe/route.ts   # Stripe webhook receiver, enqueue → 200
    transactions/route.ts       # paginated transactions for the UI
    reconcile/route.ts          # POST starts a run; runs async
    reconcile/status/route.ts   # poll target for ReconciliationPanel
    nexus/route.ts              # current per-state exposure
    gaps/route.ts               # open reconciliation gaps
    events/route.ts             # webhook audit log
    seed/route.ts               # creates 10 Stripe test charges
    health/route.ts             # NEW — pings db, redis, queue, env
  dashboard/page.tsx            # SSR fetch + <DashboardClient/>
  layout.tsx                    # dark color-scheme, Geist fonts
  page.tsx                      # redirects "/" → "/dashboard"
  globals.css                   # tailwind v4 + dark palette
components/
  DashboardClient.tsx           # auto-refresh, seed handler, layout
  SystemStatus.tsx              # NEW — live infra dot row
  TransactionTimeline.tsx       # left panel, expand-on-click rows
  ReconciliationPanel.tsx       # right panel, run + gap list
  NexusTracker.tsx              # full-width per-state bars
  EventLog.tsx                  # bottom audit feed
  MetricCard.tsx                # 4-up KPI cards
  StatusBadge.tsx               # shared badge primitive
lib/
  prisma.ts                     # PrismaClient singleton
  redis.ts                      # ioredis singleton (lazyConnect)
  queue.ts                      # BullMQ queues w/ retry policy
  stripe.ts                     # Stripe SDK client
  jurisdictions.ts              # state→rate map, nexus thresholds
  normalizer.ts                 # Stripe Charge → Transaction record
workers/
  transactionWorker.ts          # BullMQ consumer (separate process)
prisma/
  schema.prisma                 # full data model
  migrations/                   # generated by prisma migrate dev
.env                            # for prisma CLI (DATABASE_URL, REDIS_URL)
.env.local                      # for next.js runtime + STRIPE_*
```
