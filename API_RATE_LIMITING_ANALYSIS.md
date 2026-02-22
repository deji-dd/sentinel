# API Rate Limiting & Load Balancer Analysis

## Current Implementation Issues

### 1. **Per-API-Key Rate Limiting (CRITICAL FLAW)**

**Problem:** The current system tracks rate limits per API key, but Torn City API actually limits per USER, not per key.

- Each USER gets 100 requests/min across ALL their keys
- Current implementation tracks per key hash independently
- If a user has 3 keys, they could theoretically make 150 req/min (50 per key × 3) which violates Torn's actual limit

**Current Code:**

```typescript
// Rate limiter stores requests by api_key_hash
const keyHash = hashApiKey(apiKey);
// This means each key is tracked independently
```

**Impact:** Users with multiple keys will exceed Torn's actual per-user rate limit.

---

### 2. **Fixed Rate Limit (50 req/min)**

**Problem:** Hardcoded to 50 req/min as a "safety buffer" but:

- No configuration mechanism for dynamic limits
- No way to adjust per user or globally
- Wastes API quota (Torn allows 100, we only use 50)
- No consideration for other system limits

**Current Code:**

```typescript
const MAX_REQUESTS_PER_WINDOW = 50; // Fixed - cannot change
```

**Impact:** Users are artificially limited to 50% of their available quota.

---

### 3. **No User ID Retrieval Before API Calls**

**Problem:** Rate limiting doesn't know which user owns an API key

- Current system only tracks by hashed API key
- No association between API key → user ID
- Prevents per-user rate limiting across multiple keys

**Current Architecture:**

```typescript
// Extract API key from URL (found in fetch)
const keyMatch = url.match(/[?&]key=([^&]+)/);
const apiKey = keyMatch ? keyMatch[1] : "unknown";
// Now rate limit by this key, but we don't know which user it belongs to
```

**Impact:** Cannot properly enforce per-user limits.

---

### 4. **No User Keys Storage**

**Problem:** No `sentinel_user_keys` table exists to store users' API keys

- Current system uses single `TORN_API_KEY` environment variable
- Cannot support multi-key per user
- No encryption of stored keys
- Cannot retrieve user's available keys for batch operations

**Impact:** Cannot implement intelligent batch load balancing.

---

### 5. **Inefficient Batch Operations**

**Problem:** `ApiKeyRotator` exists but is inefficient:

- Round-robin rotation is naive (doesn't consider rate limit state)
- No intelligence about current rate limit usage
- Doesn't optimize based on user's available quota
- No mechanism to distribute batch requests optimally

**Current Code:**

```typescript
// Just rotates keys in order, no rate-aware logic
const key = this.keys[this.currentIndex];
this.currentIndex = (this.currentIndex + 1) % this.keys.length;
```

**Impact:** Batch operations don't maximize throughput or respect rate limits intelligently.

---

### 6. **Bot App Code Duplication**

**Problem:** Bot app has duplicate API call code that doesn't use shared client

- `apps/bot/src/services/torn.ts` manually makes fetch calls
- Duplicates error handling, timeout logic, rate limiting
- Doesn't integrate with DatabaseRateLimiter
- Creates maintenance burden

**Impact:** Inconsistent implementations, harder to maintain.

---

## Proposed Solution Architecture

### Phase 1: Database & Keys Management

1. Create `sentinel_user_keys` table
2. Store encrypted API keys per user
3. Track metadata (created_at, last_used, max_requests_per_minute)

### Phase 2: Per-User Rate Limiting

1. Refactor `DatabaseRateLimiter` to track by user_id instead of api_key_hash
2. Add mapping table: `api_key_hash → user_id`
3. Enforce global per-user limit across all their keys
4. Make rate limits dynamic and configurable

### Phase 3: Smart Batch Operations

1. Create `BatchOperationHandler` class
2. Accepts: array of requests + user's available API keys
3. Distributes requests optimally across keys
4. Considers current rate limit state
5. Returns results in original order

### Phase 4: User ID Resolution

1. Add helper function: `getUserIdFromApiKey(apiKey) → userId`
2. Called at start of batch operations
3. Cache result for batch duration

### Phase 5: Consolidation

1. Refactor bot app to use shared `TornApiClient`
2. Remove duplicate code
3. Add middleware for automatic rate limiting

---

## Implementation Details

### New Tables

```sql
-- Store encrypted API keys per user
CREATE TABLE sentinel_user_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  api_key_encrypted TEXT NOT NULL,  -- AES-256-GCM encrypted
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  last_used_at TIMESTAMP,
  deleted_at TIMESTAMP,
  UNIQUE(user_id, api_key_encrypted)
);

-- Map api_key_hash to user_id for fast lookups
CREATE TABLE sentinel_api_key_user_mapping (
  api_key_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP DEFAULT now(),
  deleted_at TIMESTAMP
);
```

### New Rate Limiting Table

```sql
-- Replace per-key tracking with per-user tracking
ALTER TABLE sentinel_rate_limit_requests_per_user
  RENAME TO sentinel_rate_limit_requests;

ALTER TABLE sentinel_rate_limit_requests
  ADD COLUMN user_id UUID REFERENCES auth.users(id);

-- Create index on user_id instead of api_key_hash
CREATE INDEX sentinel_rate_limit_requests_user_idx
  ON sentinel_rate_limit_requests(user_id, requested_at DESC);
```

---

## Key Files to Create/Modify

### New Files

- `packages/shared/src/api-key-manager.ts` - Key encryption/decryption
- `packages/shared/src/batch-operation-handler.ts` - Smart batch distribution
- `packages/shared/src/per-user-rate-limiter.ts` - User-based rate limiting

### Modified Files

- `packages/shared/src/rate-limiter.ts` - Switch to per-user tracking
- `packages/shared/src/torn.ts` - Use new rate limiter
- `apps/worker/src/lib/supabase.ts` - Add key retrieval functions
- `apps/bot/src/services/torn.ts` - Use shared client
- `apps/bot/src/services/torn-client.ts` - Update for new architecture

### Migrations

- Create `sentinel_user_keys` table
- Create `sentinel_api_key_user_mapping` table
- Migrate rate limit tracking structure

---

## Benefits of New System

1. **Correct Rate Limiting**: Per-user limit of 100 req/min across all keys
2. **Higher Throughput**: Can use up to 100% of available quota
3. **Smart Batch Operations**: Distributes requests optimally
4. **Scalability**: Supports multiple keys per user
5. **Better Error Handling**: Knows which user hit limit
6. **Reduced Code Duplication**: Unified API client
7. **Configurable**: Dynamic rate limits per user
8. **Observable**: Better logging and monitoring

---

## Migration Path

### For Existing Single-Key Users

- Create entry in `sentinel_user_keys` for their existing key
- Create mapping in `sentinel_api_key_user_mapping`
- Migrate existing rate limit records with user_id

### For New Multi-Key Users

- Store multiple keys in `sentinel_user_keys`
- System automatically handles load balancing
- Single unified rate limit pool

---

## Risk Assessment

### Low Risk Changes

- Creating new tables (backward compatible)
- New utility functions
- New classes in shared package

### Medium Risk Changes

- Modifying `DatabaseRateLimiter` (affects bot + worker)
- Refactoring bot app (but it's isolated module)

### Mitigation

- Dual-run: Keep old system working while migrating
- Feature flags for new rate limiter
- Comprehensive testing before full migration

---

## Configuration Options

```typescript
interface RateLimitConfig {
  // Global limits
  defaultMaxRequestsPerWindow: number; // 100 for Torn API
  windowMs: number; // 60000 (1 minute)

  // Per-user overrides
  userLimits?: {
    [userId: string]: number; // Custom limit per user
  };

  // Safety features
  enableAutoCleanup: boolean;
  autoCleanupIntervalMs: number;
  logRateLimitDecisions: boolean;
}
```

---

## Testing Strategy

1. **Unit Tests**
   - Test rate limiter with mock data
   - Test batch handler distribution logic
   - Test key management functions

2. **Integration Tests**
   - Test with real Supabase
   - Test batch operation with multiple keys
   - Test user ID resolution

3. **Scenario Tests**
   - User with 1 key hitting limit
   - User with 3 keys distributing requests
   - Mixed batch of different request types

---

## Timeline Estimate

- Phase 1 (DB): ~1-2 hours
- Phase 2 (Rate Limiter): ~2-3 hours
- Phase 3 (Batch Handler): ~2-3 hours
- Phase 4 (User ID Resolution): ~1 hour
- Phase 5 (Consolidation): ~2-3 hours
- Testing & Documentation: ~2 hours

**Total: ~10-14 hours of development**

---

## References

- Torn City API Docs: https://api.torn.com/
- Current rate limiter: `packages/shared/src/rate-limiter.ts`
- Current API client: `packages/shared/src/torn.ts`
- Current usage: `apps/worker/src/services/torn-client.ts`
