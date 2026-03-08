# Sentinel

Sentinel is a SQLite-first Torn City integration monorepo with two active apps:

- `apps/worker`: background sync workers
- `apps/bot`: Discord bot

The web UI has been archived to `.archive/ui`.

## Quick Start

```bash
pnpm install
pnpm sqlite:migrate
pnpm --filter shared build
pnpm --filter worker build
pnpm --filter bot build
```

For local development:

```bash
pnpm --filter worker dev
pnpm --filter bot dev
```

## Database

Sentinel now uses SQLite only.

- Default local DB path: `./data/sentinel-local.db`
- Default production DB path: `./data/sentinel.db`
- Override with env vars:
- `SQLITE_DB_PATH_LOCAL`
- `SQLITE_DB_PATH`

Schema initialization is handled by the migration system. When a database is empty, run `pnpm sqlite:migrate` to apply all migrations.

## Migrations

A tracked migration runner is provided:

```bash
pnpm sqlite:migrate
```

It applies `*.sql` files from `sqlite/migrations` in lexical order and records applied files in `sentinel_schema_migrations`.

Create a migration scaffold:

```bash
pnpm sqlite:new-migration add_new_table
```

## Deployment

`cron-deploy.sh` now runs SQLite migrations automatically before process restart.

## Archive

Legacy assets are preserved in `.archive/`, including:

- `.archive/ui`
- `.archive/postgres-migrations`
