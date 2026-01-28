# @sentinel/shared

Shared utilities and services for the Sentinel monorepo.

## Modules

### Torn API Client

Type-safe Torn API client with auto-generated types from the official OpenAPI specification.

#### Features

- **Full Type Safety**: Auto-complete for API paths, query parameters, and response types
- **Rate Limiting**: Optional rate limiting integration (used by worker and bot)
- **V1 & V2 Support**: Typed endpoints for v2 API, raw access for v1 endpoints
- **Error Handling**: Centralized error codes and messages

#### Basic Usage

```typescript
import { TornApiClient } from "@sentinel/shared";

const tornApi = new TornApiClient();

// Type-safe API calls with auto-complete
const profile = await tornApi.get("/user/profile", { apiKey });
console.log(profile.profile?.name);

const bars = await tornApi.get("/user/bars", { apiKey });
console.log(bars.bars?.energy?.current);
```

#### With Database Rate Limiting

```typescript
import {
  TornApiClient,
  DatabaseRateLimiter,
  TABLE_NAMES,
} from "@sentinel/shared";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(url, key);

const rateLimiter = new DatabaseRateLimiter({
  supabase,
  tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
  hashPepper: process.env.API_KEY_HASH_PEPPER!,
  maxRequestsPerWindow: 50, // Optional: default 50 req/min
  windowMs: 60000, // Optional: default 60s
});

const tornApi = new TornApiClient({
  rateLimitTracker: rateLimiter,
});

const travel = await tornApi.get("/user/travel", { apiKey });
```

### Constants

Shared table names and error codes used across all apps.

```typescript
import { TABLE_NAMES, TORN_ERROR_CODES } from "@sentinel/shared";

console.log(TABLE_NAMES.USERS); // "sentinel_users"
console.log(TORN_ERROR_CODES[2]); // "Incorrect Key: API key is wrong/incorrect format"
```

### Encryption

AES-256-GCM encryption utilities for API keys.

```typescript
import { encrypt, decrypt } from "@sentinel/shared";

const encryptionKey = process.env.ENCRYPTION_KEY!;

const encrypted = encrypt("my-api-key", encryptionKey);
const decrypted = decrypt(encrypted, encryptionKey);
```

**Important**: Both bot and worker must use the **same** `ENCRYPTION_KEY` environment variable.

### Rate Limiting

Database-backed rate limiter that coordinates across bot and worker instances.

```typescript
import { DatabaseRateLimiter, TABLE_NAMES } from "@sentinel/shared";

const rateLimiter = new DatabaseRateLimiter({
  supabase,
  tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
  hashPepper: process.env.API_KEY_HASH_PEPPER!,
});

// Check if rate limited
const isLimited = await rateLimiter.isRateLimited(apiKey);

// Wait if needed (automatically called by TornApiClient)
await rateLimiter.waitIfNeeded(apiKey);
```

**Features:**

- Tracks requests per API key (hashed for security)
- Prevents exceeding Torn's 100 req/min limit (default: 50 req/min safety buffer)
- Coordinates across multiple instances via shared database
- Automatic cleanup of old request records

## API Key Rotation

For batch operations with multiple API keys:

```typescript
import { ApiKeyRotator } from "@sentinel/shared";

const rotator = new ApiKeyRotator(["key1", "key2", "key3"]);

// Sequential processing with rotation
const results = await rotator.processSequential(
  items,
  async (item, apiKey) => {
    return await tornApi.get("/user/basic", { apiKey });
  },
  700, // delay between requests in ms
);

// Concurrent processing (N concurrent requests for N keys)
const results = await rotator.processConcurrent(
  items,
  async (item, apiKey) => {
    return await tornApi.get("/user/basic", { apiKey });
  },
  1000, // delay between batches
);
```

## Regenerating Types

When Torn updates their API, regenerate types:

```bash
# From repo root
pnpm generate:torn-types

# Or from shared package
cd packages/shared
pnpm generate-types
pnpm build
```

This fetches the latest OpenAPI spec from `https://www.torn.com/swagger/openapi.json` and regenerates TypeScript types.

## Type Exports

```typescript
import type { TornApiPaths } from "@sentinel/shared";

// Access raw OpenAPI path types if needed
type UserBarsPath = TornApiPaths["/user/bars"];
```
