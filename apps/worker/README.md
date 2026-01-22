# Sentinel Worker

Background job worker for Sentinel. Handles scheduled tasks like syncing user data from external APIs.

## Architecture

### Scalability Design

The worker is designed to be highly scalable:

- **Modular Workers**: Each background job is a separate worker file (e.g., `src/workers/sync-users.ts`)
- **Centralized Sync Framework**: `src/lib/sync.ts` provides a common interface for all workers
- **Lock Mechanism**: Prevents overlapping execution of long-running jobs
- **Easy to Extend**: Add new workers by creating a new worker file and importing it in `src/index.ts`

### Components

- **Sync Framework** (`src/lib/sync.ts`): Provides the `executeSync()` function with:
  - Lock mechanism to prevent concurrent execution
  - Automatic timeout handling (force unlock after 30+ seconds)
  - Logging and duration tracking

- **Supabase Service** (`src/lib/supabase.ts`): Database operations
  - Fetch user keys with encrypted API keys
  - Upsert user data with name and player_id

- **Encryption** (`src/lib/encryption.ts`): AES-256-GCM decryption
  - Decrypts stored API keys using `ENCRYPTION_KEY` environment variable

- **Torn API Service** (`src/services/torn.ts`): External API calls
  - Fetches user profile data from Torn API
  - 10-second timeout per request

## Setup

### 1. Install Dependencies

```bash
cd worker
pnpm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (for server-side operations)
- `ENCRYPTION_KEY`: 32-byte hex string for AES-256 decryption

### 3. Build & Run

**Development** (with auto-reload):
```bash
pnpm dev
```

**Production** (compile and run):
```bash
pnpm build
pnpm start
```

**Run specific worker**:
```bash
pnpm start:sync-users
```

## Workers

### User Sync Worker

**File**: `src/workers/sync-users.ts`

**Schedule**: Every hour (0 * * * *)

**Process**:
1. Fetches all user keys from `user_keys` table
2. Decrypts each API key using `ENCRYPTION_KEY`
3. Calls Torn API for each user to fetch profile data
4. Upserts `user_data` table with:
   - `user_id`: matches on this
   - `name`: user's display name
   - `player_id`: user's Torn ID

**Safety**:
- 30-second timeout: If sync takes longer, next run will force-unlock and start fresh
- Overlap prevention: If previous sync still running, new cron tick skips
- Per-user error handling: One failed API call doesn't block others

## Adding New Workers

### 1. Create Worker File

Create `src/workers/my-worker.ts`:

```typescript
import cron from "node-cron";
import { executeSync } from "../lib/sync.js";

async function myWorkerHandler(): Promise<void> {
  // Do work here
  console.log("Worker executing...");
}

export function startMyWorker(): void {
  console.log("Starting my worker...");

  cron.schedule("*/5 * * * *", async () => {
    try {
      await executeSync({
        name: "my-worker",
        timeout: 30000, // 30 seconds
        handler: myWorkerHandler,
      });
    } catch (error) {
      console.error("Worker failed:", error);
    }
  });
}

// Run if main
if (import.meta.url === `file://${process.argv[1]}`) {
  startMyWorker();
}
```

### 2. Import in Main

Edit `src/index.ts`:

```typescript
import { startMyWorker } from "./workers/my-worker.js";

function startAllWorkers(): void {
  console.log("🚀 Starting Sentinel workers...");

  try {
    startUserSyncWorker();
    startMyWorker(); // Add this
    
    console.log("✅ All workers started successfully");
  } catch (error) {
    console.error("❌ Failed to start workers:", error);
    process.exit(1);
  }
}
```

## Cron Patterns

Use standard cron expressions:

- `0 * * * *` - Every hour
- `*/5 * * * *` - Every 5 minutes
- `0 9 * * 1-5` - 9 AM on weekdays
- `0 0 * * *` - Daily at midnight

[Cron format reference](https://crontab.guru/)

## Monitoring

### Logs

The worker outputs structured logs:

```
[sync-users] Starting sync...
Found 5 user keys to sync
Fetched data for user 1: Username (12345)
[sync-users] Sync completed in 2341ms
```

### Lock Mechanism

If a sync is running:
```
[sync-users] Sync already in progress. Skipping to prevent overlap.
```

If a sync exceeds 30 seconds:
```
[sync-users] Previous sync exceeded timeout (31000ms > 30000ms). Force unlocking.
```

## Database Schema

### user_keys Table

```sql
CREATE TABLE user_keys (
  id UUID PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  api_key TEXT NOT NULL, -- AES-256-GCM encrypted
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### user_data Table

```sql
CREATE TABLE user_data (
  user_id VARCHAR PRIMARY KEY,
  name VARCHAR,
  player_id INTEGER,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Deployment

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

CMD ["pnpm", "start"]
```

### Environment

Set environment variables in your deployment platform:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`

## Troubleshooting

**"ENCRYPTION_KEY environment variable is not set"**
- Set `ENCRYPTION_KEY` in `.env.local` or your deployment platform

**"Failed to fetch user keys"**
- Verify `SUPABASE_SERVICE_ROLE_KEY` has database read access
- Check Supabase connection and `user_keys` table exists

**"Torn API returned status 401"**
- API key is invalid or expired
- Verify encryption/decryption is working correctly

**Sync taking too long**
- Check Torn API response times (often slow during peak hours)
- May need to increase timeout if legitimate workload grows

## License

ISC
