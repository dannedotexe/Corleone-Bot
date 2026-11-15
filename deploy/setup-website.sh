#!/usr/bin/env bash
# Schaltet die Corleone-Website ein: fragt nur das Client-Secret ab (verdeckt), erzeugt das Sitzungs-Geheimnis,
# trägt alles in die .env ein und richtet danach HTTPS über deploy/setup-https.sh ein.
#   bash ~/Corleone-Bot/deploy/setup-website.sh            (Adresse: corleone.<IP>.sslip.io)
#   bash ~/Corleone-Bot/deploy/setup-website.sh <domain>   (eigene Domain)
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
[[ -f "$ENV_FILE" ]] || { echo "Keine .env gefunden – zuerst deploy/install.sh ausführen." >&2; exit 1; }

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  [[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Öffentliche IP nicht ermittelbar – bitte Domain angeben." >&2; exit 1; }
  DOMAIN="corleone.${IP//./-}.sslip.io"
fi
echo "Adresse der Website: https://$DOMAIN"
echo
echo "Discord Developer Portal → Anwendung „Corleone“ → OAuth2:"
echo "  1. Bei „Redirects“ eintragen und speichern:  https://$DOMAIN/oauth/callback"
echo "  2. „Client Secret“ → „Reset Secret“ → kopieren."
read -r -s -p "Client Secret einfügen (wird nicht angezeigt): " SECRET; echo
[[ ${#SECRET} -ge 20 && "$SECRET" != *" "* ]] || { echo "Das sieht nicht wie ein Client Secret aus." >&2; exit 1; }
SESSION="$(openssl rand -hex 32)"

cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"; chmod 600 "$ENV_FILE".bak-* 2>/dev/null || true
# Werte setzen (vorhandene Zeile ersetzen, sonst anhängen); Werte kommen über die Umgebung, nicht über die Kommandozeile.
setkv() { K="$1" V="$2" awk 'BEGIN{k=ENVIRON["K"];v=ENVIRON["V"];done=0} index($0,k"=")==1{print k"="v;done=1;next} {print} END{if(!done)print k"="v}' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"; }
umask 077
setkv DASHBOARD_ENABLED true
setkv DASHBOARD_BIND 127.0.0.1
setkv DISCORD_CLIENT_SECRET "$SECRET"
setkv DASHBOARD_SESSION_SECRET "$SESSION"
setkv DASHBOARD_PUBLIC_URL "https://$DOMAIN"
grep -qE '^DASHBOARD_PORT=' "$ENV_FILE" || setkv DASHBOARD_PORT 3090
chmod 600 "$ENV_FILE"
unset SECRET SESSION
echo ".env aktualisiert."

bash "$APP_DIR/deploy/setup-https.sh" "$DOMAIN"
