#!/bin/bash
# openreply-cron.sh <nombre-del-trabajo>
#
# Los tres trabajos vivían en vercel.json, que fuera de Vercel no ejecuta nada.
# Aquí los corre el cron del sistema.
#
# Llama al contenedor por dentro (127.0.0.1) y NO por mkt.fvr.mx: si algún día
# el DNS o el certificado tienen un tropiezo, el trabajo debe seguir corriendo.
#
# Cada corrida deja renglón en la bitácora con su código HTTP. Un trabajo
# programado que falla no molesta a nadie —así llevan semanas caídos los
# respaldos del ERP—, de modo que el rastro es lo único que avisa.

set -u
TRABAJO="${1:?falta el nombre del trabajo}"
BITACORA=/var/log/openreply-cron.log
COMPOSE="/opt/openreply/docker-compose.prod.yml"

RES=$(docker compose -f "$COMPOSE" exec -T web node -e "
const t = setTimeout(() => { console.log('TIMEOUT|'); process.exit(0) }, 120000);
fetch('http://127.0.0.1:3000/api/cron/$TRABAJO', {
  headers: { authorization: 'Bearer ' + process.env.CRON_SECRET }
})
 .then(async r => { clearTimeout(t); console.log(r.status + '|' + (await r.text()).slice(0,300)) })
 .catch(e => { clearTimeout(t); console.log('ERROR|' + e.message) });
" 2>&1 | tail -1)

CODIGO="${RES%%|*}"
DETALLE="${RES#*|}"
if [ "$CODIGO" = "200" ]; then
  echo "$(date -Is)  OK    $TRABAJO  $DETALLE" >> "$BITACORA"
else
  echo "$(date -Is)  FALLO $TRABAJO  codigo=$CODIGO  $DETALLE" >> "$BITACORA"
fi
