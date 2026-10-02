#!/bin/bash
# openreply-deploy.sh [sha]
#
# Despliega en el VPS lo que hay en origin/main. Lo llama GitHub Actions por SSH
# con una llave que SOLO puede correr este script (command= en authorized_keys),
# y también se puede correr a mano en el VPS.
#
# Qué toca y qué no:
#   - Reconstruye la imagen y reinicia web y worker.
#   - Postgres y Redis NO se tocan (--no-deps): sus datos viven en volúmenes.
#   - .env y lo demás que git ignora se quedan como están.
#
# Si la nueva versión no responde sana en /api/health, regresa a la anterior
# (código e imagen) y avisa por Telegram. Ojo: las migraciones de Prisma corren
# al arrancar web; si una migración ya se aplicó, regresar el código no la
# deshace.

set -euo pipefail

DIR=/opt/openreply
COMPOSE=(docker compose -p openreply -f "$DIR/docker-compose.prod.yml")
BITACORA=/var/log/openreply-deploy.log
SALUD_INTENTOS=36   # × 5 s = 3 min para que web y worker reporten sanos

# El SHA llega como argumento (a mano) o como el "comando" que manda la llave
# de GitHub (SSH_ORIGINAL_COMMAND). Sólo se acepta un SHA completo.
PEDIDO="${1:-${SSH_ORIGINAL_COMMAND:-}}"
if [ -n "$PEDIDO" ] && ! [[ "$PEDIDO" =~ ^[0-9a-f]{40}$ ]]; then
  echo "argumento no válido: se espera un SHA de 40 caracteres o nada" >&2
  exit 2
fi

log() { echo "$(date -Is)  $*" | tee -a "$BITACORA"; }

# Telegram: las mismas credenciales con las que Hermes ya te escribe. Se leen
# sólo esas dos variables, sin cargar el resto del archivo.
avisar() {
  local token chat
  token=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' /root/.hermes/.env 2>/dev/null | tr -d '"'"'" | head -1)
  chat=$(sed -n 's/^TELEGRAM_HOME_CHANNEL=//p' /root/.hermes/.env 2>/dev/null | tr -d '"'"'" | head -1)
  [ -n "$token" ] && [ -n "$chat" ] || { log "AVISO sin Telegram configurado: $1"; return 0; }
  curl -s -m 15 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode chat_id="$chat" --data-urlencode text="$1" >/dev/null || true
}

# Cualquier error no previsto (git fetch sin red, disco lleno…) también avisa:
# un despliegue que falla callado es peor que uno que no existe.
trap 'log "FALLO inesperado en la línea $LINENO"; avisar "⚠️ openreply: el despliegue se detuvo por un error inesperado (línea $LINENO). Revisa $BITACORA en el VPS."' ERR

# Un despliegue a la vez: dos fusiones seguidas no deben pisarse.
exec 9>/run/lock/openreply-deploy.lock
flock -w 600 9 || { log "FALLO otro despliegue lleva más de 10 min; no se intentó"; exit 75; }

sano() {
  local codigo
  codigo=$("${COMPOSE[@]}" exec -T web node -e "
    fetch('http://127.0.0.1:3000/api/health')
      .then(r => console.log(r.status)).catch(() => console.log(0))
  " 2>/dev/null | tail -1) || codigo=0
  [ "$codigo" = "200" ]
}

esperar_salud() {
  for _ in $(seq "$SALUD_INTENTOS"); do
    sano && return 0
    sleep 5
  done
  return 1
}

cd "$DIR"
git fetch --quiet origin main
OBJETIVO=$(git rev-parse origin/main)
ANTERIOR=$(git rev-parse HEAD)

# Si GitHub pidió un SHA viejo y main ya avanzó, se despliega main: lo nuevo
# contiene lo pedido. Si el SHA no está en main, algo raro pasa y se detiene.
if [ -n "$PEDIDO" ] && [ "$PEDIDO" != "$OBJETIVO" ]; then
  if ! git merge-base --is-ancestor "$PEDIDO" "$OBJETIVO" 2>/dev/null; then
    log "FALLO $PEDIDO no está en origin/main ($OBJETIVO)"
    avisar "⚠️ openreply: se pidió desplegar ${PEDIDO:0:7}, que no está en main. No se tocó nada."
    exit 1
  fi
fi

if [ "$OBJETIVO" = "$ANTERIOR" ] && sano; then
  log "OK    ${OBJETIVO:0:7} ya estaba desplegado y sano"
  exit 0
fi

log "INICIO ${ANTERIOR:0:7} → ${OBJETIVO:0:7}"
docker image tag openreply:latest openreply:anterior 2>/dev/null || true
git reset --hard --quiet "$OBJETIVO"

regresar() {
  local motivo="$1"
  log "FALLO $motivo — regresando a ${ANTERIOR:0:7}"
  git reset --hard --quiet "$ANTERIOR"
  docker image tag openreply:anterior openreply:latest 2>/dev/null || true
  "${COMPOSE[@]}" up -d --no-deps web worker >/dev/null 2>&1 || true
  if esperar_salud; then
    log "OK    regresado a ${ANTERIOR:0:7} y sano"
    avisar "⚠️ openreply: el despliegue de ${OBJETIVO:0:7} falló ($motivo). Se regresó a ${ANTERIOR:0:7} y está sano."
  else
    log "FALLO tampoco ${ANTERIOR:0:7} quedó sano"
    avisar "🚨 openreply: el despliegue de ${OBJETIVO:0:7} falló ($motivo) y la versión anterior TAMPOCO respondió sana. mkt.fvr.mx puede estar caído."
  fi
  exit 1
}

"${COMPOSE[@]}" build web >>"$BITACORA" 2>&1 || regresar "no compiló la imagen"
"${COMPOSE[@]}" up -d --no-deps web worker >>"$BITACORA" 2>&1 || regresar "no arrancaron los contenedores"
esperar_salud || regresar "/api/health no respondió 200 en 3 min"

# Las tareas programadas y este mismo script viven en el repo: se instalan de
# ahí para que lo que corre en el VPS sea siempre lo versionado. `install`
# escribe un archivo nuevo, así que reemplazar este script mientras corre es
# seguro (bash sigue leyendo el viejo).
install -m 755 deploy/openreply-cron.sh /usr/local/sbin/openreply-cron.sh
install -m 644 deploy/openreply.cron /etc/cron.d/openreply
install -m 755 deploy/openreply-deploy.sh /usr/local/sbin/openreply-deploy.sh

docker image prune -f >/dev/null 2>&1 || true
log "OK    ${OBJETIVO:0:7} desplegado y sano"
avisar "✅ openreply: desplegado ${OBJETIVO:0:7} — $(git log -1 --format=%s "$OBJETIVO")"
