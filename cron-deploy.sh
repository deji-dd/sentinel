#!/usr/bin/env bash
set -euo pipefail

# Simple lock to prevent overlapping cron runs
LOCKFILE="/tmp/sentinel-cron-deploy.lock"
exec 9>"${LOCKFILE}"
if ! flock -n 9; then
  echo "Another deploy is running; exiting."
  exit 0
fi
trap 'flock -u 9' EXIT

# Allow overriding repo directory via env var, default to hardcoded path
REPO_DIR="${SENTINEL_REPO_DIR:-/home/deji/repos/sentinel}"
BRANCH="main"
PNPM_HOME="${HOME}/.local/share/pnpm"
PATH="${PNPM_HOME}:${PATH}"

# Verify repo directory exists
if [[ ! -d "${REPO_DIR}" ]]; then
  echo "Error: Repository directory not found at ${REPO_DIR}"
  exit 1
fi

cd "${REPO_DIR}"

# Exit if local changes exist (avoid clobbering)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Local changes detected; aborting deploy."
  exit 1
fi

echo "Fetching latest from ${BRANCH}..."
git fetch --quiet origin "${BRANCH}" || { echo "ERROR: git fetch failed"; exit 1; }
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse "origin/${BRANCH}")

if [[ "${LOCAL_SHA}" == "${REMOTE_SHA}" ]]; then
  echo "No updates on ${BRANCH}; exiting."
  exit 0
fi

echo "Pulling latest changes on ${BRANCH}..."
git pull --ff-only origin "${BRANCH}" || { echo "ERROR: git pull failed"; exit 1; }

echo "Installing dependencies..."
pnpm install --frozen-lockfile --child-concurrency 1

echo "Building worker and bot..."
timeout 120 pnpm --filter shared build || { echo "ERROR: shared build failed or timed out"; exit 1; }
timeout 180 pnpm --filter worker build || { echo "ERROR: worker build failed or timed out"; exit 1; }
timeout 180 pnpm --filter bot build || { echo "ERROR: bot build failed or timed out"; exit 1; }

# Ensure logs directory exists
mkdir -p logs

# Rotate logs if they get large (compress and archive if >50MB)
for logfile in logs/*.log; do
  if [[ -f "${logfile}" ]] && [[ $(stat -f%z "${logfile}" 2>/dev/null || stat -c%s "${logfile}" 2>/dev/null) -gt 52428800 ]]; then
    echo "Rotating large log file: ${logfile}"
    gzip -c "${logfile}" > "${logfile}.$(date +%s).gz"
    > "${logfile}"  # Truncate the log file
  fi
done

echo "Restarting PM2 processes..."
# Kill PM2 daemon entirely to clear cached state (fixes ghost builds)
echo "Killing PM2 daemon to clear cache..."
pm2 kill >/dev/null 2>&1 || true

# Wait for PM2 to fully shut down
sleep 2

# Delete any lingering ecosystem state files
rm -f "${REPO_DIR}/.pm2/dump.pm2" "${REPO_DIR}/.pm2/module_conf.js" >/dev/null 2>&1 || true

# Start fresh with current ecosystem config (with 30s timeout)
echo "Starting processes from ecosystem.config.js..."
if timeout 30 pm2 start "${REPO_DIR}/ecosystem.config.js" --env production 2>&1; then
  echo "PM2 processes started successfully"
  
  # Save PM2 process list with timeout
  timeout 10 pm2 save >/dev/null 2>&1 || echo "Warning: PM2 save timed out"
  
  echo "Deploy complete."
else
  echo "ERROR: PM2 start timed out or failed after 30s"
  echo "Checking PM2 status..."
  pm2 status 2>&1 || true
  echo "Attempting to restart with --no-daemon flag..."
  timeout 20 pm2 start "${REPO_DIR}/ecosystem.config.js" --env production --no-daemon 2>&1 || true
  exit 1
fi
