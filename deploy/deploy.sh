#!/usr/bin/env bash
# Builds and restarts Akanksha AI on the server. Run from the repository root, as the user that
# owns the checkout, AFTER the code has been updated:
#
#   git fetch origin && git checkout main && git reset --hard origin/main
#   bash deploy/deploy.sh
#
# The CI/CD workflow runs exactly that on the self-hosted runner; doing it by hand over SSH gives
# the same result. .env is never touched: it lives only on the server (deploy/env.production.example
# lists what it must contain).
set -euo pipefail

APP_NAME="akanksha-ai"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { printf '\n==> %s\n' "$*"; }
# Reads one key from .env without printing or sourcing the file.
env_value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '[:space:]"' | tr -d "'" || true; }

[ -f .env ] || { echo ".env is missing. Create it from deploy/env.production.example first."; exit 1; }
PORT="$(env_value PORT)"; PORT="${PORT:-5080}"
BASE_PATH="$(env_value BASE_PATH)"; BASE_PATH="${BASE_PATH:-/akanksha-ai/}"
[ "$(env_value SERVE_CLIENT)" = "1" ] || { echo "SERVE_CLIENT=1 is not set in .env: nothing would serve the page."; exit 1; }
[ -n "$(env_value GOOGLE_CLIENT_ID)" ] && [ -n "$(env_value GOOGLE_CLIENT_SECRET)" ] || {
  echo "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env. Without them anyone could sign in by typing an email; refusing to deploy."
  exit 1
}

say "Deploying $(git rev-parse --short HEAD) ($(git log -1 --format=%s | cut -c1-70))"
node -v

say "Installing server dependencies"
npm ci --prefix server --omit=dev --no-audit --no-fund

say "Installing client dependencies"
npm ci --prefix client --no-audit --no-fund

# Build beside the live files and swap at the end, so the site never serves a half-written build,
# and a failed build leaves the running version untouched.
say "Building the client for ${BASE_PATH}"
rm -rf client/dist.next
(cd client && VITE_BASE_PATH="$BASE_PATH" npx vite build --outDir dist.next --emptyOutDir)
[ -f client/dist.next/index.html ] || { echo "The build produced no index.html."; exit 1; }

# Applies only the numbered files in server/migrations/ that the AI database has not seen yet.
say "Applying database migrations"
npm run migrate --prefix server

say "Publishing the new client build"
rm -rf client/dist.prev
[ -d client/dist ] && mv client/dist client/dist.prev
mv client/dist.next client/dist

say "Restarting $APP_NAME"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
elif curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  # Something already serves the port, but not under this user's PM2. Starting a second copy
  # would only fight it for the port.
  echo "Port ${PORT} is in use, but PM2 for $(whoami) has no \"$APP_NAME\" process."
  echo "Another app may own that port, or this app runs under another user's PM2."
  exit 1
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

say "Checking health on port ${PORT}"
for _ in $(seq 1 30); do
  if BODY="$(curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)" && echo "$BODY" | grep -q '"app":"Akanksha_AI"'; then
    echo "$BODY"
    curl -fsS -m 20 "http://127.0.0.1:${PORT}/api/health/db" >/dev/null || { echo "The server is up but cannot reach the database (/api/health/db)."; exit 1; }
    curl -fsS -m 5 "http://127.0.0.1:${PORT}/" | grep -q '<div id="root">' || { echo "The server is up but does not serve the client page."; exit 1; }
    say "Deployed $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "The server did not report healthy within 30 seconds."
curl -sS -m 5 "http://127.0.0.1:${PORT}/api/health" || true
pm2 logs "$APP_NAME" --lines 40 --nostream || true
exit 1
