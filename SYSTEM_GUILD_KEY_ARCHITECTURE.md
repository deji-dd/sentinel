# System vs Guild API Keys - Architecture Explanation

## The Problem We Solved

Your system has fundamentally different use cases for API keys:

1. **Personal/System Keys** (Worker)
   - Used by worker jobs running in background
   - Not accessible by regular users
   - Syncs personal data (user snapshots, training, etc.) and infrastructure (items, gyms)
   - Originally stored in `.env` as `TORN_API_KEY`

2. **Guild Keys** (Bot)
   - Provided by guild members
   - Each guild isolates its own keys via RLS
   - Used for guild-specific operations (verification, etc.)
   - Cannot access other guild's keys

3. **TT Module** (Shared Infrastructure)
   - Needs to sync 4000+ territories efficiently
   - Could use any available guild keys (not tied to specific guild)
   - Benefits from distributing load across multiple keys
   - But still tracks rate limits per USER who owns each key

The old system had everything as "user keys" which was confusing because:

- Bot keys and worker keys have completely different purposes
- RLS requirements are different (guild isolation vs system access)
- Batch operation strategies are different (can mix guild keys for TT, cannot for guild-specific ops)

## The Solution: Two Key Storage Tables

### 1. `sentinel_system_api_keys` (Worker)

**Purpose**: System-level API keys for infrastructure syncing

**Fields**:

```sql
id UUID PRIMARY KEY
user_id UUID              -- Always references auth.users
api_key_encrypted TEXT    -- AES-256-GCM encrypted
is_primary BOOLEAN        -- Default key for worker operations
key_type TEXT             -- 'personal' (env var) or 'system' (DB stored)
created_at TIMESTAMP      -- When key was added
last_used_at TIMESTAMP    -- Track usage
deleted_at TIMESTAMP      -- Soft delete
```

**RLS**: Service role only

- Workers need unrestricted access
- Cannot be accessed by regular authenticated users
- System admin only

**Usage**:

```typescript
// Get personal key from env var (backward compatible)
const key = await getSystemApiKey("personal");

// OR get a configured system key from database
const key = await getSystemApiKey("system");

// Get all system keys for batch operations
const keys = await getSystemApiKeys(userId);
```

**Workers Using These**:

- `user-data.ts` - Syncs your personal user snapshot
- `user-snapshot.ts` - Extended personal stats
- `training-recommendations.ts` - Personal training analysis
- `torn-items.ts` - Shared item database (infrastructure)
- `torn-gyms.ts` - Shared gym database (infrastructure)

### 2. `sentinel_guild_api_keys` (Bot)

**Purpose**: Guild-provided API keys for guild operations

**Fields**:

```sql
id UUID PRIMARY KEY
guild_id TEXT             -- Guild this key belongs to
user_id UUID              -- User who owns the key
api_key_encrypted TEXT    -- AES-256-GCM encrypted
is_primary BOOLEAN        -- Default key for guild operations
provided_by UUID          -- Discord user who provided this key
created_at TIMESTAMP
last_used_at TIMESTAMP
deleted_at TIMESTAMP
```

**RLS**: Guild-isolated

- Guild members can view/manage their guild's keys only
- Service role can do anything (for worker TT sync)
- Prevents key sharing between guilds

**Usage**:

```typescript
// Get guild's available keys (RLS enforced)
const keys = await getGuildApiKeys(supabase, guildId);

// Get primary key for guild
const key = await getPrimaryGuildApiKey(supabase, guildId);

// Store a new guild key
await storeGuildApiKey(supabase, guildId, apiKey, userId, discordUserId);
```

**Bot Operations Using These**:

- Verification module
- Guild-specific commands
- Any operation that says "use this guild's keys only"

### 3. `sentinel_api_key_user_mapping` (Core)

**Purpose**: Unified mapping for rate limiting (CRITICAL)

**Fields**:

```sql
api_key_hash TEXT PRIMARY KEY    -- SHA256 hash of key + pepper
user_id UUID                     -- User who owns this key
source TEXT                      -- 'system' or 'guild'
created_at TIMESTAMP
deleted_at TIMESTAMP
```

**Why This Matters**:

- Rate limiting doesn't care if key is from system or guild table
- It only cares: which USER owns this key
- All calls from a user count toward their 100 req/min limit
- Whether call comes from worker system key, guild key, or personal key - same limit applies

**Example**:

- User "deji" has personal key → maps to deji's user_id
- Alliance1 guild has key from user "member1" → maps to member1's user_id
- TT sync uses Alliance1's key → counts against member1's 100 req/min
- Alliance2 guild has key from user "other_guy" → different user_id entirely
- Different rate limit pools

## How Batch Operations Work Now

### TT Module Batch Strategy

For syncing 4000+ territories efficiently:

```typescript
// Worker (service role access)
const guildList = await getGuildsWithApiKeys(supabase);

for (const guild of guildList) {
  if (guild.hasTTModuleEnabled) {
    const guildKeys = await getGuildApiKeys(supabase, guild.id);

    // Use these guild members' keys for TT sync
    const results = await batchHandler.executeBatch(
      territoryIds,
      guildKeys,
      async (territoryId, apiKey) => {
        return await tornApi.get("/territory/{id}", {
          apiKey,
          pathParams: { id: territoryId },
        });
      },
    );

    // Each guild member's key is rate-limited per their own 100 req/min
    // But all requests are transparent to their rate limit
  }
}
```

**Key insight**:

- You're borrowing different users' rate limits
- Each user (owner of key) gets their own 100 req/min pool
- This is fine because they're USING the API (you're the worker performing the work)
- The actual Torn API only sees: user X made Y requests in their window

### Guild Operation Constraints

Guild-specific operations CANNOT mix keys:

```typescript
// ✅ CORRECT: Use only this guild's keys
const guildKeys = await getGuildApiKeys(supabase, guildId);
const results = await batchHandler.executeBatch(..., guildKeys, ...);

// ❌ WRONG: Cannot use keys from different guild
const key1 = await getGuildApiKeys(supabase, guild1Id);
const key2 = await getGuildApiKeys(supabase, guild2Id);
await batchHandler.executeBatch(..., [...key1, ...key2], ...);  // RLS prevents this
```

The RLS policy on `sentinel_guild_api_keys` enforces this:

```sql
CREATE POLICY "guild_view" ON sentinel_guild_api_keys
  FOR SELECT USING (
    auth.role() = 'service_role'::text
    OR guild_id IN (SELECT guild_id FROM user_guilds WHERE user_id = auth.uid())
  );
```

## Migration Path

### For Workers (Backward Compatible)

Old code still works:

```typescript
// Still works! Reads from TORN_API_KEY env var
import { getPersonalApiKey } from "../lib/api-keys.js";
const key = await getPersonalApiKey();
```

But underneath, it calls:

```typescript
export { getSystemApiKey as getPersonalApiKey };
```

So `getPersonalApiKey()` → `getSystemApiKey("personal")` → reads env var first, then falls back to DB

**No changes needed to workers for now!**

### For Bot

No changes needed - already uses guild isolation:

```typescript
// Bot already does this
const keys = await getGuildApiKeys(supabase, guildId);
```

Now uses new guild API keys table instead of hypothetical old structure.

## Rate Limiting Unified View

The `PerUserRateLimiter` doesn't change its logic - it still:

1. Receives an API key
2. Looks it up in `sentinel_api_key_user_mapping`
3. Gets the user_id
4. Counts requests against that user_id

Regardless of whether key came from:

- System table (key_type='personal' or 'system')
- Guild table (guild-specific)
- Environment variable TORN_API_KEY

**All** count toward same per-user limit.

## File Organization

### Worker Lib

- `system-api-keys.ts` - New: System key management
- `api-keys.ts` - Deprecated: Forwarding to system-api-keys (backward compat)

### Bot Lib

- `guild-api-keys.ts` - New: Guild key management

### Shared

- `per-user-rate-limiter.ts` - Updated: Maps both system + guild keys
- `batch-operation-handler.ts` - Updated: Works with both key sources
- `constants.ts` - Updated: References new table names
  - `SYSTEM_API_KEYS` (was USER_KEYS)
  - `GUILD_API_KEYS` (new)
  - `API_KEY_USER_MAPPING` (same, just renamed constant)

### Database

- Migration: Creates both tables + mapping table + indexes
- RLS: Properly isolates based on context (system vs guild)

## Key Design Principles

1. **Rate Limiting is Always Per-User**
   - Not per-key, not per-guild, per user
   - Mapping table enforces this

2. **Guild Isolation is Enforced**
   - RLS prevents cross-guild key access
   - Guild operations can only use their own keys

3. **System Access is Restricted**
   - Service role only for system keys
   - Allows worker to access system infrastructure

4. **TT Module is Flexible**
   - Can use guild keys (they'll be rate-limited per guild member)
   - Distributes load intelligently
   - Each user's 100 req/min is respected

5. **Backward Compatibility**
   - Old worker code still works
   - Env var TORN_API_KEY is still supported
   - Gradual migration path available

## Future Enhancements

Once stable, workers could:

1. **Personal Data Workers** (user-specific)
   - Stay as-is (use env var or system "personal" key)

2. **Infrastructure/TT Workers** (shared)
   - Pre-load all guild keys
   - Batch across them intelligently
   - Spread TT sync load across multiple users' rate limits
   - Reduce worker-specific key bottleneck

3. **Per-Guild Preferences**
   - Guilds could opt-in/out of TT module
   - Share keys for better throughput
   - Or keep isolated, reduce throughput

## Summary Table

| Aspect              | System Keys                | Guild Keys                |
| ------------------- | -------------------------- | ------------------------- |
| **Storage**         | `sentinel_system_api_keys` | `sentinel_guild_api_keys` |
| **Access**          | Service role only          | Guild members (RLS)       |
| **When Used**       | Worker jobs                | Bot commands              |
| **Cross-Guild**     | Not applicable             | Strictly isolated         |
| **Rate Limiting**   | Per-owner user             | Per-owner user            |
| **Backward Compat** | Via env var                | N/A                       |
| **Isolation Level** | System-wide                | Per-guild                 |
| **TT Module**       | Can use either             | Preferred for scale       |

This architecture gives you:
✅ Clear separation of concerns  
✅ Proper isolation boundaries  
✅ Flexible rate limit pooling via guild keys for TT  
✅ Backward compatibility with existing workers  
✅ Permission enforcement via RLS  
✅ Future-proof for additional modules
