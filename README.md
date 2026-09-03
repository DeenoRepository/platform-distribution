# EMS Platform - Production Distribution & Deployment

Deployable topology configuration for EMS Platform tailored for 50 concurrent active users.

## Components
- **Nginx Reverse Proxy**: SSL termination, static caching, gzip
- **Core App Shell**: Node.js microkernel hosting business modules
- **PostgreSQL 16**: Central database with isolated per-module schemas (`core`, `eps`, `wms`, `mro`, `prm`)
- **Redis 7**: In-memory cache and message queue broker

## Running
```bash
docker compose up -d
```
