export const SEMATTR_HTTP_METHOD = "http.method";
export const SEMATTR_HTTP_ROUTE = "http.route";
export const SEMATTR_HTTP_STATUS_CODE = "http.status_code";
export const SEMATTR_HTTP_REQUEST_BODY_SIZE = "http.request.body.size";
export const SEMATTR_HTTP_RESPONSE_BODY_SIZE = "http.response.body.size";
export const SEMATTR_HTTP_FLAVOR = "http.flavor";
export const SEMATTR_HTTP_SCHEME = "http.scheme";
export const SEMATTR_HTTP_HOST = "http.host";
export const SEMATTR_HTTP_TARGET = "http.target";
export const SEMATTR_HTTP_USER_AGENT = "http.user_agent";

export const SEMATTR_DB_SYSTEM = "db.system";
export const SEMATTR_DB_OPERATION = "db.operation";
export const SEMATTR_DB_TABLE = "db.table";
export const SEMATTR_DB_STATEMENT = "db.statement";
export const SEMATTR_DB_REDIS_KEY = "db.redis.key";
export const SEMATTR_DB_REDIS_COMMAND = "db.redis.command";

export const SEMATTR_MESSAGING_SYSTEM = "messaging.system";
export const SEMATTR_MESSAGING_OPERATION = "messaging.operation";
export const SEMATTR_MESSAGING_DESTINATION = "messaging.destination";
export const SEMATTR_MESSAGING_DESTINATION_KIND = "messaging.destination_kind";
export const SEMATTR_MESSAGING_MESSAGE_ID = "messaging.message.id";
export const SEMATTR_MESSAGING_MESSAGE_PAYLOAD_SIZE =
  "messaging.message.payload_size";
export const SEMATTR_MESSAGING_BATCH_SIZE = "messaging.batch.size";

export const SEMATTR_WS_MESSAGE_TYPE = "ws.message.type";
export const SEMATTR_WS_ROOM = "ws.room";
export const SEMATTR_WS_CONNECTION_ID = "ws.connection.id";

export const SEMATTR_NET_PEER_NAME = "net.peer.name";
export const SEMATTR_NET_PEER_PORT = "net.peer.port";
export const SEMATTR_RPC_SYSTEM = "rpc.system";
export const SEMATTR_RPC_SERVICE = "rpc.service";
export const SEMATTR_RPC_METHOD = "rpc.method";
export const SEMATTR_RPC_GRPC_STATUS_CODE = "rpc.grpc.status_code";

export const SEMATTR_CODE_FUNCTION = "code.function";
export const SEMATTR_CODE_NAMESPACE = "code.namespace";

export const SEMVAL_DB_SYSTEM_POSTGRESQL = "postgresql";
export const SEMVAL_DB_SYSTEM_REDIS = "redis";
export const SEMVAL_MESSAGING_SYSTEM_BULLMQ = "bullmq";
export const SEMVAL_MESSAGING_SYSTEM_REDIS = "redis";
export const SEMVAL_MESSAGING_SYSTEM_IN_PROCESS = "in_process";
export const SEMVAL_MESSAGING_OPERATION_PUBLISH = "publish";
export const SEMVAL_MESSAGING_OPERATION_RECEIVE = "receive";
export const SEMVAL_MESSAGING_OPERATION_PROCESS = "process";
export const SEMVAL_MESSAGING_DESTINATION_KIND_QUEUE = "queue";
export const SEMVAL_MESSAGING_DESTINATION_KIND_TOPIC = "topic";
