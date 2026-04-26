/**
 * Soporte para Stage 3 Decorators Metadata.
 * Garantiza que Symbol.metadata exista en el entorno de ejecución (Bun/Node/V8).
 */
if ((Symbol as any).metadata === undefined) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

// ----------------------------------------------
// Core & Bootstrap
// ----------------------------------------------
export {
  FastifyKit,
  type FastifyKitOptions,
  FASTIFY_INSTANCE_TOKEN,
} from "./core/FastifyKit.js";
export { Module } from "./core/module.decorator.js";
export { discoverControllers, discoverModules } from "./core/discovery.js";
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
// Exportamos la instancia global por si el usuario necesita acceder al requestId manualmente
export { requestContext } from "./http/context/requestContext.js";

// ----------------------------------------------
// Dependency Injection (IoC)
// ----------------------------------------------
export { container, type Contract } from "./container/DIContainer.js";
export { Injectable } from "./container/injectable.decorator.js";
export { Inject } from "./container/inject.decorator.js";

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
} from "./events/EventBus.js";
export { getEventBus } from "./events/eventbus.factory.js";

// ----------------------------------------------
// Scheduling & Background Tasks
// ----------------------------------------------
export { Scheduled, CronExpression } from "./scheduling/scheduled.decorator.js";

// ----------------------------------------------
// Configuration Management
// ----------------------------------------------
export { ConfigRegistry } from "./config/ConfigRegistry.js";
export { InjectConfig } from "./config/inject-config.decorator.js";

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

// Tipos
export type {
  HealthCheckResult,
  HealthIndicatorResult,
  HealthStatus,
} from "./health/interfaces.js";
