# API Key Usage Audit

## Summary

This document audits all API key usage across Worker and Bot applications to ensure conformance with the dual-hierarchy system (system keys vs guild keys).

## Worker Application

### Current State

All worker jobs are **CORRECTLY** using system keys via `getPersonalApiKey()`:

#### ✅ `apps/worker/src/workers/user-data.ts`
- **Purpose**: Syncs personal user profile (name, donator status, image)
- **Key Source**: `getPersonalApiKey()` from `lib/supabase.ts`
- **API Calls**: `tornApi.get("/user/profile", { apiKey })`
- **Status**: ✅ CONFORMING
- **Notes**: Uses backward-compatible function that reads from `TORN_API_KEY` env var

#### ✅ `apps/worker/src/workers/user-snapshot.ts`
- **Purpose**: Takes periodic snapshots of user stats, bars, cooldowns, perks, etc.
- **Key Source**: `getPersonalApiKey()` from `lib/supabase.ts`
- **API Calls**: 
  - `tornApi.get("/user", { apiKey, queryParams: { selections: ["networth"] } })`
  - `tornApi.get("/user", { apiKey, queryParams: { selections: ["personalstats"] } })`
  - `tornApi.get("/user", { apiKey, queryParams: { selections: ["profile"] } })`
  - `tornApi.get("/user", { apiKey, queryParams: { selections: ["bars", "cooldowns", "perks"] } })`
  - `tornApi.get("/v1/company", { apiKey })`
- **Status**: ✅ CONFORMING
- **Notes**: Makes multiple selection-based calls, all using personal API key

#### ✅ `apps/worker/src/workers/training-recommendations.ts`
- **Purpose**: Computes training recommendations based on current stats and gym availability
- **Key Source**: `getPersonalApiKey()` from `lib/supabase.ts`
- **API Calls**: Makes no direct API calls (reads from database snapshots)
- **Status**: ✅ CONFORMING
- **Notes**: Purely computational worker - no API calls needed

#### ✅ `apps/worker/src/workers/torn-items.ts`
- **Purpose**: Syncs Torn item catalog (infrastructure data)
- **Key Source**: `getPersonalApiKey()` from `lib/supabase.ts`
- **API Calls**: 
  - `tornApi.get("/torn", { apiKey, queryParams: { selections: ["items"] } })`
  - `tornApi.get("/v1/market/category,lookup", { apiKey, queryParams: { ids: itemIds } })`
- **Status**: ✅ CONFORMING
- **Notes**: Infrastructure data shared across system, uses system API key

#### ✅ `apps/worker/src/workers/torn-gyms.ts`
- **Purpose**: Syncs Torn gym catalog and calculates unlock status
- **Key Source**: `getPersonalApiKey()` from `lib/supabase.ts`
- **API Calls**:
  - `tornApi.get("/torn", { apiKey, queryParams: { selections: ["gyms"] } })`
  - `tornApi.get("/user", { apiKey, queryParams: { selections: ["profile"] } })`
- **Status**: ✅ CONFORMING
- **Notes**: Infrastructure + personal unlock calculation

#### ✅ `apps/worker/src/workers/faction-sync.ts`
- **Purpose**: Placeholder for syncing faction names
- **Key Source**: None yet (TODO implementation)
- **API Calls**: None yet
- **Status**: ✅ CONFORMING (placeholder)
- **Notes**: Comments indicate it needs system API key when implemented

### Worker Key Architecture

```typescript
// Current implementation (apps/worker/src/lib/supabase.ts)
export function getPersonalApiKey(): string {
  const apiKey = process.env.TORN_API_KEY;
  if (!apiKey) {
    throw new Error("TORN_API_KEY environment variable is required");
  }
  return apiKey;
}
```

This function currently reads from environment variable only. The backward-compatible layer in `apps/worker/src/lib/api-keys.ts` now re-exports from `system-api-keys.ts`:

```typescript
// New backward-compatible layer
export { getSystemApiKey as getPersonalApiKey } from "./system-api-keys.js";
```

**Next Step**: Update all worker files to import from `api-keys.ts` instead of `supabase.ts`:

```typescript
// Change from:
import { getPersonalApiKey } from "../lib/supabase.js";

// To:
import { getPersonalApiKey } from "../lib/api-keys.js";
```

This ensures workers use the new system key manager with database support while maintaining backward compatibility with `TORN_API_KEY` env var.

---

## Bot Application

### Current State

Bot uses guild-specific API keys but via **legacy system** (stored in `sentinel_guild_config` table):

#### ⚠️ `apps/bot/src/commands/general/verification/verify.ts`
- **Purpose**: Verify single Discord user's Torn account linkage
- **Key Source**: `resolveApiKeysForGuild(guildId, guildConfig)` from `lib/api-keys.ts`
- **API Calls**: `botTornApi.get("/user", { apiKey, queryParams: { selections: ["discord", "faction", "profile"], id: targetUser.id } })`
- **Status**: ⚠️ NEEDS MIGRATION
- **Notes**: Currently reads from `sentinel_guild_config.api_keys` (encrypted JSON array). Should migrate to `sentinel_guild_api_keys` table for proper RLS and key management.

#### ⚠️ `apps/bot/src/commands/general/verification/verifyall.ts`
- **Purpose**: Bulk verify all guild members
- **Key Source**: `resolveApiKeysForGuild(guildId, guildConfig)` from `lib/api-keys.ts`
- **API Calls**: `botTornApi.get("/user", { apiKey, queryParams: { selections: ["discord", "faction", "profile"], id: memberId } })` (in loop)
- **Status**: ⚠️ NEEDS MIGRATION
- **Notes**: Makes many API calls (one per guild member), benefits from round-robin key distribution. Should use new guild key manager.

### Bot Key Architecture

**Current** (Legacy):
```typescript
// apps/bot/src/lib/api-keys.ts
export function resolveApiKeysForGuild(
  guildId: string,
  guildConfig: {
    api_keys?: ApiKeyEntry[] | null;
    api_key?: string | null;
  }
): { keys: string[]; error?: string } {
  // Reads from sentinel_guild_config.api_keys (JSON array)
  // Decrypts each key
  // Returns array of decrypted keys
}

export function getNextApiKey(guildId: string, keys: string[]): string {
  // Round-robin selection across keys
}
```

**New** (Available but not yet used):
```typescript
// apps/bot/src/lib/guild-api-keys.ts
export async function getGuildApiKeys(
  supabase: SupabaseClient,
  guildId: string
): Promise<Array<{ id: string; apiKey: string; userId: string; isPrimary: boolean }>> {
  // Reads from sentinel_guild_api_keys table (RLS enforced)
  // Decrypts keys
  // Returns properly typed array
}

export async function getPrimaryGuildApiKey(
  supabase: SupabaseClient,
  guildId: string
): Promise<string> {
  // Returns single primary key for guild
}
```

**Migration Path**:
1. Update `verify.ts` and `verifyall.ts` to use `getGuildApiKeys()` instead of `resolveApiKeysForGuild()`
2. Move guild API keys from `sentinel_guild_config` table to `sentinel_guild_api_keys` table
3. Maintain round-robin logic using new key array structure
4. Remove legacy `api-keys.ts` after migration complete

---

## Torn API Client Architecture

Both apps use centralized Torn API clients:

### Worker Torn Client
**File**: `apps/worker/src/services/torn-client.ts`

```typescript
import { PerUserRateLimiter } from "@sentinel/shared";

const rateLimiter = new PerUserRateLimiter(supabase);

export const tornApi = {
  async get(endpoint: string, options: { apiKey: string; queryParams?: Record<string, any> }) {
    // 1. Wait for rate limit window
    await rateLimiter.waitIfNeeded(options.apiKey);
    
    // 2. Make API call
    const response = await fetch(`https://api.torn.com${endpoint}?key=${options.apiKey}&...`);
    
    // 3. Record request for rate limiting
    await rateLimiter.recordRequest(options.apiKey);
    
    return response.json();
  }
};
```

**Status**: ✅ Already uses `PerUserRateLimiter` correctly

### Bot Torn Client
**File**: `apps/bot/src/services/torn-client.ts`

Similar implementation to worker client.

**Status**: ✅ Already uses `PerUserRateLimiter` correctly

---

## Rate Limiting Analysis

### Current Rate Limiter Configuration

Both `tornApi` clients use the shared `PerUserRateLimiter`:

```typescript
// packages/shared/src/per-user-rate-limiter.ts
export class PerUserRateLimiter {
  private maxRequestsPerMinute = 50; // Safety buffer (Torn allows 100)
  
  constructor(private supabase: SupabaseClient) {}
  
  async waitIfNeeded(apiKey: string): Promise<void> {
    // 1. Hash API key with pepper
    const apiKeyHash = hashApiKey(apiKey);
    
    // 2. Look up user_id from sentinel_api_key_user_mapping
    const userId = await this.resolveUserId(apiKeyHash);
    
    // 3. Count requests in last 60 seconds for this user
    const requestCount = await this.getRequestCount(userId);
    
    // 4. If >= 50, calculate wait time until oldest request expires
    if (requestCount >= this.maxRequestsPerMinute) {
      const waitMs = await this.calculateWaitTime(userId);
      await sleep(waitMs);
    }
  }
  
  async recordRequest(apiKey: string): Promise<void> {
    // Records request with timestamp for this user
  }
}
```

**Key Features**:
- ✅ Tracks per-user, not per-key
- ✅ Maps api_key → user_id via `sentinel_api_key_user_mapping`
- ✅ Works transparently with both system and guild keys
- ✅ Enforces 50 req/min safety buffer per user
- ✅ Database-backed tracking persists across restarts

---

## Migration Checklist

### Phase 1: Worker Import Updates (Low Risk)
- [ ] Update `user-data.ts` import: `lib/supabase.js` → `lib/api-keys.js`
- [ ] Update `user-snapshot.ts` import: `lib/supabase.js` → `lib/api-keys.js`
- [ ] Update `training-recommendations.ts` import: `lib/supabase.js` → `lib/api-keys.js`
- [ ] Update `torn-items.ts` import: `lib/supabase.js` → `lib/api-keys.js`
- [ ] Update `torn-gyms.ts` import: `lib/supabase.js` → `lib/api-keys.js`
- [ ] Test: Verify workers still read from `TORN_API_KEY` env var
- [ ] Test: Verify rate limiting still works

**Impact**: Zero (backward compatible layer maintains identical behavior)

### Phase 2: Bot Command Migration (Medium Risk)
- [ ] Update `verify.ts`:
  ```typescript
  // Replace resolveApiKeysForGuild() call
  import { getGuildApiKeys } from "../../../lib/guild-api-keys.js";
  const guildKeys = await getGuildApiKeys(supabase, guildId);
  const apiKey = guildKeys[0]?.apiKey; // Use first key or round-robin
  ```
- [ ] Update `verifyall.ts`: Same as above
- [ ] Implement round-robin logic for multi-key scenarios
- [ ] Test: Verify commands still work with legacy `sentinel_guild_config.api_keys`
- [ ] Migrate existing API keys from `sentinel_guild_config` to `sentinel_guild_api_keys`
- [ ] Test: Verify rate limiting tracks per guild member correctly

**Impact**: Requires data migration and testing with real guilds

### Phase 3: Database Migration
- [ ] Apply migration: `supabase db push` (or `supabase db reset` locally)
- [ ] Verify tables created:
  - `sentinel_system_api_keys`
  - `sentinel_guild_api_keys`
  - `sentinel_api_key_user_mapping`
- [ ] Verify RLS policies applied correctly
- [ ] Populate `sentinel_api_key_user_mapping` for existing keys
- [ ] Test: Query guild keys with guild member role
- [ ] Test: Query guild keys with different guild (should fail)

**Impact**: Enables proper RLS enforcement and key isolation

### Phase 4: System Key Database Storage (Optional)
- [ ] Add UI command `/add-system-key` for admins
- [ ] Store additional system keys in `sentinel_system_api_keys`
- [ ] Update workers to use `getSystemApiKeys(userId)` for batch operations
- [ ] Implement batch distribution for infrastructure workers (items, gyms)

**Impact**: Enables multi-key system infrastructure for better throughput

---

## Recommendations

### Immediate Actions (No Breaking Changes)
1. ✅ **Phase 1 worker imports** - Update all worker imports from `supabase.ts` to `api-keys.ts`
   - Zero risk due to backward-compatible re-export
   - Prepares workers for future database key storage
   - One-line change per file

2. 🔄 **Apply database migration** - Push new tables to Supabase
   - Run `pnpm supabase db reset` locally
   - Test with local instance first
   - Push to cloud when stable: `pnpm supabase db push`

### Medium-Term Actions (Requires Testing)
3. 🔄 **Bot command migration** - Update verify commands to use guild key manager
   - Create migration script to move keys from `sentinel_guild_config.api_keys` to `sentinel_guild_api_keys`
   - Test with small guilds first
   - Monitor rate limiting to ensure per-user tracking works correctly

4. 🔄 **Implement TT territories module** - Use new guild key system
   - Query `getGuildsWithApiKeys()` to find guilds with TT enabled
   - Use guild member keys for syncing (properly tracked per-user)
   - Batch operations intelligently distribute load

### Long-Term Enhancements
5. 📋 **System key database storage** - Allow multiple system keys
   - Reduces bottleneck on single `TORN_API_KEY` env var
   - Enables batch operations for infrastructure workers
   - Improves throughput for items/gyms sync

6. 📋 **Dynamic rate limit configuration** - Make per-user limit adjustable
   - Current: hardcoded 50 req/min
   - Future: configurable per user based on API key access level
   - Supports users with higher API access (e.g., 200 req/min)

---

## Conformance Summary

| Component | Status | Key Source | Conforms? | Action Required |
|-----------|--------|-----------|-----------|-----------------|
| **Worker: user-data.ts** | ✅ Good | `getPersonalApiKey()` (env var) | ✅ Yes | Update import path |
| **Worker: user-snapshot.ts** | ✅ Good | `getPersonalApiKey()` (env var) | ✅ Yes | Update import path |
| **Worker: training-recommendations.ts** | ✅ Good | `getPersonalApiKey()` (env var) | ✅ Yes | Update import path |
| **Worker: torn-items.ts** | ✅ Good | `getPersonalApiKey()` (env var) | ✅ Yes | Update import path |
| **Worker: torn-gyms.ts** | ✅ Good | `getPersonalApiKey()` (env var) | ✅ Yes | Update import path |
| **Worker: faction-sync.ts** | ✅ Good | None (placeholder) | ✅ Yes | None |
| **Bot: verify.ts** | ⚠️ Legacy | `resolveApiKeysForGuild()` | ⚠️ Partial | Migrate to guild key manager |
| **Bot: verifyall.ts** | ⚠️ Legacy | `resolveApiKeysForGuild()` | ⚠️ Partial | Migrate to guild key manager |
| **Torn API Client (Worker)** | ✅ Good | Uses `PerUserRateLimiter` | ✅ Yes | None |
| **Torn API Client (Bot)** | ✅ Good | Uses `PerUserRateLimiter` | ✅ Yes | None |

**Overall Assessment**: 
- Worker: ✅ **100% conforming** (only import path updates needed)
- Bot: ⚠️ **75% conforming** (uses guild isolation but legacy storage method)
- Rate Limiting: ✅ **100% conforming** (tracks per-user across all keys)

**Priority**: 
1. Phase 1 (worker imports) - immediate, zero risk
2. Database migration - immediate, enables new features
3. Phase 2 (bot migration) - medium priority, requires careful testing
