#!/usr/bin/env bash
# Auto-Deploy für den Yamamoto-Bot (läuft per systemd-Timer, siehe README). Fasst nur den eigenen
# pm2-Prozess „yamamoto-bot“ an – andere Bots auf derselben VM bleiben unberührt.
set -euo pipefail

APP_DIR="/home/ubuntu/Yamamoto-Bot"
PM2_NAME="yamamoto-bot"
STATE_DIR="/home/ubuntu/.local/state/yamamoto-bot"
STATE_FILE="$STATE_DIR/deployed-commit"
LOCK_FILE="/home/ubuntu/.cache/yamamoto-bot-deploy.lock"

mkdir -p "$STATE_DIR" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cd "$APP_DIR"
git fetch --quiet origin main
target_commit="$(git rev-parse origin/main)"
deployed_commit=""
if [[ -f "$STATE_FILE" ]]; then
  deployed_commit="$(cat "$STATE_FILE")"
fi
if [[ "$target_commit" == "$deployed_commit" ]]; then
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Deployment abgebrochen: Das Arbeitsverzeichnis auf der VM enthält lokale Änderungen." >&2
  exit 1
fi
if ! git merge-base --is-ancestor HEAD "$target_commit"; then
  echo "Deployment abgebrochen: origin/main ist kein Fast-Forward von HEAD." >&2
  exit 1
fi

git merge --ff-only "$target_commit"
# Abhängigkeiten nur aktualisieren, wenn sich package.json oder ein Lockfile geändert hat (beim ersten Lauf immer).
if [[ -z "$deployed_commit" || ! -d node_modules ]] || ! git diff --quiet "$deployed_commit" "$target_commit" -- package.json package-lock.json pnpm-lock.yaml 2>/dev/null; then
  # --no-package-lock: keine untracked Lockfile-Änderung, die den nächsten Deploy blockieren würde.
  npm install --omit=dev --no-package-lock
fi
# Sicherung vor dem Neustart, weil neue Versionen beim Start Datenbank-Migrationen ausführen können.
npm run --silent backup -- --if-exists
npm run deploy-commands
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME"
else
  pm2 start npm --name "$PM2_NAME" --cwd "$APP_DIR" -- start
  pm2 save
fi
sleep 5
if ! pm2 describe "$PM2_NAME" | grep -Eq 'status[[:space:]]+│[[:space:]]+online'; then
  echo "Deployment fehlgeschlagen: $PM2_NAME ist nach dem Neustart nicht online." >&2
  exit 1
fi

printf '%s\n' "$target_commit" > "$STATE_FILE.tmp"
mv "$STATE_FILE.tmp" "$STATE_FILE"
echo "Yamamoto-Bot erfolgreich auf $target_commit aktualisiert."
