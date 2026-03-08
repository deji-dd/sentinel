# Sentinel Assist Edge Proxy

Cloudflare Worker that proxies assist script installation and assist event traffic to the bot HTTP server.

## Routes

- `GET /install/:uuid.user.js` -> forwards to bot `GET /internal/assist-install/:uuid.user.js`
- `POST|PATCH|DELETE /api/assist-events` -> forwards to bot `POST|PATCH|DELETE /internal/assist-events`

## Security

- Adds `Proxy-Secret-Header` to all bot-bound requests.
- Rejects unsupported methods and paths.
- Enforces JSON body size limit before forwarding.
- Sends `X-Assist-Proxy-Origin`, `X-Assist-Client-IP`, and `X-Assist-Client-UA` for audit trails.

## Environment

Set secret in Cloudflare:

```bash
pnpm --filter edge-proxy exec wrangler secret put ASSIST_PROXY_SECRET
pnpm --filter edge-proxy exec wrangler secret put ASSIST_PROXY_SECRET --env dev
```

Set vars in `wrangler.toml`:

- `BOT_ORIGIN`: Bot base URL (`https://your-bot-domain` in production, local URL in dev).
- `ASSIST_MAX_JSON_BYTES`: JSON body max size for `/api/assist-events`.

## Commands

```bash
pnpm --filter edge-proxy dev
pnpm --filter edge-proxy check
pnpm --filter edge-proxy deploy
pnpm --filter edge-proxy deploy:dev
```
