# TT Module - Performance Tuning Guide

## Current Baseline (Single System Key)

With the current single system API key configuration:

### Territory State Sync Worker
- **Territories to sync**: ~4,000 TTs
- **Batch size**: 50 per request
- **Requests per cycle**: 80 requests (4000 ÷ 50)
- **Cadence**: 96 seconds (calculated: 80 req × 60s ÷ (1 key × 50 req/min))
- **Rate limit utilization**: 50 requests per minute per key
- **Safety margin**: 50% (Torn limit is 100 req/min, we use 50)

### Formula for Dynamic Cadence
```
cadence = ceil((territory_count ÷ batch_size) × 60) ÷ (num_keys × req_per_min_limit)
cadence = ceil((4000 ÷ 50) × 60) ÷ (1 × 50)
cadence = ceil(80 × 60) ÷ 50
cadence = 4800 ÷ 50
cadence = 96 seconds
```

## Performance Tuning Strategies

### Strategy 1: Multi-Key Pooling (Recommended for Scaling)

**Goal**: Distribute API load across multiple guild API keys

**Implementation**:
1. Create a pool of guild API keys in `sentinel_guild_api_keys` table
2. Round-robin through keys for territory state sync calls
3. Dynamic cadence automatically recalculates based on available keys

**Metrics with 2 keys**:
```
cadence = ceil(80 × 60) ÷ (2 × 50) = 48 seconds
- Each key: 40 requests per cycle
- Total throughput: 80 requests per sync
```

**Metrics with 4 keys**:
```
cadence = ceil(80 × 60) ÷ (4 × 50) = 24 seconds
- Each key: 20 requests per cycle
- Total throughput: 80 requests per sync
```

**To implement**:
- Update `calculateCadence()` in territory-state-sync.ts to query guild key pool
- Add key round-robin tracker for balanced distribution
- Monitor per-key rate limit via `sentinel_rate_limit_requests_per_user` table

### Strategy 2: Territorial Segmentation (For Faster Detection)

**Goal**: Reduce batch size for specific high-value territories

**Implementation**:
1. Identify "priority" territories (faction homelands, high activity regions)
2. Sync priority territories every 30 seconds
3. Sync remaining territories every 120 seconds

**Metrics overhead**:
```
Priority TTs (e.g., 200): 4 requests × 30s cadence = 8 requests/min
Regular TTs (3800): 76 requests × 120s cadence = 38 requests/min
Total: ~46 requests/min (within 50 per-key limit)
```

**To implement**:
- Add `priority` column to `sentinel_territory_blueprint` table
- Create separate sync worker for priority territories
- Store priority list in configuration (dynamic via config command)

### Strategy 3: Lazy Sync with Event Triggering (Advanced)

**Goal**: Only sync territories affected by active wars

**Implementation**:
1. Track which territories have active wars in `is_warring` flag
2. Only sync warring and recently-warring territories every 15s
3. Sync non-warring territories every 5 minutes (slow cycle)

**Metrics**:
```
In conflict zone (e.g., 50 warring TTs): 1 request × 15s = 4 requests/min
Stable zone (3950 TTs): 79 requests × 300s = 15.8 requests/min
Total: ~20 requests/min (1/3 of current usage)
```

**To implement**:
- Modify war-ledger-sync to update `is_warring` flag
- Create separate `handleWarringTerritories()` and `handleStableTerritories()` in territory-state-sync
- Add `last_sync_time` column to track stale data

### Strategy 4: Batch Request Optimization (Quick Win)

**Goal**: Reduce size of batch payloads without sacrificing coverage

**Current**: 50 territories per request
**Recommended**: 100 territories per request (Torn API supports this)

**Metrics**:
```
Territories: 4000
Batch size: 100 (vs. current 50)
Requests per cycle: 40 (vs. current 80) - 50% reduction
Cadence with 1 key: 48 seconds (vs. current 96) - 2x faster
```

**To implement**:
- Change `batchSize` constant in territory-state-sync.ts from 50 to 100
- Test with Torn API to verify 100-TT requests work reliably
- Monitor response times for larger payloads

## Monitoring & Alerting

### Key Metrics to Track

1. **Per-Key Rate Limit Usage** (via `sentinel_rate_limit_requests_per_user` table)
   ```sql
   SELECT api_key_hash, COUNT(*) as requests_this_minute
   FROM sentinel_rate_limit_requests_per_user
   WHERE requested_at > NOW() - INTERVAL '1 minute'
   GROUP BY api_key_hash;
   ```

2. **Sync Duration** (from logger output)
   ```
   [Territory State Sync] Synced 4000 territories, X changes in YYYms
   ```
   - Yellow flag: >10000ms (indicates slow API or network)
   - Red flag: >20000ms (approaching next scheduled sync)

3. **War Ledger Churn** (new wars per cycle)
   ```
   [War Ledger Sync] Found X new wars, Y updated
   ```
   - Track war lifecycle (start/end/victor assignment)

4. **Notification Throughput** (from dispatcher logging)
   ```
   [TT Dispatcher] Processing notifications for N guilds
   [TT Dispatcher] Sent notification for TT_CODE to guild GUILD_ID
   ```

### Alerts to Configure

```
IF rate_limit_warnings > 3 per day THEN
  -> Reduce cadence or add more keys

IF sync_duration > 15000ms THEN
  -> Consider batch optimization or key pooling

IF warfare_changes > 100 per hour THEN
  -> Consider priority territory segmentation
```

## Recommendation Path

### Phase 1: Baseline (Current - 96s cadence, 1 key)
- ✅ Monitor for 1 week
- Track actual API usage vs. theoretical limit
- Identify any rate limit warnings

### Phase 2: Quick Win (40-50 req/min via 100-term batches)
- Increase batch size from 50 to 100
- Expected cadence: 48 seconds
- Low risk, high impact

### Phase 3: Multi-Key Pooling (If you have 2+ guild keys)
- Implement round-robin key distribution
- Expected cadence: 24-48 seconds (depending on key count)
- Automatic via dynamic formula - no code changes needed

### Phase 4: Territory Segmentation (If war frequency > 50/hour)
- Split sync into priority + regular cycles
- 30s for warring territories, 120s for stable
- More complex but highest throughput gain

## Testing Checklist

- [ ] Build worker without errors
- [ ] Build bot without errors
- [ ] Local database tests
  - [ ] Verify dynamic cadence calculation for various key counts
  - [ ] Test territory state sync with mock war data
  - [ ] Verify notification filtering (all/territories/factions/combined)
- [ ] Rate limit tracking
  - [ ] Verify requests recorded in `sentinel_rate_limit_requests_per_user`
  - [ ] Verify rate limiter respects 50 req/min per key
- [ ] Notification delivery
  - [ ] Test webhook POST to bot /send-guild-message
  - [ ] Verify embeds render correctly in Discord
  - [ ] Test with different notification_type configs
- [ ] Production readiness
  - [ ] Monitor for 24 hours with production system key
  - [ ] Verify no API blocks or rate limit hits
  - [ ] Verify TT changes detected and notified

## Cost Baseline

Assuming Torn API is free tier:
- **Current**: 96 requests per sync every 96 seconds = 60 requests/hour
- **With 100-batch**: 40 requests per sync every 48 seconds = 50 requests/hour
- **With 2 keys + 100-batch**: 40 requests per sync every 48 seconds distributed
- **With segmentation**: 20 requests/hour (in peacetime) → 200 requests/hour (in active warfare)

No cost implications - just API request efficiency.
