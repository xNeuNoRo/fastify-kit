/**
 * @description Constantes de atributos semánticos para spans de OpenTelemetry.
 * Siguen las convenciones de OpenTelemetry Semantic Conventions v1.27.
 *
 * Organizados por dominio:
 * - HTTP (http.*): peticiones y respuestas HTTP
 * - DB (db.*): operaciones de base de datos
 * - Messaging (messaging.*): colas, tópicos, mensajes
 * - WS (ws.*): WebSockets
 * - Net/RPC (net.* / rpc.*): red y llamadas RPC
 * - Code (code.*): atributos de código fuente (función, namespace)
 *
 * Usar estas constantes en lugar de strings directos garantiza:
 * - Consistencia con dashboards de Grafana genéricos
 * - Correlación cross-service en herramientas como Jaeger/Tempo
 * - Evitar errores de tipeo en nombres de atributos
 *
 * @example
 * span.setAttribute(SEMATTR_HTTP_METHOD, "POST");
 * span.setAttribute(SEMATTR_DB_SYSTEM, SEMVAL_DB_SYSTEM_POSTGRESQL);
 */

// ==========================================
// HTTP
// ==========================================

/** Método HTTP (GET, POST, PUT, DELETE) */
export const SEMATTR_HTTP_METHOD = "http.method";
/** Ruta de la petición (ej: /api/v1/orders/:id) */
export const SEMATTR_HTTP_ROUTE = "http.route";
/** Código de estado HTTP (200, 404, 500) */
export const SEMATTR_HTTP_STATUS_CODE = "http.status_code";
/** Tamaño del body de la petición en bytes */
export const SEMATTR_HTTP_REQUEST_BODY_SIZE = "http.request.body.size";
/** Tamaño del body de la respuesta en bytes */
export const SEMATTR_HTTP_RESPONSE_BODY_SIZE = "http.response.body.size";
/** Versión del protocolo HTTP (1.1, 2.0) */
export const SEMATTR_HTTP_FLAVOR = "http.flavor";
/** Esquema de la URL (http, https) */
export const SEMATTR_HTTP_SCHEME = "http.scheme";
/** Host solicitado (ej: api.midominio.com) */
export const SEMATTR_HTTP_HOST = "http.host";
/** Path completo de la petición */
export const SEMATTR_HTTP_TARGET = "http.target";
/** User-Agent del cliente */
export const SEMATTR_HTTP_USER_AGENT = "http.user_agent";

// ==========================================
// Base de Datos
// ==========================================

/** Sistema de base de datos (postgresql, redis, mongodb) */
export const SEMATTR_DB_SYSTEM = "db.system";
/** Operación realizada (INSERT, SELECT, DELETE) */
export const SEMATTR_DB_OPERATION = "db.operation";
/** Nombre de la tabla o colección */
export const SEMATTR_DB_TABLE = "db.table";
/** Sentencia SQL ejecutada */
export const SEMATTR_DB_STATEMENT = "db.statement";
/** Clave de Redis accedida */
export const SEMATTR_DB_REDIS_KEY = "db.redis.key";
/** Comando Redis ejecutado (SET, GET, HSET) */
export const SEMATTR_DB_REDIS_COMMAND = "db.redis.command";

// ==========================================
// Mensajería (Colas, Tópicos)
// ==========================================

/** Sistema de mensajería (bullmq, kafka, rabbitmq) */
export const SEMATTR_MESSAGING_SYSTEM = "messaging.system";
/** Operación de mensajería (publish, receive, process) */
export const SEMATTR_MESSAGING_OPERATION = "messaging.operation";
/** Destino del mensaje (nombre de cola o tópico) */
export const SEMATTR_MESSAGING_DESTINATION = "messaging.destination";
/** Tipo de destino (queue, topic) */
export const SEMATTR_MESSAGING_DESTINATION_KIND = "messaging.destination_kind";
/** ID del mensaje */
export const SEMATTR_MESSAGING_MESSAGE_ID = "messaging.message.id";
/** Tamaño del payload del mensaje en bytes */
export const SEMATTR_MESSAGING_MESSAGE_PAYLOAD_SIZE =
  "messaging.message.payload_size";
/** Tamaño del batch para envíos en lote */
export const SEMATTR_MESSAGING_BATCH_SIZE = "messaging.batch.size";

// ==========================================
// WebSocket
// ==========================================

/** Tipo de mensaje WebSocket (json, binary, text) */
export const SEMATTR_WS_MESSAGE_TYPE = "ws.message.type";
/** Sala o room del WebSocket */
export const SEMATTR_WS_ROOM = "ws.room";
/** ID único de la conexión WebSocket */
export const SEMATTR_WS_CONNECTION_ID = "ws.connection.id";

// ==========================================
// Red / RPC
// ==========================================

/** Nombre del peer de red (hostname o IP) */
export const SEMATTR_NET_PEER_NAME = "net.peer.name";
/** Puerto del peer de red */
export const SEMATTR_NET_PEER_PORT = "net.peer.port";
/** Sistema RPC (grpc, jsonrpc) */
export const SEMATTR_RPC_SYSTEM = "rpc.system";
/** Nombre del servicio RPC */
export const SEMATTR_RPC_SERVICE = "rpc.service";
/** Método RPC invocado */
export const SEMATTR_RPC_METHOD = "rpc.method";
/** Código de estado gRPC */
export const SEMATTR_RPC_GRPC_STATUS_CODE = "rpc.grpc.status_code";

// ==========================================
// Código Fuente
// ==========================================

/** Nombre de la función o método (para spans creados por decorators) */
export const SEMATTR_CODE_FUNCTION = "code.function";
/** Namespace o clase contenedora (para spans creados por decorators) */
export const SEMATTR_CODE_NAMESPACE = "code.namespace";

// ==========================================
// Valores Semánticos (constantes para valores válidos)
// ==========================================

/** Valor para db.system: PostgreSQL */
export const SEMVAL_DB_SYSTEM_POSTGRESQL = "postgresql";
/** Valor para db.system: Redis */
export const SEMVAL_DB_SYSTEM_REDIS = "redis";
/** Valor para messaging.system: BullMQ */
export const SEMVAL_MESSAGING_SYSTEM_BULLMQ = "bullmq";
/** Valor para messaging.system: Redis Pub/Sub */
export const SEMVAL_MESSAGING_SYSTEM_REDIS = "redis";
/** Valor para messaging.system: En proceso (sin cola externa) */
export const SEMVAL_MESSAGING_SYSTEM_IN_PROCESS = "in_process";
/** Valor para messaging.operation: Publicar mensaje */
export const SEMVAL_MESSAGING_OPERATION_PUBLISH = "publish";
/** Valor para messaging.operation: Recibir mensaje */
export const SEMVAL_MESSAGING_OPERATION_RECEIVE = "receive";
/** Valor para messaging.operation: Procesar mensaje */
export const SEMVAL_MESSAGING_OPERATION_PROCESS = "process";
/** Valor para messaging.destination_kind: Cola de trabajo */
export const SEMVAL_MESSAGING_DESTINATION_KIND_QUEUE = "queue";
/** Valor para messaging.destination_kind: Tópico de publicación */
export const SEMVAL_MESSAGING_DESTINATION_KIND_TOPIC = "topic";
