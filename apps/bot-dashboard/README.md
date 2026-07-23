# bot-dashboard

The Sentinel bot dashboard is a Next.js web application for managing Discord guild configurations, browsing territory maps, and performing guild-level administrative tasks. It is the operator-facing control panel for the Sentinel Discord bot.

Deployed to **Cloudflare Pages** via OpenNext (`wrangler.jsonc`). Runs on port `3002` in development.

## What's Inside

| Route | Description |
|-------|-------------|
| `/` | Root redirect / home |
| `/login` | Discord OAuth login |
| `/guilds` | Guild list and management |
| `/tt-selector` | Territory selector / map view (Leaflet) |

Authentication is handled by **NextAuth v5** (Discord OAuth provider).

## Stack

- **Framework**: Next.js 16 (App Router)
- **Auth**: NextAuth v5 (Discord OAuth)
- **UI**: Shadcn UI, Base UI, Tailwind CSS v4
- **Map**: Leaflet
- **Data**: Fetched from `apps/api` (Fastify, port `3001`)
- **Deploy**: Cloudflare Pages via OpenNext

## Development

```bash
# From the monorepo root
pnpm dashboard:dev           # Starts on http://localhost:3002

# Or from this directory
pnpm dev
```

Ensure `apps/api` is running locally before starting the dashboard — it is the data source for all routes.

## Build & Deploy

```bash
# Build for production
pnpm dashboard:build

# Deploy to Cloudflare Pages (from this directory)
pnpm wrangler pages deploy .next
```

Configuration lives in `wrangler.jsonc`. Environment variables are set in `.env.local` (dev) and `.env.production` (prod).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXTAUTH_URL` | Public base URL for the app |
| `NEXTAUTH_SECRET` | NextAuth secret key |
| `DISCORD_CLIENT_ID` | Discord OAuth app client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth app client secret |
| `NEXT_PUBLIC_API_URL` | Base URL for the Sentinel Fastify API |
