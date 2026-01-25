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
PM2_APPS=("sentinel-worker" "sentinel-bot")

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

git fetch --quiet origin "${BRANCH}"
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse "origin/${BRANCH}")

if [[ "${LOCAL_SHA}" == "${REMOTE_SHA}" ]]; then
  echo "No updates on ${BRANCH}; exiting."
  exit 0
fi

echo "Pulling latest changes on ${BRANCH}..."
git pull --ff-only origin "${BRANCH}"

echo "Installing dependencies..."
pnpm install --frozen-lockfile --child-concurrency 1

echo "Building worker and bot..."
pnpm worker:build
pnpm bot:build

# Ensure logs directory exists
mkdir -p logs

echo "Ensuring PM2 processes are running..."
pm2 start "${REPO_DIR}/ecosystem.config.js" --env production >/dev/null 2>&1 || true

for app in "${PM2_APPS[@]}"; do
  if pm2 list | grep -q "\b${app}\b"; then
    echo "Reloading ${app}..."
    pm2 reload "${app}"
  else
    echo "Starting ${app} from ecosystem.config.js..."
    pm2 start "${REPO_DIR}/ecosystem.config.js" --only "${app}" --env production
  fi
done

echo "Deploy complete."
