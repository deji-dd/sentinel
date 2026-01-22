#!/bin/bash
# Sentinel Worker Deployment Script
# Checks for updates, rebuilds, and runs the worker
# Usage: bash setup.sh [--no-pull] [--no-rebuild] [--no-start]

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER_DIR="$REPO_ROOT/apps/worker"
BRANCH="${DEPLOY_BRANCH:-main}"
NO_PULL=false
NO_REBUILD=false
NO_START=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --no-pull) NO_PULL=true ;;
    --no-rebuild) NO_REBUILD=true ;;
    --no-start) NO_START=true ;;
  esac
done

echo "🚀 Sentinel Worker Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Navigate to repo root
cd "$REPO_ROOT"

# Check if git repo exists
if [ ! -d ".git" ]; then
  echo "❌ Error: Not a git repository"
  exit 1
fi

# Check for .env.local
if [ ! -f "$WORKER_DIR/.env.local" ]; then
  echo "📝 Creating .env.local from template..."
  if [ -f "$WORKER_DIR/.env.example" ]; then
    cp "$WORKER_DIR/.env.example" "$WORKER_DIR/.env.local"
    echo "⚠️  Please edit worker/.env.local with your credentials:"
    echo "   - NEXT_PUBLIC_SUPABASE_URL"
    echo "   - SUPABASE_SERVICE_ROLE_KEY"
    echo "   - ENCRYPTION_KEY"
    exit 1
  else
    echo "❌ Error: .env.example not found"
    exit 1
  fi
fi

# Fetch updates from remote
if [ "$NO_PULL" = false ]; then
  echo ""
  echo "🔍 Checking for updates on $BRANCH..."
  
  # Fetch latest from remote
  git fetch origin "$BRANCH" 2>/dev/null || {
    echo "⚠️  Warning: Could not fetch from remote (continuing anyway)"
  }
  
  # Get current and remote commit hashes
  LOCAL_HASH=$(git rev-parse HEAD)
  REMOTE_HASH=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "$LOCAL_HASH")
  
  if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    echo "📥 Updates found! Pulling changes..."
    
    # Check for uncommitted changes
    if [ -n "$(git status --porcelain)" ]; then
      echo "⚠️  Warning: Uncommitted changes detected. Stashing..."
      git stash push -m "Auto-stash before deployment $(date +%Y-%m-%d_%H:%M:%S)"
    fi
    
    # Pull latest changes
    git pull origin "$BRANCH" || {
      echo "❌ Error: Failed to pull updates"
      exit 1
    }
    
    echo "✅ Repository updated to latest version"
  else
    echo "✅ Already up to date"
  fi
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile || {
  echo "⚠️  Warning: frozen-lockfile failed, trying regular install..."
  pnpm install
}

# Build worker
if [ "$NO_REBUILD" = false ]; then
  echo ""
  echo "🔨 Building worker..."
  cd "$WORKER_DIR"
  pnpm build || {
    echo "❌ Error: Build failed"
    exit 1
  }
  echo "✅ Build complete"
fi

# Kill existing worker process if running
if [ "$NO_START" = false ]; then
  echo ""
  echo "🔄 Managing worker process..."
  
  # Kill existing process
  pkill -f "node dist/index.js" 2>/dev/null && echo "   Stopped existing worker" || echo "   No existing worker running"
  
  # Start worker in background
  echo "   Starting worker..."
  cd "$WORKER_DIR"
  nohup pnpm start > logs/worker.log 2>&1 &
  WORKER_PID=$!
  
  # Wait a moment and check if it's still running
  sleep 2
  if ps -p $WORKER_PID > /dev/null; then
    echo "✅ Worker started (PID: $WORKER_PID)"
    echo "   Logs: $WORKER_DIR/logs/worker.log"
  else
    echo "❌ Error: Worker failed to start"
    echo "   Check logs: $WORKER_DIR/logs/worker.log"
    exit 1
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment complete!"
echo ""
echo "Commands:"
echo "  View logs:    tail -f $WORKER_DIR/logs/worker.log"
echo "  Stop worker:  pkill -f 'node dist/index.js'"
echo "  Restart:      bash $WORKER_DIR/setup.sh"

