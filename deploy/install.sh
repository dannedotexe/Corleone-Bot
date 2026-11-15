#!/usr/bin/env bash
# Ersteinrichtung des Corleone-Bots auf der Oracle-VM – ein Befehl, fragt nur nach den Discord-Werten.
#   cd /home/ubuntu && git clone https://github.com/dannedotexe/Corleone-Bot.git && bash Corleone-Bot/deploy/install.sh
# Fasst nur den eigenen pm2-Prozess „corleone-bot“ an; andere Bots (gambino-bot usw.) bleiben unberührt.
# Kann gefahrlos erneut ausgeführt werden (vorhandene .env bleibt, Bot wird nur neu gestartet).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PM2_NAME="corleone-bot"
PORT=3090
ENV_FILE="$APP_DIR/.env"
say() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

cd "$APP_DIR"
say "1/5 Voraussetzungen prüfen"
command -v node >/dev/null || fail "Node.js fehlt (mindestens 20.6)."
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=6)?0:1)' || fail "Node $(node -v) ist zu alt – mindestens 20.6 nötig."
command -v pm2 >/dev/null || fail "pm2 fehlt (npm install -g pm2)."
echo "Node $(node -v), pm2 $(pm2 -v)"

say "2/5 Konfiguration (.env)"
if [[ -f "$ENV_FILE" ]]; then
  echo ".env ist schon vorhanden – wird nicht verändert."
else
  snowflake() { [[ "$1" =~ ^[0-9]{17,20}$ ]]; }
  echo "Werte aus dem Discord Developer Portal (Anwendung „Corleone“). Der Token wird nicht angezeigt."
  read -r -s -p "Bot-Token: " TOKEN; echo
  [[ ${#TOKEN} -ge 50 && "$TOKEN" != *" "* ]] || fail "Das sieht nicht wie ein Bot-Token aus."
  read -r -p "Application-/Client-ID: " CLIENT_ID; snowflake "$CLIENT_ID" || fail "Client-ID muss eine Zahl mit 17–20 Stellen sein."
  read -r -p "Server-ID des Corleone-Discords: " GUILD_ID; snowflake "$GUILD_ID" || fail "Server-ID muss eine Zahl mit 17–20 Stellen sein."
  read -r -p "Deine Discord-User-ID (Bot-Owner, Vollzugriff; leer = keine): " OWNER_ID
  [[ -z "$OWNER_ID" ]] || snowflake "$OWNER_ID" || fail "User-ID muss eine Zahl mit 17–20 Stellen sein."
  umask 077
  TOKEN="$TOKEN" CLIENT_ID="$CLIENT_ID" GUILD_ID="$GUILD_ID" OWNER_ID="$OWNER_ID" PORT="$PORT" awk '
    /^DISCORD_TOKEN=/     { print "DISCORD_TOKEN=" ENVIRON["TOKEN"]; next }
    /^DISCORD_CLIENT_ID=/ { print "DISCORD_CLIENT_ID=" ENVIRON["CLIENT_ID"]; next }
    /^DISCORD_GUILD_ID=/  { print "DISCORD_GUILD_ID=" ENVIRON["GUILD_ID"]; next }
    /^BOT_OWNER_IDS=/     { print "BOT_OWNER_IDS=" ENVIRON["OWNER_ID"]; next }
    /^DASHBOARD_PORT=/    { print "DASHBOARD_PORT=" ENVIRON["PORT"]; next }
    { print }' .env.example > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  unset TOKEN
  echo ".env angelegt (nur für dich lesbar)."
fi
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$PORT\$" && ! pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  echo "Hinweis: Port $PORT ist schon belegt. Das Dashboard ist standardmäßig aus; vor dem Einschalten DASHBOARD_PORT in .env ändern."
fi

say "3/5 Abhängigkeiten installieren"
npm install --omit=dev --no-package-lock --no-audit --no-fund

say "4/5 Slash-Commands registrieren"
npm run --silent deploy-commands

say "5/5 Bot starten (pm2: $PM2_NAME)"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then pm2 restart "$PM2_NAME" --update-env; else pm2 start npm --name "$PM2_NAME" --cwd "$APP_DIR" -- start; fi
pm2 save >/dev/null
sleep 8
pm2 logs "$PM2_NAME" --lines 25 --nostream || true
if pm2 describe "$PM2_NAME" | grep -Eq 'status[[:space:]]+│[[:space:]]+online'; then
  printf '\n\033[32m✔ %s läuft.\033[0m Logs: pm2 logs %s\n' "$PM2_NAME" "$PM2_NAME"
else
  fail "$PM2_NAME ist nicht online – Logs oben prüfen (häufig: Intents im Developer Portal nicht eingeschaltet)."
fi
cat <<'MSG'

Optional – automatische Updates bei jedem Push auf main:
  sudo install -m 644 deploy/corleone-autodeploy.service deploy/corleone-autodeploy.timer /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now corleone-autodeploy.timer
MSG
