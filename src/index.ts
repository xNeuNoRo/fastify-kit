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
export { FastifyKit, type FastifyKitOptions } from "./core/FastifyKit";
export { Module } from "./core/module.decorator";
export { discoverControllers, discoverModules } from "./http/routing/discovery";
export type { ModuleOptions } from "./http/decorators/types";
export type { AutoDiscoverOptions } from "./http/routing/discovery";
export type { Constructor } from "./http/routing/scanner";

// ----------------------------------------------
// HTTP Routing & Controllers
// ----------------------------------------------
export { Controller } from "./http/decorators/controller";
export { Get, Post, Put, Patch, Delete } from "./http/decorators/methods";
export { Version } from "./http/decorators/version"; // Decorador para definir versiones de API a nivel de clase o método
export {
  UseParams, // Decorador para definir qué parámetros queremos inyectar en cada método de nuestros controladores
  Body,
  Query,
  Param,
  Headers,
  Req,
  Res,
  Ip,
} from "./http/decorators/parameters";

// ----------------------------------------------
// HTTP Security & Guards
// ----------------------------------------------
export { UseGuards } from "./http/decorators/guards";
export { RateLimit } from "./http/decorators/rate-limit";
export type { CanActivate } from "./http/guards/CanActivate";
export type { RateLimitOptions } from "./http/decorators/types";

// ----------------------------------------------
// HTTP Responses & Exceptions
// ----------------------------------------------
export { createApiResponseSchema } from "./http/responses/api-response.schema";
export { ApiResponse } from "./http/responses/ApiResponse";
export { ApiError } from "./http/responses/ApiError";
export * from "./http/exceptions"; // Exporta todos los ErrorCodes y Excepciones (NotFound, Validation, etc.)

// ----------------------------------------------
// Execution Context (AsyncLocalStorage)
// ----------------------------------------------
export { AlsStore } from "./http/context/AlsStore";
// Exportamos la instancia global por si el usuario necesita acceder al requestId manualmente
export { requestContext } from "./http/context/requestContext";

// ----------------------------------------------
// Dependency Injection (IoC)
// ----------------------------------------------
export { container, type Contract } from "./container/DIContainer";
export { Injectable } from "./container/injectable.decorator";
export { Inject } from "./container/inject.decorator";

// ----------------------------------------------
// Data & Mapping
// ----------------------------------------------
export { MapTo } from "./utils/map-to.decorator";
export { Mapper } from "./utils/Mapper";
export type { PipeTransform } from "./http/pipes/PipeTransform"; // El contrato de transformación

// ----------------------------------------------
// Caching (AOP)
// ----------------------------------------------
export { Cache, ClearCache } from "./cache/cache.decorator";
export { CacheManager } from "./cache/CacheManager";

// ----------------------------------------------
// Database & Transactions (Agnostic)
// ----------------------------------------------
export {
  Transactional,
  TRANSACTION_MANAGER_TOKEN,
} from "./database/transactions";
export { createTransactionProxy } from "./database/proxy";
export type { ITransactionManager } from "./database/transactions";

// ----------------------------------------------
// Observability & Logging
// ----------------------------------------------
export { Benchmark } from "./logger/benchmark.decorator";
export {
  LOGGER_TOKEN,
  type LoggerContract,
  DefaultConsoleLogger,
} from "./logger/LoggerContract";
export { getLogger } from "./logger/logger.factory";

// ----------------------------------------------
// Resilience & Fault Tolerance
// ----------------------------------------------
export { Retry } from "./resilience/retry.decorator";
export { Timeout } from "./resilience/timeout.decorator";
export { CircuitBreaker } from "./resilience/circuit-breaker.decorator";

// ----------------------------------------------
// Event Bus (Pub / Sub)
// ----------------------------------------------
export { OnEvent } from "./events/on-event.decorator";
export { OnceEvent } from "./events/once-event.decorator";
export {
  EVENT_BUS_TOKEN,
  type EventBusContract,
  DefaultEventBus,
} from "./events/EventBus";
export { getEventBus } from "./events/eventbus.factory";

// ----------------------------------------------
// Scheduling & Background Tasks
// ----------------------------------------------
export { Scheduled, CronExpression } from "./scheduling/scheduled.decorator";

// ----------------------------------------------
// Configuration Management
// ----------------------------------------------
export { ConfigRegistry } from "./config/ConfigRegistry";
export { InjectConfig } from "./config/inject-config.decorator";

// ----------------------------------------------
// Validation (TypeBox)
// ----------------------------------------------
export { Validate } from "./validation/validate.decorator";
