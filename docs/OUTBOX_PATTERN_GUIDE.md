# Production Transactional Outbox Pattern Guide

This document specifies the PostgreSQL transactional outbox pattern implemented across EMS Platform modules.

## The Concurrency & Scalability Pattern

When multiple worker nodes or containers run concurrently, fetching outbox events must avoid race conditions and row locking bottlenecks.

### High-Throughput Outbox Query (PostgreSQL 16)

```sql
-- Fetch batch of pending events without blocking concurrent pollers
SELECT id, aggregate_id, event_type, payload
FROM outbox
WHERE published = false
ORDER BY created_at ASC
LIMIT 50
FOR UPDATE SKIP LOCKED;
```

### Why `SKIP LOCKED` is Critical:
1. **Zero Lock Contention:** If Worker A is publishing a batch of 50 events, Worker B will skip those locked rows and immediately take the next 50 rows.
2. **At-Least-Once Delivery:** Events are only marked `published = true` AFTER successful delivery to Redis Streams / Event Bus.
3. **Idempotency on Consumer Side:** Consumers track processed `event_id` values in a local table (`processed_events`) to eliminate duplicate side effects.

### Outbox Table DDL (Per Module Schema)
```sql
CREATE TABLE IF NOT EXISTS outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox (created_at ASC) WHERE published = false;
```
