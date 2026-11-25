#!/usr/bin/env bash
# Instalador do Robô de Ofertas — rode no servidor (Ubuntu) como root:
#   bash instalar.sh
# ou, se o código estiver no GitHub:
#   curl -fsSL https://raw.githubusercontent.com/mikaellsuka25/robo-ofertas/main/instalar.sh | bash -s https://github.com/mikaellsuka25/robo-ofertas
set -euo pipefail

DIR=/opt/robo-ofertas
REPO="${1:-}"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root (ou com sudo)."; exit 1; fi

say "1/4 Instalando o Docker (se precisar)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

say "2/4 Copiando o robô para $DIR"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo /tmp)"
if [ -f "$HERE/docker-compose.yml" ] && [ "$HERE" != "$DIR" ]; then
  mkdir -p "$DIR" && cp -r "$HERE"/. "$DIR"/
elif [ -n "$REPO" ]; then
  command -v git >/dev/null 2>&1 || (apt-get update -y && apt-get install -y git)
  if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
elif [ ! -f "$DIR/docker-compose.yml" ]; then
  echo "Não achei os arquivos do robô. Rode este script de dentro da pasta do robô ou passe o link do GitHub."; exit 1
fi
cd "$DIR"

say "3/4 Criando senhas"
rnd() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
getv() { [ -f .env ] && grep "^$1=" .env | head -1 | cut -d= -f2- || true; }
PANEL_PASSWORD="$(getv PANEL_PASSWORD)"; PANEL_PASSWORD="${PANEL_PASSWORD:-$(rnd 10)}"
EVO_KEY="$(getv EVOLUTION_API_KEY)"; EVO_KEY="${EVO_KEY:-$(rnd 32)}"
PG_PASS="$(getv POSTGRES_PASSWORD)"; PG_PASS="${PG_PASS:-$(rnd 24)}"
cat > .env <<EOF2
PANEL_PASSWORD=$PANEL_PASSWORD
EVOLUTION_API_KEY=$EVO_KEY
AUTHENTICATION_API_KEY=$EVO_KEY
POSTGRES_PASSWORD=$PG_PASS
DATABASE_CONNECTION_URI=postgresql://evolution:$PG_PASS@postgres:5432/evolution?schema=public
EOF2
chmod 600 .env
PANEL_PASSWORD="$(grep '^PANEL_PASSWORD=' .env | cut -d= -f2-)"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; fi

say "4/4 Ligando tudo (a primeira vez leva uns 3 a 5 minutos)"
docker compose up -d --build

IP="$(curl -fsS -4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
printf '\n\033[1;32m✅ Pronto!\033[0m\n\n'
printf '   Abra no navegador:  \033[1mhttp://%s\033[0m\n' "$IP"
printf '   Senha do painel:    \033[1m%s\033[0m\n\n' "$PANEL_PASSWORD"
printf '   Anote a senha. Para ver de novo: cat %s/.env\n\n' "$DIR"
