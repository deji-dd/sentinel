# Sentinel Architecture

This document is a practical handover guide for the Sentinel monorepo.
It focuses on how the system is structured, how data moves, and how to operate it safely.

## 1) System Summary

Sentinel is a SQLite-first Torn City integration platform with three active runtime components:

- Worker app: background sync and processing jobs.
- Bot app: Discord interaction surface and internal HTTP endpoints.
- Edge Proxy app: Cloudflare Worker for secure assist install/event forwarding.

The UI is archived under `.archive/ui` and is not part of the active runtime.

## 2) Monorepo Layout

Top-level workspace uses `pnpm` and TypeScript ESM.

- `apps/worker`: background jobs and migration runner.
- `apps/bot`: Discord bot, interaction handlers, assist HTTP server.
- `apps/edge-proxy`: Cloudflare Worker front door for assist routes.
- `packages/shared`: shared Torn client, DB utilities, constants, generated API types.
- `sqlite/migrations`: canonical SQLite schema evolution.
- `supabase/migrations`: legacy/parallel SQL artifacts.

Key workspace files:

- `package.json`: root scripts and workspace orchestration.
- `pnpm-workspace.yaml`: package boundaries.
- `ecosystem.config.js`: PM2 production process model.
- `cron-deploy.sh`: pull/build/migrate/restart deployment pipeline.

## 3) Runtime Components

### 3.1 Worker (`apps/worker`)

Purpose:

- Pulls/syncs Torn data into SQLite.
- Performs periodic pruning and derived data generation.

Entry point:

- `apps/worker/src/index.ts`

Worker grouping:

- Private workers (`apps/worker/src/workers/private/index.ts`): user data, snapshots, training, battlestats, gyms.
- Public workers (`apps/worker/src/workers/public/index.ts`): items, faction, territory, war ledger, pruning.

Scheduling model:

- Database-driven scheduler, not cron.
- Core runner: `apps/worker/src/lib/scheduler.ts`.
- DB helper/claim logic: `apps/worker/src/lib/scheduler-db-helpers.ts`.
- Schedules stored in `sentinel_worker_schedules`, definitions in `sentinel_workers`, execution logs in `sentinel_worker_logs`.

Concurrency model:

- `claimWorker()` atomically pushes `next_run_at` far into the future to lock a run.
- `completeWorker()` recalculates next run and clears attempts/backoff.
- Failures apply exponential backoff and bounded attempts.

Rate-limited Torn access:

- Worker Torn client: `apps/worker/src/services/torn-client.ts`.
- Per-user rolling-window tracking in SQLite (`sentinel_rate_limit_requests_per_user`).
- Safety limit in code: 50 req/min per user.
- API key -> user mapping bootstrap is required at startup.

Scope switching:

- `WORKER_SCOPE` supports `private`, `public`, or `all`.

### 3.2 Bot (`apps/bot`)

Purpose:

- Handles Discord slash commands and component interactions.
- Hosts internal HTTP endpoints for assist install/events.

Entry point:

- `apps/bot/src/index.ts`

Command routing:

- Admin command gate/router: `apps/bot/src/lib/admin-commands.ts`.
- Regular command router: `apps/bot/src/lib/regular-commands.ts`.
- Component interaction router: `apps/bot/src/lib/interaction-handlers.ts`.

Ready-time startup:

- `apps/bot/src/lib/client-events.ts`
- Starts internal HTTP server, guild sync scheduler, war tracker scheduler, revive maintenance.

Internal HTTP server:

- `apps/bot/src/lib/http-server.ts`
- Receives proxy-authenticated assist traffic via `Proxy-Secret-Header`.
- Enforces payload size guardrails and request validation.

DB access:

- Kysely-first via `apps/bot/src/lib/db-client.ts`.
- Falls back to raw `better-sqlite3` only for transaction/edge cases.

### 3.3 Edge Proxy (`apps/edge-proxy`)

Purpose:

- Public ingress for assist install scripts and assist event API.
- Security boundary between clients and bot internals.

Entry point:

- `apps/edge-proxy/src/index.ts`

Routes:

- `GET /install/:uuid.user.js` -> bot `/internal/assist-install/:uuid.user.js`
- `POST|PATCH|DELETE /api/assist-events` -> bot `/internal/assist-events`

Security controls:

- HMAC signature validation for install links.
- HMAC auth token verification for assist event payloads.
- Strict method/path allowlists.
- JSON body size limits.
- Propagates source metadata (`X-Assist-*` headers).

## 4) Shared Package (`packages/shared`)

Purpose:

- Single source for constants, Torn API client wrappers, encryption helpers, and DB bootstrap.

Important modules:

- `packages/shared/src/constants.ts`: canonical `TABLE_NAMES` and shared limits.
- `packages/shared/src/db/sqlite.ts`: singleton SQLite connection + Kysely dialect.
- `packages/shared/src/generated/torn-api.ts`: generated Torn OpenAPI types.
- `packages/shared/src/torn.ts`: Torn client primitives used by worker/bot.

DB path resolution:

- Development default: `./data/sentinel-local.db`
- Production default: `./data/sentinel.db`
- Overridable via `SQLITE_DB_PATH_LOCAL` and `SQLITE_DB_PATH`.
- Relative paths are resolved from workspace root.

## 5) Data and Control Flows

### 5.1 Worker Sync Flow

1. Worker process boots and resolves scope.
2. Torn API key/user mapping initialization runs (hard requirement).
3. Each worker registers itself in scheduler tables if needed.
4. Poll loop checks due schedule rows.
5. Atomic claim lock acquired in DB.
6. Worker handler executes API calls + DB writes.
7. Completion/failure updates schedule state and writes worker logs.

### 5.2 Discord Command Flow

1. Discord interaction arrives at bot gateway client.
2. Chat input commands pass through command audit.
3. Admin commands are authorization-gated.
4. Regular commands route by command name.
5. UI components (buttons/selects/modals) route by `customId` prefixes.
6. Handlers read/write SQLite and respond via Discord API.

### 5.3 Assist Web Flow

1. Client hits edge proxy install/event endpoint.
2. Proxy validates signature/auth token and payload constraints.
3. Proxy forwards to bot internal endpoint with secret header and trace headers.
4. Bot validates proxy secret and payload semantics.
5. Bot updates assist state and posts/updates Discord messages.

## 6) Database and Migrations

Database engine:

- SQLite with WAL mode and performance pragmas configured in shared DB layer.

Migration runner:

- `apps/worker/src/scripts/apply-sqlite-migrations.ts`
- Root command: `pnpm sqlite:migrate`

Migration behavior:

- Applies `sqlite/migrations/*.sql` in lexical order.
- Records applied files/checksums in `sentinel_schema_migrations`.
- Rejects changed migration files after apply.
- Wraps each migration file in a transaction.

Important constraint for authors:

- Migration SQL files should not include `BEGIN`/`COMMIT` because the runner wraps execution.

## 7) Security Model

Secrets and envs:

- `ENCRYPTION_KEY`: required across apps for encrypted API key storage.
- `API_KEY_HASH_PEPPER`: required for worker per-user rate-limit hashing.
- `ASSIST_PROXY_SECRET`: shared secret between edge proxy and bot internal endpoints.
- Discord tokens/client IDs are environment-specific (`*_LOCAL` vs production values).

API key handling:

- Raw Torn API keys are not persisted in plaintext.
- Key-user mapping and rate limiting rely on hashed identifiers and SQLite tracking tables.

Ingress hardening:

- Edge proxy validates signatures/auth, allowlists routes/methods, enforces payload limits.
- Bot internal assist endpoints require `Proxy-Secret-Header` verification.

## 8) Build, Run, and Deploy

Common commands (from repo root):

- `pnpm install`
- `pnpm sqlite:migrate`
- `pnpm --filter shared build`
- `pnpm --filter worker dev`
- `pnpm --filter bot dev`
- `pnpm --filter edge-proxy dev`

Production process model:

- PM2 config in `ecosystem.config.js`.
- Two processes: `sentinel-worker`, `sentinel-bot`.

Automated deploy path:

- `cron-deploy.sh` handles:
- lockfile guard
- git fetch/pull fast-forward
- dependency install
- shared/worker/bot builds
- SQLite migrations
- PM2 restart sequence

## 9) Active Domain Modules

Operational modules represented by worker jobs + bot commands + tables include:

- User data and snapshots
- Training recommendations
- Battlestats sync/pruning
- Faction sync
- Territory blueprint/state
- War ledger sync/pruning
- Finance settings/commands
- Verification and guild admin flows
- Assist and revive systems
- Reaction roles

Travel workers are present but currently disabled in worker startup.

## 10) Known Gotchas for Handover

- Worker startup is intentionally fail-fast if API key mapping/rate-limit bootstrap fails.
- Scheduler locking relies on DB `next_run_at` claim semantics; changing claim logic can reintroduce duplicate runs.
- SQLite constraint parity with historical SQL may vary; conflict-based SQL patterns can fail if required constraints/indexes are absent.
- Bot and worker must share compatible DB path/env setup, or behavior diverges across environments.
- Assist flows depend on consistent shared secret and signature algorithms between bot and edge proxy.

## 11) Ownership and Change Guidance

When adding features:

- Put cross-app utilities in `packages/shared`.
- Keep runtime DB operations Kysely-first.
- Add new DB schema through `sqlite/migrations` only.
- For new workers, register scheduler rows and ensure idempotent handlers.
- For new bot interaction flows, include command registration + router wiring + `customId` namespace discipline.

When operating production:

- Prefer root-level scripted workflows to avoid app drift.
- Run migrations before restarts.
- Monitor `sentinel_worker_logs` and bot/worker PM2 logs for regressions.

## 12) Fast File Reference Index

Core runtime:

- `apps/worker/src/index.ts`
- `apps/bot/src/index.ts`
- `apps/edge-proxy/src/index.ts`

Scheduling and reliability:

- `apps/worker/src/lib/scheduler.ts`
- `apps/worker/src/lib/scheduler-db-helpers.ts`

DB and shared contracts:

- `packages/shared/src/db/sqlite.ts`
- `packages/shared/src/constants.ts`
- `apps/worker/src/scripts/apply-sqlite-migrations.ts`

Bot routing and assist:

- `apps/bot/src/lib/admin-commands.ts`
- `apps/bot/src/lib/regular-commands.ts`
- `apps/bot/src/lib/interaction-handlers.ts`
- `apps/bot/src/lib/http-server.ts`

Ops:

- `ecosystem.config.js`
- `cron-deploy.sh`
- `README.md`
