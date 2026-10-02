# Despliegue en el VPS (mkt.fvr.mx)

openreply corre en el VPS de Hostinger (`179.198.197.212`), en `/opt/openreply`,
con `docker-compose.prod.yml`: Postgres, Redis, web y worker detrás del Traefik
de Dokploy. No va en Vercel porque el worker necesita un proceso siempre
encendido con Redis.

## Cómo se actualiza

**Solo.** Se fusiona un PR a `main` → corre CI → si pasa, la acción
*Desplegar en el VPS* entra por SSH y corre `openreply-deploy.sh`, que:

1. baja `origin/main` en `/opt/openreply`,
2. reconstruye la imagen y reinicia **web y worker** (Postgres y Redis no se tocan),
3. espera hasta 3 min a que `/api/health` responda 200,
4. si no, **regresa a la versión anterior** (código e imagen),
5. instala desde el repo las tareas programadas y el propio script,
6. avisa por Telegram el resultado.

La bitácora queda en `/var/log/openreply-deploy.log`.

## Archivos

| Archivo | Se instala en |
|---|---|
| `openreply-deploy.sh` | `/usr/local/sbin/openreply-deploy.sh` |
| `openreply-cron.sh` | `/usr/local/sbin/openreply-cron.sh` |
| `openreply.cron` | `/etc/cron.d/openreply` |
| `known_hosts` | huella del VPS que usa la acción de GitHub |

Cambiar un horario o una tarea = cambiar el archivo aquí y fusionar. No se
edita en el servidor: el siguiente despliegue lo sobrescribiría.

## La llave

`VPS_DEPLOY_KEY` (secreto de GitHub) entra en `/root/.ssh/authorized_keys` con
`command="/usr/local/sbin/openreply-deploy.sh"` y sin terminal ni reenvíos: sólo
puede desplegar. Si se filtra, lo peor que hace es redesplegar `main`.

## A mano

```bash
ssh root@179.198.197.212 /usr/local/sbin/openreply-deploy.sh
```

## Ojo con las migraciones

Las migraciones de Prisma corren al arrancar `web`. Si una versión nueva
migra y luego falla la salud, el regreso devuelve el código anterior pero **no
deshace la migración**. Las migraciones que borran o renombran columnas se
despliegan en dos pasos.
