# Imagen única para los dos procesos de openreply: la web (`next start`) y el
# worker de la cola (`tsx worker/dm-worker.ts`). Comparten el mismo código y las
# mismas dependencias, así que separarlas en dos imágenes solo duplicaría el
# build de Next —el paso caro— sin ganar nada.
#
# No se usa `output: "standalone"` a propósito: el trazado de standalone solo
# cubre la app de Next, y el worker se quedaría sin sus módulos. La imagen pesa
# más; a cambio los dos procesos arrancan del mismo lugar.

FROM node:26-slim AS base
# openssl lo pide el cliente de Prisma; ca-certificates, las llamadas a Meta.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── dependencias ──────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm ci` corre el postinstall que genera el cliente de Prisma. npm 11 lo
# bloquea si no se pide explícitamente, así que se llama aparte más abajo.
RUN npm ci --ignore-scripts
RUN npx prisma generate

# ── build ─────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── imagen final ──────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Se copia el árbol COMPLETO del build, no una lista de carpetas escogidas a
# mano. Escogerlas a mano fue justo lo que rompió el worker en el primer
# intento: el cliente de Prisma se genera en `app/generated/prisma` (lo dice
# el `output` del generador) y `prisma.config.ts` vive en la raíz —de ahí sale
# la URL de la base para `migrate deploy`—. Ninguno de los dos estaba en la
# lista, y un módulo que falta no se nota hasta que el proceso arranca.
COPY --from=build /app ./

# No corre como root: si algún día un contenedor se compromete, que no herede
# la máquina.
RUN useradd --system --uid 1001 openreply && chown -R openreply:openreply /app
USER openreply

EXPOSE 3000
CMD ["npm", "run", "start"]
