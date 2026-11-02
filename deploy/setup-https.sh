#!/usr/bin/env bash
# Richtet HTTPS (Let's Encrypt über Caddy) für das Yamamoto-Dashboard ein.
# Aufruf auf der VM:   bash deploy/setup-https.sh <domain>
# Voraussetzung: Die Domain zeigt bereits per A-Eintrag auf die öffentliche IP dieser VM.
#
# Gemeinsame VM: Andere Seiten in /etc/caddy/Caddyfile (z. B. vom Gambino-Bot) bleiben unangetastet. Das Skript
# pflegt nur einen eigenen, markierten Yamamoto-Block, prüft die Konfiguration und lädt Caddy nur neu (kein Neustart).
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
PM2_NAME="yamamoto-bot"
CADDYFILE="/etc/caddy/Caddyfile"
BEGIN_MARK="# >>> yamamoto-bot (verwaltet von deploy/setup-https.sh)"
END_MARK="# <<< yamamoto-bot"

if [[ -z "$DOMAIN" || ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Aufruf: bash deploy/setup-https.sh <domain>   (z. B. yamamoto.duckdns.org)" >&2
  exit 1
fi
[[ -f "$ENV_FILE" ]] || { echo "Keine .env in $APP_DIR gefunden." >&2; exit 1; }

say() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
PORT="$(grep -E '^DASHBOARD_PORT=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
PORT="${PORT:-3090}"

say "1/6 DNS prüfen"
PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
echo "Öffentliche IP der VM: ${PUBLIC_IP:-unbekannt} · $DOMAIN zeigt auf: ${DNS_IP:-nichts}"
if [[ -z "$DNS_IP" || ( -n "$PUBLIC_IP" && "$DNS_IP" != "$PUBLIC_IP" ) ]]; then
  echo "Die Domain zeigt (noch) nicht auf diese VM. Bitte A-Eintrag auf $PUBLIC_IP setzen und ein paar Minuten warten." >&2
  exit 1
fi

say "2/6 Caddy prüfen"
if ! command -v caddy >/dev/null 2>&1; then
  for svc in nginx apache2; do
    if systemctl is-active --quiet "$svc"; then
      echo "$svc läuft bereits auf dieser VM. Bitte die Domain dort als Reverse-Proxy auf 127.0.0.1:$PORT eintragen – das Skript ändert nichts." >&2
      exit 1
    fi
  done
  sudo apt-get update -qq
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi
caddy version

say "3/6 Ports 80/443 freigeben (falls noch nicht offen)"
for p in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$p" -m state --state NEW -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save >/dev/null; fi

say "4/6 Yamamoto-Block in der Caddyfile setzen"
sudo touch "$CADDYFILE"
BACKUP="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
sudo cp "$CADDYFILE" "$BACKUP"
TMP="$(mktemp)"
# Alten Yamamoto-Block entfernen, alles andere unverändert übernehmen.
sudo awk -v b="$BEGIN_MARK" -v e="$END_MARK" '$0==b{skip=1;next} $0==e{skip=0;next} !skip' "$CADDYFILE" > "$TMP"
if grep -qE "^[[:space:]]*(https?://)?$DOMAIN([[:space:]:,{]|$)" "$TMP"; then
  rm -f "$TMP"
  echo "$DOMAIN ist in $CADDYFILE bereits außerhalb des Yamamoto-Blocks eingetragen – bitte prüfen, nichts geändert." >&2
  exit 1
fi
printf '\n%s\n%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:%s\n}\n%s\n' "$BEGIN_MARK" "$DOMAIN" "$PORT" "$END_MARK" >> "$TMP"
sudo install -m 644 "$TMP" "$CADDYFILE"
rm -f "$TMP"
if ! sudo caddy validate --config "$CADDYFILE" --adapter caddyfile; then
  sudo install -m 644 "$BACKUP" "$CADDYFILE"
  echo "Konfiguration ungültig – alte Caddyfile wiederhergestellt ($BACKUP)." >&2
  exit 1
fi
if systemctl is-active --quiet caddy; then sudo systemctl reload caddy; else sudo systemctl enable --now caddy; fi

say "5/6 Bot auf die neue Adresse umstellen"
cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
chmod 600 "$ENV_FILE".bak-* 2>/dev/null || true
if grep -qE '^DASHBOARD_PUBLIC_URL=' "$ENV_FILE"; then
  sed -i -E "s#^DASHBOARD_PUBLIC_URL=.*#DASHBOARD_PUBLIC_URL=https://$DOMAIN#" "$ENV_FILE"
else
  echo "DASHBOARD_PUBLIC_URL=https://$DOMAIN" >> "$ENV_FILE"
fi
if command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_NAME" >/dev/null 2>&1; then pm2 restart "$PM2_NAME" --update-env >/dev/null && echo "$PM2_NAME neu gestartet."; fi

say "6/6 Prüfen"
sleep 5
if curl -fsS --max-time 20 "https://$DOMAIN/health" >/dev/null; then
  echo "✅ https://$DOMAIN ist mit gültigem Zertifikat erreichbar."
else
  echo "⚠️  Noch nicht erreichbar. Häufige Ursache: Port 80/443 in der Oracle-Cloud-Konsole (Security List) nicht offen."
  echo "    Logs: sudo journalctl -u caddy --since '10 min ago' --no-pager | tail -40"
fi

cat <<MSG

Letzter Schritt (nur du kannst das):
  Discord Developer Portal → Yamamoto-Anwendung → OAuth2 → Redirects:
  https://$DOMAIN/oauth/callback   hinzufügen und speichern.
Danach die Website unter https://$DOMAIN öffnen.
MSG
