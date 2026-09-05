# Caché

FastifyKit proporciona por defecto una caché local al proceso. Redis es opcional
y solo se carga cuando se habilita un modo de caché distribuida.

## Uso básico

```ts
@Cache("users", 60)
async getUser(id: string) {
  return userRepository.findById(id);
}

@ClearCache("users")
async updateUser(id: string, input: UpdateUserInput) {
  return userRepository.update(id, input);
}
```

Los métodos decorados son asíncronos. Los métodos de `CacheManager` también son
asíncronos:

```ts
await CacheManager.getOrLoad("users:123", () => repository.findById("123"));
await CacheManager.set("users:123", user, 60);
await CacheManager.clearNamespace("users");
await CacheManager.clearAll();
```

Las claves de caché usan el formato `namespace:method:arguments`. La codificación
de argumentos es determinista, rechaza referencias circulares y tiene un límite de
4096 caracteres.

## Modos distribuidos

```ts
distributed: {
  redis: { host: "localhost", port: 6379 },
  features: {
    cache: {
      mode: "multi",
      onRedisError: "bypass-l1",
      l1: { maxSize: 5000, defaultTtlSeconds: 30 },
      l2: {
        keyPrefix: "my-app:cache:",
        defaultTtlSeconds: 300,
        staleTtlSeconds: 3600,
      },
      load: {
        maxConcurrent: 16,
        maxWaiters: 100,
        maxQueuedLoads: 1000,
      },
      namespaces: {
        sessions: { mode: "l2-only", l2TtlSeconds: 1800 },
      },
    },
  },
}
```

- `l1-only`: solo memoria local; no requiere Redis.
- `l2-only`: solo Redis; requiere `distributed.redis`.
- `multi`: L1 local más L2 en Redis, con invalidación Pub/Sub y versiones por namespace.

Las políticas ante fallos de Redis son explícitas:

- `bypass-l1`: ejecuta el cargador sin servir ni escribir datos L1 potencialmente obsoletos.
- `stale-if-error`: sirve datos L1 únicamente dentro de su límite stale configurado.
- `fail`: lanza `CacheDependencyUnavailableError`.

Las conexiones Redis de la caché están aisladas de la conexión compartida de BullMQ.
La invalidación Pub/Sub es at-most-once; `multi` proporciona consistencia eventual,
no fuerte. `clearAll` elimina únicamente las claves bajo el `l2.keyPrefix`
configurado y publica una invalidación global para que cada L1 activa limpie sus
entradas locales.

## Decisiones de contrato

- `l2.staleTtlSeconds` es la vida total desde la escritura, incluido el periodo
  fresh. No se suma a `defaultTtlSeconds`.
- Un override de `ttlSeconds` por llamada no puede crear un envelope cuyo límite
  stale sea anterior al límite fresh; la vida total se normaliza hacia arriba.
- `operationTimeoutMs` es un límite para dejar de esperar. No cancela un comando
  de ioredis ya enviado a Redis. Las escrituras mutables siguen protegidas por
  fencing y comprobaciones de propiedad del lock.
- `l2.keyPrefix` es el límite de aislamiento. Configura un prefijo único para cada
  aplicación, entorno o tenant que comparta una instancia Redis. El valor por
  defecto se conserva por compatibilidad y no garantiza aislamiento entre aplicaciones.
- `CacheManager` y los métodos de caché decorados son asíncronos por contrato,
  incluido el modo `l1-only` y los adaptadores personalizados.

## Notas operativas

- Los cargadores se agrupan por clave y están limitados por la concurrencia y los
  límites de cola configurados.
- `CacheService.close()` rechaza nuevas cargas, espera a que terminen los cargadores
  y refrescos activos, y puede llamarse más de una vez. Los cargadores no aceptan
  cancelación, por lo que uno que nunca termine puede retrasar el cierre de la aplicación.
- Los suscriptores de invalidación procesan un handler cada vez mediante una cola
  acotada. Las ráfagas se agrupan por namespace; el desbordamiento provoca una
  limpieza global segura de L1.
- FastifyKit admite una aplicación activa por proceso. Crea una segunda aplicación
  solo después de cerrar la primera para evitar reutilizar accidentalmente recursos
  globales del contenedor DI.
- Las conexiones Redis proporcionadas por la aplicación siguen siendo propiedad de
  la aplicación y FastifyKit no las cierra. Las conexiones creadas por FastifyKit se
  cierran después de drenar los consumidores de colas, EventBus y caché.
- Los bloqueos distribuidos usan tokens de fencing para impedir que cargadores tardíos
  sobrescriban valores más recientes.
- Los resultados negativos pueden almacenarse brevemente mediante el TTL negativo de L2.
- `clearNamespace` y `clearAll` invalidan cargadores en curso mediante comprobaciones de versión.
- No incluyas secretos, claves de caché sin anonimizar ni payloads en labels de métricas o logs.
