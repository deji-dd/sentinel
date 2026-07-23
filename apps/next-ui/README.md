# next-ui

The Sentinel personal dashboard is a Next.js web application for browsing synced Torn City data — crimes, gym stats, stocks, travel logs, wealth history, and more. It is the owner-facing analytics interface that reads from the Sentinel API.

Deployed to **Cloudflare Pages** via OpenNext (`wrangler.jsonc`). Runs on port `3000` in development.

## What's Inside

| Route | Description |
|-------|-------------|
| `/` | Dashboard home (protected) |
| `/crimes` | Crime log and analysis |
| `/gym` | Gym training history |
| `/stocks` | Stock portfolio and market data |
| `/travel` | Travel log and abroad tracking |
| `/wealth` | Wealth and financial history |
| `/settings` | Personal settings |
| `/onboarding` | First-time setup flow |
| `/error-offline` | Offline / API unreachable error page |

All routes under `/` are auth-protected via middleware.

## Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: Shadcn UI, Base UI, Tailwind CSS v4, Framer Motion
- **Charts**: Recharts
- **Tables**: TanStack Table
- **Forms**: React Hook Form + Zod
- **Notifications**: Web Push (`web-push`)
- **Data**: Fetched from `apps/api` (Fastify, port `3001`)
- **Deploy**: Cloudflare Pages via OpenNext

## Development

```bash
# From the monorepo root
pnpm ui:dev                  # Starts on http://localhost:3000

# Or from this directory
pnpm dev --turbo
```

Ensure `apps/api` is running locally before starting the dashboard.

## Build & Deploy

```bash
# Build for production (Next.js only)
pnpm ui:build

# Preview on Cloudflare locally
pnpm preview

# Deploy to Cloudflare Pages
pnpm deploy
```

Configuration lives in `wrangler.jsonc` and `open-next.config.ts`. Environment variables are set in `.env.local` (dev) and `.env.production` (prod).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Base URL for the Sentinel Fastify API |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
