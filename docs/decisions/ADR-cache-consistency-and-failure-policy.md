# Consistencia de caché y política ante fallos de Redis

## Estado

Aceptada

## Contexto

FastifyKit admite caché L1 local al proceso y caché L2 opcional respaldada por
Redis. Una caché local no puede mantener una coherencia fuerte entre instancias
cuando Redis y su canal de invalidación Pub/Sub no están disponibles. Redis
también lo utilizan otras funcionalidades distribuidas, incluido BullMQ, cuya
conexión compartida tiene requisitos de reintento diferentes a los de una caché
del recorrido de la petición.

Por tanto, la caché debe definir su comportamiento de consistencia y ante fallos,
en lugar de esperar implícitamente a Redis o servir valores locales potencialmente
divergentes.

La caché también necesita una semántica estable para los envelopes y los tiempos
de espera, de modo que un caller no pueda configurar un límite stale imposible ni
confundir un timeout del cliente con la cancelación de un comando Redis.

## Decisión

La caché expone tres modos:

- `l1-only`: caché local al proceso sin garantía de coherencia distribuida.
- `l2-only`: Redis es el backend de caché; no se sirve ninguna copia local.
- `multi`: L1 más L2 en Redis con coherencia eventual. L1 puede responder sin
  consultar L2, por lo que este modo no es linearizable.

El comportamiento ante fallos de Redis se configura por namespace:

- `bypass-l1`: omite los datos L1/L2 potencialmente divergentes, ejecuta el
  cargador y no escribe en caché mientras Redis esté degradado.
- `stale-if-error`: sirve L1 únicamente dentro de su límite stale explícito y
  utiliza un recorrido local de refresco acotado.
- `fail`: lanza `CacheDependencyUnavailableError` sin exponer detalles del
  proveedor al caller.

`bypass-l1` es el valor por defecto para los modos respaldados por Redis.
`stale-if-error` debe ser una elección explícita para datos donde la disponibilidad
sea más importante que la frescura. La consistencia fuerte requiere `l2-only`,
una lectura desde la fuente de verdad o un bypass explícito de todas las capas
de caché.

La caché usa una conexión Redis dedicada para comandos, con timeouts y reintentos
acotados. No cambia la política de conexión compartida que requiere BullMQ. Un
circuito local evita tormentas de reintentos durante una interrupción.

Las escrituras de los cargadores están protegidas por el token de fencing del lock
distribuido. Un cargador cuyo lock haya expirado puede devolver su valor al caller,
pero no puede escribir un valor obsoleto en Redis ni en L1. Las mutaciones y los
cargadores utilizan la misma coordinación por clave.

`staleTtlSeconds` es la vida total desde `storedAt`, incluido el periodo fresh.
La construcción del envelope normaliza un TTL stale menor al TTL fresh, y los
overrides fresh por llamada elevan la vida stale total cuando es necesario.

`operationTimeoutMs` es un límite para dejar de esperar. No cancela un comando de
ioredis ya enviado a Redis. Por ello, las mutaciones dependen de la propiedad del
lock y de comprobaciones de fencing para garantizar la seguridad, sin afirmar que
exista cancelación.

El `keyPrefix` configurado de L2 es el límite de aislamiento. El valor por defecto
se conserva por compatibilidad, pero las aplicaciones que compartan Redis deben
configurar prefijos únicos. La conexión Redis compartida pertenece a
`RedisConnectionManager`; las conexiones duplicadas para comandos y suscripción
de caché pertenecen a `RedisCacheAdapter`.

La propiedad del ciclo de vida es explícita:

- los cargadores de caché y los refrescos en segundo plano se drenan antes de
  cerrar las capas de caché;
- el inicio y el cierre de la caché son idempotentes, y una suscripción de
  invalidación fallida deja la instancia lista para reintentar;
- la entrega de invalidaciones es secuencial y acotada; las ráfagas se agrupan
  por namespace y el desbordamiento escala a una invalidación global segura de
  L1 en lugar de hacer crecer una cola ilimitada de promesas;
- `clearAll` publica una invalidación global limitada al prefijo de claves
  configurado; nunca ejecuta Redis `FLUSHALL`;
- se espera a que EventBus esté listo antes de iniciar los workers Redis de colas;
- los suscriptores de BullMQ/colas se cierran en `beforeApplicationShutdown`,
  mientras que la conexión Redis compartida solo se cierra en
  `onApplicationShutdown`;
- las conexiones Redis proporcionadas externamente nunca las cierra FastifyKit;
- se admite una aplicación FastifyKit activa por proceso. Una segunda aplicación
  activa falla durante el bootstrap en lugar de reutilizar recursos globales de DI.

`CacheManager` y `@Cache` son contratos asíncronos en todos los modos, incluido
`l1-only` y los adaptadores de almacén personalizados.

## Alternativas consideradas

### Usar siempre L1 como fallback

Rechazada. Durante una interrupción de Redis, los mensajes de invalidación no
pueden propagarse y distintas instancias podrían servir valores divergentes
indefinidamente.

### Consultar siempre la base de datos ante un fallo de Redis

Rechazada como política universal. Conserva la frescura, pero puede provocar una
avalancha contra la base de datos. El cargador sigue protegido por coalescencia
local, límites de concurrencia, colas acotadas y rechazo controlado de carga.

### Usar la conexión Redis compartida de BullMQ para comandos de caché

Rechazada. `maxRetriesPerRequest: null` es apropiado para BullMQ, pero puede dejar
las operaciones de caché del recorrido de la petición pendientes indefinidamente.
La caché usa una conexión duplicada aislada con límites específicos.

### Incrementar todo el namespace en cada eliminación de clave

Rechazada como valor por defecto. Evita la resurrección de datos stale, pero hace
que entradas no relacionadas fallen en caché y puede crear avalanchas evitables.
Las mutaciones de claves usan fencing de locks.

## Consecuencias

Positivas:

- las interrupciones de Redis tienen un comportamiento acotado y semántica de
  consistencia explícita;
- el fallback a la base de datos está protegido contra el crecimiento ilimitado
  de la cola;
- los locks expirados no permiten que cargadores antiguos sobrescriban valores
  más recientes;
- las métricas de caché son independientes del tracing y visibles en Prometheus.

Compromisos:

- `multi` sigue siendo eventualmente consistente por diseño;
- `bypass-l1` puede aumentar las lecturas de base de datos durante una interrupción;
- las conexiones Redis dedicadas consumen recursos adicionales de Redis y del cliente;
- fencing, estado de fallo y recorridos de recuperación aumentan la complejidad de
  implementación y pruebas a cambio de un comportamiento de producción predecible.

## Despliegue y rollback

Las nuevas opciones son aditivas. Los datos de caché son desechables, por lo que
los cambios de formato de claves/envelopes pueden desplegarse con un prefijo de
claves versionado o una limpieza controlada de caché; esta funcionalidad nunca
migra ni elimina datos de negocio.

Despliega con las métricas de salud de Redis, fallback, cargadores, stale, locks y
p99 habilitadas. Si el nuevo comportamiento no es seguro para un consumidor, usa
temporalmente `onRedisError: "fail"` para namespaces críticos o revierte la versión
del framework. No cambies silenciosamente un namespace crítico a `l1-only`.
