# Quick Reference: Using Rate Limiting & Batch Operations

## Single API Call (Automatic Rate Limiting)

```typescript
import { tornApi } from "../services/torn-client.js";

// Single call - automatically rate limited
const userData = await tornApi.get("/user/basic", { apiKey: userKey });
// Waits automatically if user hits 100 req/min limit
```

---

## Batch Operations (Recommended for Multiple Calls)

### Basic Batch (Sequential)
```typescript
import { batchHandler } from "../services/torn-client.js";
import { getUserApiKeys } from "../lib/api-keys.js";

const userKeys = await getUserApiKeys(userId);

const results = await batchHandler.executeBatch(
  [
    { id: "req1", item: 123 },    // Request 1: userId 123
    { id: "req2", item: 456 },    // Request 2: userId 456
    { id: "req3", item: 789 },    // Request 3: userId 789
  ],
  userKeys,
  async (userId, apiKey) => {
    return await tornApi.get("/user/basic", { apiKey });
  },
  { delayMs: 100 }  // 100ms between requests
);

// Results in original order
results.forEach(r => {
  if (r.success) console.log(`✓ ${r.result.profile.name}`);
  else console.error(`✗ ${r.error.message}`);
});
```

### Concurrent Batch (Faster)
```typescript
const results = await batchHandler.executeBatch(
  requests,
  userKeys,
  handler,
  { 
    concurrent: true,      // All keys in parallel
    delayMs: 200,          // Delay between key batches
    retryAttempts: 2       // Retry failed requests
  }
);
```

### Get Success Statistics
```typescript
const stats = BatchOperationHandler.getSummary(results);
console.log(`Total: ${stats.total}, Success: ${stats.successful}, Rate: ${stats.successRate.toFixed(1)}%`);
```

---

## API Key Management

### Store a New Key
```typescript
import { storeUserApiKey } from "../lib/api-keys.js";

await storeUserApiKey(userId, apiKey, isPrimary = true);
```

### Get All User Keys
```typescript
import { getUserApiKeys } from "../lib/api-keys.js";

const keys = await getUserApiKeys(userId);
// Returns: ["key1", "key2", "key3"]
```

### Get Primary Key
```typescript
import { getPrimaryUserApiKey } from "../lib/api-keys.js";

const primaryKey = await getPrimaryUserApiKey(userId);
// Returns the marked-primary key for this user
```

### Delete a Key
```typescript
import { deleteUserApiKey } from "../lib/api-keys.js";

await deleteUserApiKey(userId, apiKey);
// Soft delete - preserves audit trail
```

---

## Real-World Examples

### Example 1: Sync Multiple User Stats
```typescript
import { batchHandler } from "../services/torn-client.js";
import { getUserApiKeys } from "../lib/api-keys.js";

async function syncUserStatsForMultipleUsers(
  targetUserIds: number[],
  currentUserId: string
) {
  const userKeys = await getUserApiKeys(currentUserId);
  
  const results = await batchHandler.executeBatch(
    targetUserIds.map((id, i) => ({
      id: `user_${id}`,
      item: id
    })),
    userKeys,
    async (userId, key) => {
      const bars = await tornApi.get("/user/bars", { apiKey: key });
      const cooldowns = await tornApi.get("/user/cooldowns", { apiKey: key });
      return { userId, bars, cooldowns };
    },
    { delayMs: 50 }  // Fast sync
  );

  // Process results
  const successful = BatchOperationHandler.filterSuccessful(results);
  const failed = results.filter(r => !r.success);
  
  console.log(`Synced ${successful.length}/${results.length} users`);
  
  return { successful, failed };
}
```

### Example 2: Territory Mapping with Multiple Keys
```typescript
async function syncTerritories(userIds: number[], currentUserId: string) {
  const userKeys = await getUserApiKeys(currentUserId);

  // Create requests for each user
  const requests = userIds.map((id, idx) => ({
    id: `territory_${id}`,
    item: id,
    metadata: { userIndex: idx }
  }));

  // Distribute across keys with retries
  const results = await batchHandler.executeBatch(
    requests,
    userKeys,
    async (userId, key) => {
      const data = await tornApi.getRaw(
        `/territory.php`,
        key,
        { userId: String(userId) }
      );
      return { userId, territories: data.territories };
    },
    { 
      concurrent: true,
      delayMs: 100,
      retryAttempts: 3 
    }
  );

  // Save successful results to database
  for (const result of results) {
    if (result.success) {
      await db.updateTerritories(result.result.userId, result.result.territories);
    }
  }

  const stats = BatchOperationHandler.getSummary(results);
  console.log(`Territory sync complete: ${stats.successRate.toFixed(1)}% success`);
}
```

### Example 3: Batch Write with Error Handling
```typescript
async function updateMultipleUsers(updates: UpdatePayload[], userId: string) {
  const userKeys = await getUserApiKeys(userId);

  const results = await batchHandler.executeBatch(
    updates.map((update, i) => ({
      id: `update_${i}`,
      item: update
    })),
    userKeys,
    async (update, key) => {
      // Custom operation - could be any API call
      return await tornApi.getRaw("/some/endpoint", key, update.params);
    },
    { 
      concurrent: false,  // Sequential for writes
      delayMs: 200,       // Safe delay between requests
      retryAttempts: 3    // Retry important operations
    }
  );

  // Aggregate results
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (failed.length > 0) {
    console.error(`Failed ${failed.length} updates:`, 
      failed.map(f => ({ id: f.requestId, error: f.error.message }))
    );
  }

  return { total: results.length, successful: successful.length, failed: failed.length };
}
```

---

## Rate Limiting Behavior

### Automatic Waiting
The system automatically waits when user hits limit:

```typescript
// First 100 requests go through immediately
for (let i = 0; i < 100; i++) {
  await tornApi.get("/user/basic", { apiKey });
}

// Request 101 automatically waits ~60 seconds
const data = await tornApi.get("/user/basic", { apiKey });
// Logs: "[RateLimiter] User rate limited. Waiting 5234ms before retry."
```

### How Batch Handler Respects Limits
```typescript
// If user has 2 keys:
// - Key 1: Used for requests 1-50
// - Key 2: Used for requests 51-100
// - Request 101: Automatically waits for window to expire
// - All tracked under single user limit (100 req/min)

await batchHandler.executeBatch(
  requests(150),  // 150 requests total
  [key1, key2],   // 2 keys
  handler,
  { concurrent: false }
);
// Respects 100 req/min per user, not per key
```

---

## Troubleshooting

### "User rate limited. Waiting..."
**Cause**: User hit 100 req/min limit  
**Solution**: Check batch size, add delays, or use multiple keys

### "Could not resolve user_id for api_key_hash"
**Cause**: API key not registered in mapping table  
**Solution**: Call `storeUserApiKey()` first or check key is valid

### Low success rate in batch results
**Cause**: Transient network errors or rate limiting  
**Solution**: Increase `retryAttempts` or reduce batching pressure

---

## Type Safety

```typescript
import type { BatchRequest, BatchResult } from "@sentinel/shared";

// Strongly typed batch operations
const requests: BatchRequest<UserId>[] = [
  { id: "req1", item: 123 }
];

const results: BatchResult<UserData>[] = await batchHandler.executeBatch(
  requests,
  keys,
  async (userId: UserId, key: string): Promise<UserData> => {
    return await tornApi.get("/user/basic", { apiKey: key });
  }
);

// Results are typed as BatchResult<UserData>[]
results[0].result?.profile.name  // Type-safe!
```

---

## Performance Tips

1. **Use appropriate concurrency**: Sequential for writes, concurrent for reads
2. **Batch size**: 50-100 requests per batch for optimal throughput
3. **Key distribution**: More keys = better parallelization (but still limited by 100 req/min per user)
4. **Retry strategy**: Higher retries for important operations, lower for non-critical
5. **Caching**: Call `clearCache()` between batches if processing different users

---

## Don't Do This

```typescript
// ❌ WRONG: Individual calls in loop (slow, doesn't scale)
for (const userId of userIds) {
  const data = await tornApi.get("/user/basic", { apiKey });
}

// ✅ RIGHT: Use batch operations
const results = await batchHandler.executeBatch(
  userIds.map((id, i) => ({ id: `u_${id}`, item: id })),
  userKeys,
  handler
);
```

```typescript
// ❌ WRONG: Ignoring batch results
await batchHandler.executeBatch(requests, keys, handler);

// ✅ RIGHT: Check for failures
const results = await batchHandler.executeBatch(requests, keys, handler);
const failures = results.filter(r => !r.success);
if (failures.length > 0) {
  console.error(`${failures.length} requests failed`);
}
```

```typescript
// ❌ WRONG: Assuming sequential execution in concurrent mode
await batchHandler.executeBatch(requests, keys, handler, { concurrent: true });
// Requests execute in parallel, not in order

// ✅ RIGHT: Results array is always in original order
const results = await batchHandler.executeBatch(requests, keys, handler, { concurrent: true });
// results[i] corresponds to requests[i], executed in parallel
```
