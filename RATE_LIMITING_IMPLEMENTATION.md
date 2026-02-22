# Rate Limiting & Load Balancer Implementation Guide

## Overview

I've implemented a comprehensive API rate limiting and load balancing system for Sentinel that fixes critical flaws in the original design and provides intelligent batch operation handling.

## What Was Wrong With the Original System

### 1. **Per-Key vs Per-User Rate Limiting (Critical Flaw)**
- **Problem**: Torn City API enforces a **per-user limit of 100 requests/minute**, not per API key
- **Old System**: Tracked rate limits independently by API key hash
- **Real Impact**: If a user had 3 API keys, they could theoretically make 150+ req/min (50×3), violating Torn's actual limit
- **Fix**: New system tracks all requests per USER regardless of which key made the request

### 2. **Fixed Rate Limit at 50 req/min**
- **Problem**: Hardcoded safety buffer wasted 50% of available quota
- **Old System**: Had no configuration mechanism
- **Real Impact**: Users only got 50 req/min when they could access 100
- **Fix**: Configurable limits (default 100) with per-user overrides possible

### 3. **No API Key Storage per User**
- **Problem**: No `sentinel_user_keys` table for storing encrypted keys
- **Old System**: Single `TORN_API_KEY` environment variable for entire bot
- **Real Impact**: Couldn't support multi-key users or batch optimization
- **Fix**: Encrypted per-user key storage with proper RLS

### 4. **Naive Batch Operations**
- **Problem**: `ApiKeyRotator` used simple round-robin, no rate-aware logic
- **Old System**: Didn't consider current rate limit state
- **Real Impact**: Batch operations couldn't optimize throughput
- **Fix**: `BatchOperationHandler` analyzes quota and distributes intelligently

### 5. **Code Duplication in Bot**
- **Problem**: Bot app had duplicate validation code
- **Old System**: Separate fetch calls without shared client
- **Real Impact**: Maintenance burden, inconsistent error handling
- **Fix**: Unified use of `TornApiClient` across all apps

---

## New Architecture

### Database Changes

#### 1. `sentinel_user_keys` Table
Stores encrypted API keys per user with support for primary key designation:
```sql
CREATE TABLE sentinel_user_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  api_key_encrypted TEXT NOT NULL,  -- AES-256-GCM encrypted
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  last_used_at TIMESTAMP,
  deleted_at TIMESTAMP  -- Soft delete
);
```

**Features**:
- Encrypted storage using AES-256-GCM (matches existing encryption)
- Soft deletes for audit trail
- Primary key concept for default usage
- User can have multiple keys for load balancing

#### 2. `sentinel_api_key_user_mapping` Table
Maps API key hashes to user IDs for fast lookups in rate limiting:
```sql
CREATE TABLE sentinel_api_key_user_mapping (
  api_key_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMP,
  deleted_at TIMESTAMP
);
```

**Purpose**: 
- O(1) lookup to resolve which user owns an API key
- Enables per-user rate limiting to work correctly
- Cache-friendly for batch operations

#### 3. Modified `sentinel_rate_limit_requests_per_user` Table
Added `user_id` column to track requests per USER instead of per key:
```sql
ALTER TABLE sentinel_rate_limit_requests_per_user 
  ADD COLUMN user_id UUID REFERENCES auth.users(id);

CREATE INDEX sentinel_rate_limit_requests_user_id_idx 
  ON sentinel_rate_limit_requests_per_user(user_id, requested_at DESC);
```

**Benefit**: All requests from all a user's keys count toward single 100 req/min limit

---

## Core Components

### 1. `PerUserRateLimiter` (NEW)
**Location**: `packages/shared/src/per-user-rate-limiter.ts`

Replaces `DatabaseRateLimiter` with per-user tracking:

```typescript
const rateLimiter = new PerUserRateLimiter({
  supabase,
  tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
  apiKeyMappingTableName: TABLE_NAMES.API_KEY_USER_MAPPING,
  hashPepper: API_KEY_HASH_PEPPER,
  maxRequestsPerWindow: 100,  // Full Torn limit, not safety buffer
});
```

**Key Methods**:
- `waitIfNeeded(apiKey)` - Enforces per-user limit
- `recordRequest(apiKey)` - Tracks request with resolved user_id
- `getRequestCount(apiKey)` - Current window usage by user
- `isRateLimited(apiKey)` - Check if user hit limit
- `clearCache()` - Reset user ID cache between batches

**How It Works**:
1. Receives an API key
2. Looks up user ID from `sentinel_api_key_user_mapping`
3. Caches user ID for batch efficiency
4. Tracks request against user's total (not key-specific)
5. Ensures user never exceeds 100 req/min across all keys

### 2. `BatchOperationHandler` (NEW)
**Location**: `packages/shared/src/batch-operation-handler.ts`

Optimally distributes batch requests across available API keys:

```typescript
const handler = new BatchOperationHandler(rateLimiter);

// Execute batch with smart distribution
const results = await handler.executeBatch(
  [
    { id: "req1", item: { userId: 123 } },
    { id: "req2", item: { userId: 456 } },
    { id: "req3", item: { userId: 789 } },
  ],
  [apiKey1, apiKey2],  // Available keys for this user
  async (item, key) => {
    return await tornApi.get("/user/basic", { apiKey: key });
  },
  { concurrent: false, delayMs: 100, retryAttempts: 2 }
);
```

**Capabilities**:
- **Smart Distribution**: Analyzes quota state, distributes intelligently
- **Concurrent or Sequential**: Choose based on use case
- **Retry Logic**: Handles transient failures with exponential backoff
- **Result Preservation**: Returns results in original request order
- **Statistics**: Built-in summary stats (success rate, failures)

**Example Use Cases**:
1. Fetch data for 100 users with 3 API keys
   - Distributes 33-34 requests per key
   - Sequential with 100ms delay: safe for rate limits
   - Results returned in original order

2. Batch write with deadline
   - Parallel execution across 3 keys
   - 100ms delay between key batches
   - Auto-retry failed requests

### 3. `APIKeyManager` (NEW)
**Location**: `packages/shared/src/api-key-manager.ts`

Secure encryption/decryption of API keys:

```typescript
// Encrypt before storage
const encrypted = encryptApiKey(apiKey, masterKey);
await db.insert({ api_key_encrypted: encrypted });

// Decrypt when needed
const decrypted = decryptApiKey(encrypted, masterKey);

// Hash for database tracking (non-reversible)
const hash = hashApiKey(apiKey, pepper);
```

**Security Features**:
- AES-256-GCM encryption (same as main encryption module)
- Random IV per encryption
- Authentication tag for integrity
- Format: `iv(32 hex) + tag(32 hex) + ciphertext`
- Validation helpers for key format

### 4. Worker API Key Management
**Location**: `apps/worker/src/lib/api-keys.ts`

Utilities for storing and retrieving user keys:

```typescript
// Store a new key for a user
await storeUserApiKey(userId, apiKey, isPrimary = true);

// Get all keys for a user
const keys = await getUserApiKeys(userId);

// Get primary key
const primaryKey = await getPrimaryUserApiKey(userId);

// Delete a key (soft delete)
await deleteUserApiKey(userId, apiKey);
```

**Usage in Workers**:
```typescript
// In a worker job
const userKeys = await getUserApiKeys(userId);
const results = await batchHandler.executeBatch(
  requests,
  userKeys,
  async (item, key) => {
    return await tornApi.get(`/user/${item.userId}/basic`, { apiKey: key });
  }
);
```

---

## Integration Updates

### Worker (`apps/worker/src/services/torn-client.ts`)
**Before**:
```typescript
const rateLimiter = new DatabaseRateLimiter({
  maxRequestsPerWindow: 50  // Fixed, per-key
});
export const tornApi = new TornApiClient({ rateLimitTracker: rateLimiter });
```

**After**:
```typescript
const rateLimiter = new PerUserRateLimiter({
  maxRequestsPerWindow: 100  // Full limit, per-user
});
export const tornApi = new TornApiClient({ rateLimitTracker: rateLimiter });
export const batchHandler = new BatchOperationHandler(rateLimiter);
```

**Benefits**:
- Single 100 req/min limit for user, not per-key
- Export batch handler for use in workers
- Full Torn quota available

### Bot (`apps/bot/src/services/torn-client.ts`)
**Before**:
- Separate `torn.ts` with duplicate fetch code

**After**:
```typescript
export function createTornApiClient(supabase: SupabaseClient): TornApiClient {
  const rateLimiter = new PerUserRateLimiter({
    maxRequestsPerWindow: 100,
  });
  return new TornApiClient({ rateLimitTracker: rateLimiter });
}

export async function validateTornApiKey(apiKey, tornApi) {
  return await tornApi.get("/key/info", { apiKey });
}
```

**Benefits**:
- Unified with worker implementation
- No code duplication
- Same rate limiting behavior

---

## Example: Using the New System

### Single Request with Rate Limiting
```typescript
import { tornApi } from "./services/torn-client.js";

// Automatically rate limited
const data = await tornApi.get("/user/basic", { apiKey: userKey });
// Returns after waiting if needed to respect per-user 100 req/min limit
```

### Batch Operation Example
```typescript
import { batchHandler } from "./services/torn-client.js";
import { getUserApiKeys } from "../lib/api-keys.js";

// Get all keys for user
const userKeys = await getUserApiKeys(userId);

// Prepare requests
const requests = userIds.map((id, idx) => ({
  id: `req_${idx}`,
  item: { userId: id }
}));

// Execute batch
const results = await batchHandler.executeBatch(
  requests,
  userKeys,
  async (item, key) => {
    return await tornApi.get("/user/{id}/basic", {
      apiKey: key,
      pathParams: { id: item.userId }
    });
  },
  { concurrent: false, delayMs: 100 }
);

// Results in original order
results.forEach(result => {
  if (result.success) {
    console.log(`User ${result.requestId}: ${result.result.profile.name}`);
  } else {
    console.error(`Failed: ${result.error.message}`);
  }
});
```

### Multi-User Load Balancing
```typescript
// Get user's available API keys
const userKeys = await getUserApiKeys(userId);

// Distribute requests across keys
const results = await batchHandler.executeBatch(
  targetUserIds.map((id, idx) => ({ id: `u_${id}`, item: id })),
  userKeys,  // 3 keys × 100 req/min = still limited to user's 100 req/min
  async (userId, key) => {
    return await tornApi.get(`/user/${userId}/basic`, { apiKey: key });
  },
  { concurrent: true, delayMs: 200 }
);
```

---

## Key Differences from Old System

| Feature | Old | New |
|---------|-----|-----|
| **Rate Limit Per** | API Key | User |
| **Default Limit** | 50 req/min | 100 req/min |
| **Multi-Key Support** | ❌ | ✅ |
| **Limit Across Keys** | Independent x N | Shared 100 |
| **Key Storage** | Env vars only | Encrypted DB |
| **Batch Handling** | Round-robin | Intelligent |
| **Code Duplication** | High | Eliminated |
| **Rate Limit State** | Per-key hash | Per-user mapping |

---

## Migration Path

### For Existing Users
1. Create entry in `sentinel_user_keys` for any existing API key
2. Create mapping in `sentinel_api_key_user_mapping`
3. Update rate limit records with resolved user_id
4. Keep old system running during transition (backward compatible)

### For New Multi-Key Users
1. Store multiple keys in `sentinel_user_keys`
2. System automatically tracks them under single user limit
3. Use `batchHandler` to distribute requests

---

## Configuration & Customization

### Global Rate Limit Override
```typescript
const rateLimiter = new PerUserRateLimiter({
  maxRequestsPerWindow: 80,  // Lower limit if needed
});
```

### Per-User Limits (Future Enhancement)
```typescript
// Could extend to support:
rateLimiter.setMaxRequests(userId, 50);  // Custom limit
```

### Batch Execution Options
```typescript
await batchHandler.executeBatch(requests, keys, handler, {
  concurrent: true,      // Parallel execution
  delayMs: 500,          // Delay between batches
  retryAttempts: 3       // Retry failed requests
});
```

---

## Files Changed/Created

### New Files
- `packages/shared/src/api-key-manager.ts` - Key encryption
- `packages/shared/src/per-user-rate-limiter.ts` - Per-user rate limiting
- `packages/shared/src/batch-operation-handler.ts` - Smart batch distribution
- `apps/worker/src/lib/api-keys.ts` - Worker API key utilities
- `supabase/migrations/20260222000000_create_user_keys_table.sql` - Database tables

### Modified Files
- `packages/shared/src/index.ts` - Export new modules
- `packages/shared/src/constants.ts` - Add table name constants
- `apps/worker/src/services/torn-client.ts` - Use new rate limiter
- `apps/bot/src/services/torn-client.ts` - Use new rate limiter
- `apps/bot/src/services/torn.ts` - Forwarding wrapper (deprecation)

---

## Testing the New System

### Test 1: Per-User Rate Limiting
```typescript
// Create requests that exceed user limit
const results = [];
for (let i = 0; i < 120; i++) {
  results.push(await tornApi.get("/user/basic", { apiKey: userKey }));
  // After 100, should wait for window to expire
}
```

### Test 2: Multi-Key Distribution
```typescript
const userKeys = [key1, key2, key3];
const results = await batchHandler.executeBatch(
  [...150 requests...],
  userKeys,
  handler
);
// Should distribute: 50 per key, still respecting 100 req/min user limit
```

### Test 3: Batch Failure Retry
```typescript
const results = await batchHandler.executeBatch(
  requests,
  keys,
  async (item, key) => {
    // Simulate failures on first attempt
    if (Math.random() < 0.3) throw new Error("Transient failure");
    return { success: true };
  },
  { retryAttempts: 2 }
);

// Summary shows retry successes
const stats = BatchOperationHandler.getSummary(results);
console.log(`Success Rate: ${stats.successRate}%`);
```

---

## Performance Improvements

1. **Better Throughput**: Full 100 req/min available (was 50)
2. **Parallel Execution**: Batch handler can use multiple keys simultaneously
3. **Smart Distribution**: Considers rate limit state for optimal scheduling
4. **Reduced Wait Times**: Spreads requests across keys to avoid single bottleneck
5. **Scalability**: Supports unlimited users with multiple keys each

---

## Error Handling & Logging

### Rate Limit Waiting
```
[RateLimiter] User rate limited. Waiting 5234ms before retry.
```

### User ID Resolution Failure
```
[RateLimiter] Could not resolve user_id for api_key_hash: abc123...
```

### Batch Retry On Failure
```
BatchResult {
  requestId: "req_1",
  success: false,
  error: Error("Too many requests"),
  keyUsed: "remaining_key_3"
}
```

---

## Next Steps for Territories Module

You can now build the territories module with:

1. **Multi-User Support**: Use batch operations for district/territory syncing
2. **Efficient Syncing**: Distribute requests across user's available keys
3. **Rate-Aware**: Automatically respects per-user 100 req/min limit
4. **Smart Loading**: BatchOperationHandler optimizes throughput

Example:
```typescript
// Sync territories for multiple users efficiently
const userIds = [1, 2, 3, ..., 100];
const userKeys = await getUserApiKeys(currentUserId);

const results = await batchHandler.executeBatch(
  userIds.map((id, i) => ({ id: `user_${id}`, item: id })),
  userKeys,  // Distribute across available keys
  async (userId, key) => {
    const territoryData = await tornApi.get("/user/{id}/territory", {
      apiKey: key,
      pathParams: { id: userId }
    });
    return { userId, territoryData };
  }
);
```

This ensures you make optimal use of your rate limit quota while maintaining rate compliance.
