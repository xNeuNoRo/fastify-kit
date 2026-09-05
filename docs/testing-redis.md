# Pruebas de integración con Redis

La suite de integración distribuida usa un servidor Redis real. El comando
`bun test` habitual sigue siendo seguro para el desarrollo local y solo omite las
pruebas que requieren Redis cuando el servicio no está disponible.

## Ejecución requerida

Inicia Redis en `127.0.0.1:6379` y ejecuta:

```bash
bun run test:redis
```

A diferencia de la suite habitual, `test:redis` establece
`FASTIFY_KIT_REQUIRE_REDIS=1` y falla si no puede alcanzar Redis. La conexión se
puede configurar con:

- `FASTIFY_KIT_REDIS_HOST`
- `FASTIFY_KIT_REDIS_PORT`
- `FASTIFY_KIT_REDIS_DB`

Cada prueba usa un prefijo de claves aleatorio, escanea únicamente ese prefijo
durante la limpieza y cierra todos los clientes que crea. Las pruebas esperan
condiciones observables o el estado de Redis en lugar de pausas fijas.

## Contratos cubiertos

El grupo que usa Redis real cubre la disponibilidad e invalidación de Pub/Sub,
la expiración lógica frente a la física, la expiración y el fencing de locks,
las versiones monótonas por namespace, las carreras de SCAN durante la limpieza
de namespaces, stale-while-revalidate, la entrega de eventos entre instancias,
la finalización de colas distribuidas y el cierre de workers.

## Consumidor limpio

Construye e instala el paquete en un consumidor temporal sin peers opcionales:

```bash
bun run test:clean-consumer
```

El smoke test instala únicamente los peers requeridos de Fastify y TypeBox,
verifica el import raíz y el bootstrap básico, y comprueba que `ioredis`,
`bullmq` y `mediasoup` no son necesarios para el recorrido básico.
