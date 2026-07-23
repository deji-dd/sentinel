# Sentinel

Sentinel is a private, self-hosted intelligence platform for [Torn City](https://www.torn.com) — a browser-based MMO RPG. It continuously syncs data from the Torn API, stores it in a local SQLite database, exposes it through a typed Fastify API, and surfaces it via a Discord bot and two Next.js dashboards.

The system is designed for personal and faction-level use, running on a single VPS managed by PM2.

## Architecture

Three Node.js processes run in parallel, all sharing the same SQLite database on disk:

```
sentinel-worker   — The Brain   — Torn API sync workers (cron-style, event-driven)
sentinel-bot      — The Hands   — Discord bot for interactive commands
sentinel-api      — The Bridge  — Fastify HTTP + WebSocket API for the frontends
```

Two Next.js frontends consume the API:

```
apps/next-ui        — Personal analytics dashboard (deployed to Cloudflare Pages)
apps/bot-dashboard  — Guild/bot management dashboard (deployed to Cloudflare Pages)
```

All apps share `packages/shared` — a single library containing the SQLite engine, NoSQL `Collection` wrappers, typed Torn API client, centralized logging, metrics, and utility modules.

## Monorepo Structure

```
apps/
  worker/           — Background sync workers (private + public + system)
  bot/              — Discord.js bot (slash commands, reaction roles, IPC)
  api/              — Fastify API gateway (REST + WebSocket)
  next-ui/          — Personal analytics dashboard (Next.js + Cloudflare Pages)
  bot-dashboard/    — Bot guild management dashboard (Next.js + Cloudflare Pages)

packages/
  shared/           — Database engine, Collections, Torn API client, Logger, metrics

data/               — SQLite database files
scripts/            — Dev utility scripts (migrations, snapshots)
context/            — Documentation and reference context
.archive/           — Archived legacy code (Postgres migrations, old UI)
```

## Quick Start

```bash
pnpm install
pnpm sqlite:migrate          # Apply all DB migrations
pnpm shared:build            # Build the shared library first

# Then build individual apps
pnpm worker:build
pnpm bot:build
pnpm api:build
```

### Local Development

Never use PM2 in development. Use the dev scripts directly:

```bash
pnpm worker:dev              # Start background workers
pnpm bot:dev                 # Start Discord bot
pnpm api:dev                 # Start Fastify API (port 3001)
pnpm ui:dev                  # Start personal dashboard (port 3000)
pnpm dashboard:dev           # Start bot dashboard (port 3002)
```

### Testing

Write test scripts to `apps/worker/src/scripts/test.ts` and run:

```bash
pnpm --filter worker test
```

## Database

Sentinel uses SQLite exclusively, accessed through a custom NoSQL wrapper (`Collection`) built on `better-sqlite3`. Documents are stored as JSON blobs with optional auto-indexed virtual columns for query performance.

| Environment | Default Path               | Override Env Var       |
|-------------|----------------------------|------------------------|
| Local       | `./data/sentinel-local.db` | `SQLITE_DB_PATH_LOCAL` |
| Production  | `./data/sentinel.db`       | `SQLITE_DB_PATH`       |

### Migrations

```bash
pnpm sqlite:migrate                         # Apply pending migrations
pnpm sqlite:new-migration <migration_name>  # Scaffold a new migration file
```

Migration files live in `sqlite/migrations/` and are applied in lexical order. Applied files are tracked in `sentinel_schema_migrations`.

## Workers (`apps/worker`)

Workers are split into three scoped categories:

| Category | Workers |
|----------|---------|
| `private` | `crimes`, `gym`, `stocks`, `wealth`, `travel`, `live-state-sync`, `daily-sync`, `log-manager`, `company` |
| `public`  | `faction-sync`, `territory-activity`, `territory-blueprints`, `travel-sync`, `torn-reference-sync` |
| `system`  | `system-maintenance` |

Workers communicate with the bot process over PM2 IPC.

## Bot (`apps/bot`)

A Discord.js bot that handles slash commands, reaction-based role assignment, and guild member auto-verification. Commands are split into:

| Category  | Description |
|-----------|-------------|
| `general` | Server config, territory views, member verification |
| `personal` | Owner-restricted admin tools |

## API (`apps/api`)

A Fastify HTTP server (port `3001`) with WebSocket support. Routes:

| Prefix | Description |
|--------|-------------|
| `/api/crimes` | Crime history and records |
| `/api/gym` | Gym training data |
| `/api/stocks` | Stock portfolio and market data |
| `/api/travel` | Travel logs and abroad tracking |
| `/api/wealth` | Wealth and financial history |
| `/api/tt` | Torn Trading data |
| `/api/guilds` | Guild configuration and member data |
| `/api/config` | Bot and guild config management |
| `/api/settings` | User/system settings |
| `/status` | Process health status |
| `/health` | Basic liveness check |

## Deployment

Production runs on a single VPS. PM2 manages all three server processes.

| Process | RAM Cap |
|---------|---------|
| `sentinel-worker` | 450 MB |
| `sentinel-bot` | 125 MB |
| `sentinel-api` | 125 MB |

`cron-deploy.sh` runs SQLite migrations automatically before each process reload. Full deploy:

```bash
pm2 deploy ecosystem.config.js production
```

The two Next.js frontends deploy independently to **Cloudflare Pages** via OpenNext.

## Archive

Legacy assets are preserved under `.archive/`:

- `.archive/postgres-migrations` — old Postgres schema
- `.archive/ui` — previous archived UI
