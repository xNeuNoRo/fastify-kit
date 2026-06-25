import "./core/constants/symbols.js";

// ----------------------------------------------
// Core & Bootstrap
// ----------------------------------------------
export {
  FastifyKit,
  type FastifyKitOptions,
  FASTIFY_INSTANCE_TOKEN,
} from "./core/FastifyKit.js";
export {
  BootstrapPipeline,
  type BootstrapContext,
  type BootstrapStep,
} from "./core/bootstrap/BootstrapPipeline.js";
export { Module } from "./core/module.decorator.js";
export {
  discoverControllers,
  discoverModules,
  discoverHandlers,
} from "./core/discovery.js";
export type { ModuleOptions } from "./http/decorators/types.js";
export type { AutoDiscoverOptions } from "./core/discovery.js";
export type { Constructor } from "./http/routing/scanner/index.js";

// ----------------------------------------------
// HTTP Routing & Controllers
// ----------------------------------------------
export { Controller } from "./http/decorators/controller.js";
export { Get, Post, Put, Patch, Delete } from "./http/decorators/methods.js";
export { Version } from "./http/decorators/version.js"; // Decorador para definir versiones de API a nivel de clase o método
export {
  UseParams, // Decorador para definir qué parámetros queremos inyectar en cada método de nuestros controladores
  Body,
  Query,
  Param,
  Headers,
  Req,
  Res,
  Ip,
  File,
  Cookie,
  Socket,
  WsPayload,
  createParamDecorator,
} from "./http/decorators/parameters.js";
export { Serialize } from "./http/decorators/serialize.js";
export type { MultipartFile, FileOptions } from "./http/decorators/types.js";

// ----------------------------------------------
// HTTP Static Assets
// ----------------------------------------------
export { StaticAssets } from "./http/decorators/static.js";
export { StaticFile } from "./http/responses/StaticFile.js";
export type {
  StaticAssetsOptions,
  StaticFileOptions,
} from "./http/interfaces/static.interface.js";

// ----------------------------------------------
// HTTP Security & Guards
// ----------------------------------------------
export { UseGuards } from "./http/decorators/guards.js";
export { RateLimit } from "./http/decorators/rate-limit.js";
export type { CanActivate } from "./http/guards/CanActivate.js";
export type { RateLimitOptions } from "./http/decorators/types.js";

// ----------------------------------------------
// HTTP Interceptors (AOP)
// ----------------------------------------------
export { UseInterceptors } from "./http/decorators/interceptors.js";
export type {
  Interceptor,
  ExecutionContext,
  CallHandler,
} from "./http/interceptors/Interceptor.js";

// ----------------------------------------------
// HTTP Responses & Exceptions
// ----------------------------------------------
export { createApiResponseSchema } from "./http/responses/api-response.schema.js";
export { ApiResponse } from "./http/responses/ApiResponse.js";
export { ApiError } from "./http/responses/ApiError.js";
export * from "./http/exceptions/index.js"; // Exporta todos los ErrorCodes y Excepciones (NotFound, Validation, etc.)

// ----------------------------------------------
// Execution Context (AsyncLocalStorage)
// ----------------------------------------------
export { AlsStore } from "./http/context/AlsStore.js";
export {
  requestContext,
  type RequestContext,
} from "./http/context/requestContext.js";

// ----------------------------------------------
// Dependency Injection (IoC)
// ----------------------------------------------
export {
  container,
  type Contract,
  ScopeType,
} from "./container/DIContainer.js";
export { Injectable } from "./container/injectable.decorator.js";
export {
  Inject,
  Optional,
  PostConstruct,
} from "./container/inject.decorator.js";
export { Scope } from "./container/scope.decorator.js";

// ----------------------------------------------
// CQRS (Command Query Responsibility Segregation)
// ----------------------------------------------
export { Mediator } from "./cqrs/Mediator.js";
export {
  CommandHandler,
  QueryHandler,
} from "./cqrs/decorators/handler.decorators.js";
export type {
  IRequest,
  IRequestHandler,
} from "./cqrs/interfaces/request.interface.js";
export { getCqrsHandlerToken } from "./cqrs/utils/cqrs-token.util.js";

// ----------------------------------------------
// Data & Mapping
// ----------------------------------------------
export { MapTo } from "./utils/map-to.decorator.js";
export { Mapper } from "./utils/Mapper.js";
export type { PipeTransform } from "./http/pipes/PipeTransform.js"; // El contrato de transformación

// ----------------------------------------------
// Caching (AOP)
// ----------------------------------------------
export { Cache, ClearCache } from "./cache/cache.decorator.js";
export { CacheManager } from "./cache/CacheManager.js";

// ----------------------------------------------
// Database & Transactions (Agnostic)
// ----------------------------------------------
export {
  Transactional,
  TRANSACTION_MANAGER_TOKEN,
} from "./database/transactions.js";
export { createTransactionProxy } from "./database/proxy.js";
export type { ITransactionManager } from "./database/transactions.js";
export {
  transactionContext,
  type TransactionStore,
} from "./database/context/transactionContext.js";

// ----------------------------------------------
// Observability & Logging
// ----------------------------------------------
export { Benchmark } from "./logger/benchmark.decorator.js";
export {
  LOGGER_TOKEN,
  type LoggerContract,
  DefaultConsoleLogger,
} from "./logger/LoggerContract.js";
export { getLogger } from "./logger/logger.factory.js";

// Observabilidad Nativa (OpenTelemetry, Prometheus, Pino)
export {
  METRICS_SERVICE_TOKEN,
  type MetricsService,
} from "./observability/contracts/MetricsService.js";
export {
  TRACER_SERVICE_TOKEN,
  type TracerService,
  type Span,
  type SpanContext,
  type SpanOptions,
  SpanKind,
  SpanStatusCode,
} from "./observability/contracts/TracerService.js";
export {
  OBSERVABILITY_CONFIG_KEY,
  ObservabilityConfigSchema,
  type ObservabilityConfig,
  getDefaultObservabilityConfig,
} from "./observability/contracts/ObservabilityConfig.js";
export { PromMetricsService } from "./observability/implementations/PromMetricsService.js";
export { OtelTracerService } from "./observability/implementations/OtelTracerService.js";
export { PinoLoggerService } from "./observability/implementations/PinoLoggerService.js";
export {
  Trace,
  type TraceOptions,
} from "./observability/decorators/Trace.js";
export {
  Metrics,
  validateMetricLabels,
  type MetricsOptions,
} from "./observability/decorators/Metrics.js";
export {
  Log,
  type LogOptions,
} from "./observability/decorators/Log.js";
export {
  injectTraceContext,
  extractTraceContext,
  injectBaggage,
  parseBaggageHeader,
} from "./observability/propagation/context-propagation.js";
export * from "./observability/utils/semantic-conventions.js";

// ----------------------------------------------
// Resilience & Fault Tolerance
// ----------------------------------------------
export { Retry } from "./resilience/retry.decorator.js";
export { Timeout } from "./resilience/timeout.decorator.js";
export { CircuitBreaker } from "./resilience/circuit-breaker.decorator.js";

// ----------------------------------------------
// Event Bus (Pub / Sub)
// ----------------------------------------------
export { OnEvent } from "./events/on-event.decorator.js";
export { OnceEvent } from "./events/once-event.decorator.js";
export {
  EVENT_BUS_TOKEN,
  type EventBusContract,
  DefaultEventBus,
  type EmitOptions,
} from "./events/EventBus.js";
export { RedisEventBus } from "./events/RedisEventBus.js";
export { getEventBus } from "./events/eventbus.factory.js";

// ----------------------------------------------
// Scheduling & Background Tasks
// ----------------------------------------------
export { Scheduled, CronExpression } from "./scheduling/scheduled.decorator.js";
export {
  cronContext,
  type CronContext,
} from "./scheduling/context/cronContext.js";

// ----------------------------------------------
// Background Jobs & Queues (Multithreading)
// ----------------------------------------------

export { Processor } from "./queues/decorators/processor.js";
export { OnQueueSuccess } from "./queues/decorators/on-queue-success.js";
export { OnQueueFailure } from "./queues/decorators/on-queue-failure.js";
export { QueueManager } from "./queues/QueueManager.js";
export {
  QueueRegistryService,
  QUEUE_REGISTRY_TOKEN,
} from "./queues/QueueRegistryService.js";
export { WorkerPool } from "./queues/workers/WorkerPool.js";
export { TaskScheduler } from "./queues/workers/TaskScheduler.js";
export { WorkerLifecycleManager } from "./queues/workers/WorkerLifecycleManager.js";
export { WorkerProtocolHandler } from "./queues/workers/WorkerProtocolHandler.js";
export { WorkerEventHandler } from "./queues/workers/WorkerEventHandler.js";
export {
  QueueEvents,
  type QueueJobEvent,
} from "./queues/interfaces/queue-events.js";
export type { JobHandler } from "./queues/interfaces/JobHandler.js";
export type { QueueOptions } from "./core/interfaces/queue.interface.js";
export type { DistributedOptions } from "./core/interfaces/distributed.interface.js";
export type { QueueType } from "./queues/interfaces/queue-options.js";

export { REDIS_CONNECTION_TOKEN } from "./distributed/redis.factory.js";
export { QUEUE_ADAPTER_TOKEN } from "./queues/interfaces/QueueAdapter.js";
export type { QueueAdapter } from "./queues/interfaces/QueueAdapter.js";

// ----------------------------------------------
// Configuration Management
// ----------------------------------------------
/**
 * @deprecated Usa ConfigModule.forRoot() y ConfigService para inyectar configuraciones
 * en lugar de ConfigRegistry. ConfigRegistry se mantendrá temporalmente para compatibilidad
 * con versiones anteriores, pero se eliminará en futuras versiones.
 */
export { ConfigRegistry } from "./config/ConfigRegistry.js";

export { InjectConfig } from "./config/inject-config.decorator.js";

// User Config API (ConfigModule, @InjectConfig)
export {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "./config/ConfigService.js";

// Internal Framework Config API (queue, distributed, webrtc)
// Solo para subsistemas internos. Usuarios: usar ConfigService con setConfig/getConfig.
export {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
  type InternalFrameworkConfig,
} from "./config/InternalConfigService.js";

export { DefaultConfigService } from "./config/DefaultConfigService.js";
export {
  ConfigModule,
  type ConfigModuleOptions,
} from "./config/ConfigModule.js";
export {
  ConfigValidator,
  ConfigValidationError,
} from "./config/ConfigValidator.js";
export { ConfigWatcher } from "./config/ConfigWatcher.js";

// ----------------------------------------------
// Validation (TypeBox)
// ----------------------------------------------
export { Validate } from "./validation/validate.decorator.js";

// ----------------------------------------------
// WebSockets (Gateways & Firehose)
// ----------------------------------------------
export { WebSocketGateway } from "./websockets/decorators/gateway.js";
export {
  SubscribeMessage,
  OnMessage,
  OnConnect,
  OnDisconnect,
} from "./websockets/decorators/events.js";
export type { WebSocketGatewayOptions } from "./websockets/decorators/types.js";

// Servicios de WebSockets (Gateway Registry y sub-servicios)
export { WsGatewayRegistry } from "./websockets/WsGatewayRegistry.js";
export { WsConnectionManager } from "./websockets/WsConnectionManager.js";
export { WsMessageRouter } from "./websockets/WsMessageRouter.js";
export { WsGuardExecutor } from "./websockets/WsGuardExecutor.js";
export { WsLifecycleHandler } from "./websockets/WsLifecycleHandler.js";

// Adaptadores y Contratos
export { JsonWsAdapter } from "./websockets/adapters/JsonWsAdapter.js";
export type {
  WsAdapter,
  FastifyKitWsPacket,
} from "./websockets/interfaces/WsAdapter.js";

// ----------------------------------------------
// WEBSOCKETS (Room Management & Broadcasting System)
// ----------------------------------------------

// Interfaces y tipos relacionados con la gestión de salas y broadcasting de WebSockets
export type { WsEventHandlerMetadata } from "./websockets/decorators/types.js";
export type { FastifyKitSocket } from "./websockets/interfaces/FastifyKitSocket.js";
export type { WsRoomManager } from "./websockets/interfaces/WsRoomManager.js";

// Implementaciones de Room Managers integrados (Built-in)
export { MemoryRoomManager } from "./websockets/managers/MemoryRoomManager.js";

// Token para que puedan inyectar su propio RedisRoomManager o similar
export { WS_ROOM_MANAGER_TOKEN } from "./websockets/interfaces/WsRoomManager.js";

// Herramientas de Broadcasting Proactivo
export { WsBroadcaster } from "./websockets/broadcaster/WsBroadcaster.js";
export {
  broadcastToRoom,
  broadcastToRooms,
} from "./websockets/broadcaster/WsBroadcaster.js"; // Facades

// ----------------------------------------------
// WEBRTC (SFU Media Server)
// ----------------------------------------------
export type { FastifyKitWebRtcConfig } from "./core/interfaces/webrtc.interface.js";
export {
  AbstractWebRtcGateway,
  type WebRtcTransportResponse,
} from "./webrtc/gateways/AbstractWebRtcGateway.js";
export { DefaultWebRtcGateway } from "./webrtc/gateways/DefaultWebRtcGateway.js";

export { getSfuRoomManager } from "./webrtc/managers/sfu-manager.factory.js";
export { DefaultSfuRoomManager } from "./webrtc/managers/DefaultSfuRoomManager.js";
export { AdvancedSfuRoomManager } from "./webrtc/managers/AdvancedSfuRoomManager.js";

export { SFU_ROOM_MANAGER_TOKEN } from "./webrtc/interfaces/SfuRoomManager.js";
export type { SfuRoomManager } from "./webrtc/interfaces/SfuRoomManager.js";
export type { IceServer } from "./webrtc/interfaces/IceServer.js";

// Exportamos todas las constantes de configuración (Opciones por defecto)
export * from "./webrtc/constants/WebRtcConfig.js";

// --- Eventos y Payloads de WebRTC ---
export {
  WEBRTC_ROOM_CREATED_EVENT,
  WEBRTC_ROOM_CLOSED_EVENT,
  WEBRTC_AUDIO_VOLUMES_EVENT,
  WEBRTC_WORKER_LOAD_EVENT,
  WEBRTC_MEDIA_SCORE_EVENT,
  WEBRTC_SYSTEM_SATURATED_EVENT,
} from "./webrtc/constants/WebRtcEvents.js";

export type {
  WEBRTC_ROOM_CREATED_PAYLOAD,
  WEBRTC_ROOM_CLOSED_PAYLOAD,
  WEBRTC_AUDIO_VOLUMES_PAYLOAD,
  WEBRTC_WORKER_LOAD_PAYLOAD,
  WEBRTC_MEDIA_SCORE_PAYLOAD,
  WEBRTC_SYSTEM_SATURATED_PAYLOAD,
} from "./webrtc/constants/WebRtcEvents.js";

// ==========================================
// CICLO DE VIDA (LIFECYCLE HOOKS)
// ==========================================
export type {
  OnModuleInit,
  OnApplicationBootstrap,
  OnServerReady,
  BeforeApplicationShutdown,
  OnApplicationShutdown,
} from "./core/interfaces/lifecycle.interface.js";

// ==========================================
// Health Checks (Terminus Pattern)
// ==========================================
export { HealthCheckService } from "./health/HealthCheckService.js";
export { HealthCheckError } from "./health/HealthCheckError.js";
export { HealthIndicator } from "./health/indicators/HealthIndicator.js";

// Indicadores integrados (Built-in)
export { MemoryHealthIndicator } from "./health/indicators/MemoryHealthIndicator.js";
export { HttpHealthIndicator } from "./health/indicators/HttpHealthIndicator.js";
export { PingHealthIndicator } from "./health/indicators/PingHealthIndicator.js";
export { DiskSpaceHealthIndicator } from "./health/indicators/DiskSpaceHealthIndicator.js";
export { EventLoopHealthIndicator } from "./health/indicators/EventLoopHealthIndicator.js";
export { WebRtcHealthIndicator } from "./health/indicators/WebRtcHealthIndicator.js";
export { ObservabilityHealthIndicator } from "./health/indicators/ObservabilityHealthIndicator.js";

// Tipos
export type {
  HealthCheckResult,
  HealthIndicatorResult,
  HealthStatus,
} from "./health/interfaces.js";
